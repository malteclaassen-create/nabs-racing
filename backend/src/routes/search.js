// ---------------------------------------------------------------------------
// Global search (the NavBar search box). One public endpoint that finds
// drivers, teams, races, seasons and series across EVERY series/season — not
// scoped to whatever the visitor is currently viewing. Private seasons/series
// are hidden unless the caller is an admin (isAdminRequest).
//
// The dataset is tiny (a few hundred rows total), so we load-all-and-filter in
// memory per request, behind a short cache so fast typing doesn't re-query.
// Each result carries a ready-to-use `link` so the frontend just navigates to
// it — the link conventions live here, in one place.
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { dbListSeries, seasonSeriesMap } from "../lib/series.js";
import { getPersonGroups, getNameOverrides } from "../lib/persons.js";
import { readRaceCountries, staticCountryFor, countryNameOf } from "../lib/raceCountries.js";

const router = Router();

// Diacritic-insensitive, punctuation-collapsed normaliser for matching.
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Relevance of `term` within `haystack`: exact > whole-string prefix >
// word-start > substring. -1 = no match.
function scoreMatch(haystack, term) {
  const h = norm(haystack);
  const t = norm(term);
  if (!t || !h) return -1;
  if (h === t) return 100;
  if (h.startsWith(t)) return 80;
  if (h.split(" ").some((w) => w.startsWith(t))) return 60;
  if (h.includes(t)) return 40;
  return -1;
}
const best = (...scores) => Math.max(-1, ...scores);

// --- dataset cache (short-lived; keyed on admin visibility) -----------------
const CACHE_MS = 15_000;
const cache = { pub: null, adm: null };

async function loadDataset(isAdmin) {
  const slot = isAdmin ? "adm" : "pub";
  const hit = cache[slot];
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const [drivers, teams, races, seasons, series, seasonSeries, priv, groups, nameOv] = await Promise.all([
    prisma.driver.findMany({
      select: { id: true, name: true, discordName: true, seasonId: true, photoUrl: true, discordAvatar: true, country: true },
    }),
    prisma.team.findMany({ select: { id: true, name: true, color: true, logoUrl: true, tier: true, seasonId: true } }),
    prisma.race.findMany({
      select: { id: true, number: true, track: true, seasonId: true, isSpecialEvent: true, isCompleted: true },
    }),
    prisma.season.findMany({ select: { id: true, number: true, name: true, seriesId: true, game: true, isActive: true } }),
    dbListSeries(prisma, { includePrivate: isAdmin }),
    seasonSeriesMap(prisma),
    isAdmin ? Promise.resolve(new Set()) : getPrivateSeasonIds(prisma),
    getPersonGroups(prisma),
    getNameOverrides(prisma),
  ]);

  const seriesById = new Map(series.map((s) => [s.id, s]));
  const visibleSeriesIds = new Set(series.map((s) => s.id)); // dbListSeries already hid private ones for non-admins
  const seasonById = new Map(seasons.map((s) => [s.id, s]));

  // A season is reachable when it isn't private and its series is visible. A
  // legacy season with no series (pre-multi-series data) is allowed.
  const seasonVisible = (seasonId) => {
    if (!seasonId || priv.has(seasonId)) return false;
    const sid = seasonSeries.get(seasonId);
    return !sid || visibleSeriesIds.has(sid);
  };
  const seriesOf = (seasonId) => {
    const sid = seasonSeries.get(seasonId);
    return sid ? seriesById.get(sid) : null;
  };

  // Rows in the ACTIVE season (one per series) are the preferred link targets:
  // clicking a driver/team should land on the running season, not merely the
  // newest row (a coming-soon or private next season would otherwise win).
  const activeSeasonIds = new Set(seasons.filter((s) => s.isActive).map((s) => s.id));

  // Track flag country per race (stored code, else the static circuit table) —
  // lets "france" surface every race at a French circuit.
  const storedCountries = await readRaceCountries(prisma, races.map((r) => r.id));
  const raceCountry = new Map(
    races.map((r) => [r.id, storedCountries.get(r.id) || staticCountryFor(r.track) || null])
  );

  const data = { drivers, teams, races, seasons, series, seasonById, seasonVisible, seriesOf, groups, nameOv, activeSeasonIds, raceCountry };
  cache[slot] = { at: Date.now(), data };
  return data;
}

router.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 1) return res.json({ query: q, groups: [] });

    const isAdmin = isAdminRequest(req);
    const { drivers, teams, races, seasons, series, seasonById, seasonVisible, seriesOf, groups, nameOv, activeSeasonIds, raceCountry } =
      await loadDataset(isAdmin);
    const numberOf = (seasonId) => seasonById.get(seasonId)?.number ?? null;

    // Country matching: the English name matches like any label ("fran" finds
    // France), the two-letter code only on an exact hit ("fr"), so short
    // queries don't drown everything in flag matches. Scored below a direct
    // name hit so e.g. the driver "France" would still outrank French tracks.
    const countryScore = (code, term) => {
      if (!code) return -1;
      const t = norm(term);
      if (t === code) return 65;
      const sc = scoreMatch(countryNameOf(code), term);
      return sc >= 60 ? 55 : -1;
    };

    // --- Drivers: dedupe by PERSON, link to their newest visible row (career
    // profile). A match on any of the person's rows (incl. a former name)
    // surfaces them once. ---
    const personScore = new Map(); // personId -> best score across their rows
    for (const d of drivers) {
      if (!seasonVisible(d.seasonId)) continue;
      const ov = nameOv.get(d.id);
      const sc = best(
        scoreMatch(ov?.displayName || d.name, q),
        scoreMatch(d.name, q),
        scoreMatch(d.discordName, q),
        ov?.formerName ? scoreMatch(ov.formerName, q) : -1,
        // Self-set nationality: "france" lists the French drivers too.
        countryScore(d.country, q)
      );
      if (sc < 0) continue;
      const person = groups.byDriver.get(d.id) || d.id;
      personScore.set(person, Math.max(personScore.get(person) ?? -1, sc));
    }
    const rowById = new Map(drivers.map((d) => [d.id, d]));
    const driverItems = [];
    for (const [person, sc] of personScore) {
      const ids = groups.byPerson.get(person) || [person];
      // The link target: the person's row in the ACTIVE season if they have
      // one, else their newest visible row. Rows are also collected newest-
      // first so the avatar can fall back to any row that carries a picture.
      let rep = null;
      const rows = [];
      for (const id of ids) {
        const d = rowById.get(id);
        if (!d || !seasonVisible(d.seasonId)) continue;
        const num = numberOf(d.seasonId) || 0;
        const isActive = activeSeasonIds.has(d.seasonId);
        rows.push({ d, num });
        if (!rep || (isActive && !rep.isActive) || (isActive === !!rep.isActive && num > rep.num))
          rep = { d, num, isActive };
      }
      if (!rep) continue;
      const sr = seriesOf(rep.d.seasonId);
      if (!sr) continue;
      const name = nameOv.get(rep.d.id)?.displayName || rep.d.name;
      // The account's profile picture (custom upload, else Discord avatar) —
      // taken from whichever of the person's rows has one, newest first, since
      // the picture often lives on a different season's row than the target.
      rows.sort((a, b) => b.num - a.num);
      const photoRow = rows.find((r) => r.d.photoUrl || r.d.discordAvatar);
      driverItems.push({
        type: "driver",
        id: rep.d.id,
        label: name,
        photoUrl: photoRow ? photoRow.d.photoUrl || photoRow.d.discordAvatar : null,
        sublabel: series.length > 1 ? `Driver · ${sr.name}` : "Driver",
        // ?season steers the season switcher to the row's season on arrival.
        link: `/s/${sr.slug}/drivers/${rep.d.id}${rep.num ? `?season=${rep.num}` : ""}`,
        score: sc + rep.num * 0.1,
      });
    }

    // --- Teams: dedupe by (series, name), link to the ACTIVE season's row when
    // the team races in it, else the newest season's. The reserve pool (tier 0)
    // has no constructor page, so skip it. ---
    const teamBest = new Map();
    for (const t of teams) {
      if (t.tier === 0 || !seasonVisible(t.seasonId)) continue;
      const sc = scoreMatch(t.name, q);
      if (sc < 0) continue;
      const sr = seriesOf(t.seasonId);
      if (!sr) continue;
      const num = numberOf(t.seasonId);
      // Rows in the active season outrank every other row, then newest wins.
      const rank = (num || 0) + (activeSeasonIds.has(t.seasonId) ? 1000 : 0);
      const key = `${sr.id}|${norm(t.name)}`;
      const prev = teamBest.get(key);
      if (!prev || rank > prev.num) {
        teamBest.set(key, {
          num: rank,
          item: {
            type: "team",
            id: t.id,
            label: t.name,
            color: t.color,
            logoUrl: t.logoUrl,
            sublabel: series.length > 1 ? `Constructor · ${sr.name}` : "Constructor",
            // The team page is season-scoped (it lists the selected season's
            // teams), so steer the season too — TeamProfile consumes ?season.
            link: `/s/${sr.slug}/constructors/${t.id}${num != null ? `?season=${num}` : ""}`,
            // Relevance uses the plain season number — the active-season boost
            // in `rank` only picks WHICH row represents the team.
            score: sc + (num || 0) * 0.1,
          },
        });
      }
    }
    const teamItems = [...teamBest.values()].map((x) => x.item);

    // --- Races: each is a distinct event; the sublabel disambiguates by season. ---
    const raceItems = [];
    for (const r of races) {
      if (!seasonVisible(r.seasonId)) continue;
      const country = raceCountry.get(r.id) || null;
      const sc = best(
        scoreMatch(r.track, q),
        r.number != null ? scoreMatch(`round ${r.number}`, q) : -1,
        countryScore(country, q)
      );
      if (sc < 0) continue;
      const sr = seriesOf(r.seasonId);
      if (!sr) continue;
      const num = numberOf(r.seasonId);
      const seasonName = seasonById.get(r.seasonId)?.name || (num != null ? `Season ${num}` : "");
      const kind = r.isSpecialEvent ? "Event" : r.number != null ? `Round ${r.number}` : "Race";
      raceItems.push({
        type: "race",
        id: r.id,
        label: r.track,
        country,
        sublabel: [kind, seasonName].filter(Boolean).join(" · "),
        link: `/s/${sr.slug}/races?race=${r.id}${num != null ? `&season=${num}` : ""}`,
        score: sc + (num || 0) * 0.1,
      });
    }

    // --- Seasons ---
    const seasonItems = [];
    for (const s of seasons) {
      if (!seasonVisible(s.id)) continue;
      const sc = best(scoreMatch(s.name, q), scoreMatch(`season ${s.number}`, q), scoreMatch(String(s.number), q));
      if (sc < 0) continue;
      const sr = seriesOf(s.id);
      if (!sr) continue;
      seasonItems.push({
        type: "season",
        id: s.id,
        label: s.name || `Season ${s.number}`,
        sublabel: [series.length > 1 ? sr.name : null, s.game].filter(Boolean).join(" · ") || "Season",
        link: `/s/${sr.slug}/drivers?season=${s.number}`,
        score: sc + (s.number || 0) * 0.1,
      });
    }

    // --- Series (only worth showing when there's more than one) ---
    const seriesItems = [];
    if (series.length > 1) {
      for (const s of series) {
        const sc = best(scoreMatch(s.name, q), scoreMatch(s.slug, q));
        if (sc < 0) continue;
        seriesItems.push({ type: "series", id: s.id, label: s.name, sublabel: "Series", link: `/s/${s.slug}`, score: sc });
      }
    }

    // Sort each group by relevance, cap it, and strip the internal score.
    const PER_GROUP = 6;
    const finish = (items) =>
      items
        .sort((a, b) => b.score - a.score)
        .slice(0, PER_GROUP)
        .map(({ score, ...rest }) => rest);

    const groupsOut = [
      { type: "driver", label: "Drivers", items: driverItems },
      { type: "team", label: "Constructors", items: teamItems },
      { type: "race", label: "Races", items: raceItems },
      { type: "season", label: "Seasons", items: seasonItems },
      { type: "series", label: "Series", items: seriesItems },
    ]
      .map((g) => ({ ...g, top: Math.max(-1, ...g.items.map((i) => i.score)), items: finish(g.items) }))
      .filter((g) => g.items.length > 0)
      // Lead with the group holding the single best match.
      .sort((a, b) => b.top - a.top)
      .map(({ top, ...g }) => g);

    res.json({ query: q, groups: groupsOut });
  } catch (e) {
    next(e);
  }
});

export default router;
