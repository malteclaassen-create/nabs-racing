// ---------------------------------------------------------------------------
// Link-preview pictures the server draws itself, one per page of a series.
//
// The league shares its pages in Discord by copying the address from the
// browser. Discord shows the page's og:image under the link, and that used to
// be the same league picture on every page and every week. Now each page has
// its own, in the look of the Home page's hero card (lib/sharePictureDraw.js),
// filled with what that page is about right now: the latest podium on the
// results page, the top three on the standings, the next round on the sign-up
// page, and so on. Only things that change at most once a race week go on a
// picture. A seat count or a live gap would be out of date in the preview
// within the hour, and Discord keeps showing what it fetched.
//
// Discord keeps a preview per ADDRESS for a while, both the page's and the
// picture's. So each picture carries a version that changes whenever what is
// drawn on it changes; the picture's address includes it, and the site writes
// the same version into the browser's address bar (?v=8-3fa2c, see
// components/ShareVersionSync.jsx), so the link people copy after a round is
// one Discord has never seen and has to fetch fresh. The site ignores the
// parameter and the canonical tag drops it (lib/seo.js).
//
// An admin's own uploaded picture for a page (Site texts > Link previews)
// still wins over the drawn one.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { resolveSeason, getPrivateSeasonIds } from "../services/seasonService.js";
import { raceDetailPayload } from "../services/raceDetailService.js";
import { getDriverStandings, getT1ConstructorStandings } from "../services/standingsService.js";
import { getSeriesRecords } from "../services/recordsService.js";
import { readTeamHistory } from "../services/teamHistoryService.js";
import { resolveSeries } from "./series.js";
import { seasonLabel } from "./seo.js";
import { prettyTrack, themeColorOf, resolveShareImage, pageShareImage } from "./pageMeta.js";
import { readParentIds } from "./sprintRaces.js";
import { readRaceCountries, staticCountryFor } from "./raceCountries.js";
import { raceKickoff } from "./raceKickoff.js";
import { readRaceHeroes } from "./raceHero.js";
import { readRacePhotos, racePhotoUrl } from "./racePhotos.js";
import { staticFile, DRAWING_REV } from "./sharePictureDraw.js";

const TZ = "Europe/Berlin";
const SECTION_ALIASES = { results: "races", calendar: "races", teams: "constructors" };
const PAGES = new Set(["home", "attendance", "drivers", "constructors", "races", "transfers", "records", "live"]);

// Which page an address is, for the drawn pictures: the series' landing page
// and the eight list pages (lib/series.js SHARE_PAGES), and NOT what lies
// below them. A driver's own page or a team's is about that driver or team,
// and a standings picture under their link would say something else. Those
// keep the page's uploaded picture, as before.
export function drawnPageOf(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  if (!parts.length || (parts.length === 1 && parts[0] === "join")) return { page: "home", slug: null };
  if (parts[0] !== "s" || !parts[1] || parts.length > 3) return null;
  const slug = decodeURIComponent(parts[1]);
  if (parts.length === 2) return { page: "home", slug };
  const page = SECTION_ALIASES[parts[2]] || parts[2];
  return PAGES.has(page) ? { page, slug } : null;
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

const upper = (s) => String(s || "").toUpperCase();

function kickoff(d) {
  return raceKickoff(d) || new Date(d);
}

// "FRIDAY, 9 OCTOBER 2026", the way the Home hero dates a round.
const fullDate = (d) =>
  upper(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
      kickoff(d)
    )
  );

// "FRIDAY, 9 OCTOBER · 19:30 CEST" for a round still to come.
function startLine(d) {
  const t = kickoff(d);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(t);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
  const zone =
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, timeZoneName: "short" })
      .formatToParts(t)
      .find((p) => p.type === "timeZoneName")?.value || "";
  return upper(`${day} · ${time}${zone ? ` ${zone}` : ""}`);
}

// "FRI 9 OCT" for a card.
const shortDate = (d) =>
  upper(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(kickoff(d)));

async function seasonSeriesId(prisma, seasonId) {
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT "seriesId" FROM "Season" WHERE "id" = ?`, seasonId);
    return rows[0]?.seriesId ?? null;
  } catch {
    return null;
  }
}

async function seasonHero(prisma, season) {
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT "heroImageUrl" FROM "Season" WHERE "id" = ?`, season.id);
    if (rows[0]?.heroImageUrl) return rows[0].heroImageUrl;
  } catch {
    /* column missing pre-migration */
  }
  if (season.number != null && staticFile(`heroes/s${season.number}.jpg`)) return `/heroes/s${season.number}.jpg`;
  return "/hero.jpg";
}

// A round's own photo (its hero, else the first of its gallery), else the
// season's.
async function racePhoto(prisma, race, season) {
  if (race) {
    const heroes = await readRaceHeroes(prisma, [race.id]);
    if (heroes.get(race.id)) return heroes.get(race.id);
    const photos = await readRacePhotos(prisma, race.id);
    if (photos[0]) return racePhotoUrl(photos[0].file);
  }
  return seasonHero(prisma, season);
}

async function countryOf(prisma, race) {
  const map = await readRaceCountries(prisma, [race.id]);
  return map.get(race.id) || staticCountryFor(race.track) || null;
}

// The season's championship rounds (feature races; sprint halves live on
// child rows), in calendar order, and how many of them are done.
async function seasonRounds(prisma, seasonId) {
  const races = await prisma.race.findMany({
    where: { seasonId, isSpecialEvent: false, number: { not: null } },
    orderBy: [{ number: "asc" }],
  });
  const children = await readParentIds(prisma, races.map((r) => r.id));
  const rounds = races.filter((r) => !children.has(r.id));
  const done = [];
  for (const r of rounds) if (r.isCompleted && (await prisma.raceResult.count({ where: { raceId: r.id } }))) done.push(r);
  return { rounds, done };
}

// The next round people sign up for: the first one not yet run, special
// events and practice included, by date.
async function nextRace(prisma, seasonId) {
  const open = await prisma.race.findMany({
    where: { seasonId, isCompleted: false, date: { not: null } },
    orderBy: { date: "asc" },
  });
  const children = await readParentIds(prisma, open.map((r) => r.id));
  const cutoff = Date.now() - 6 * 3600 * 1000;
  const list = open.filter((r) => !children.has(r.id));
  return list.find((r) => kickoff(r.date).getTime() >= cutoff) || list[0] || null;
}

const roundName = (race) =>
  race.number != null ? `ROUND ${race.number}` : race.type === "TRAINING" ? "PRACTICE" : "SPECIAL EVENT";

// A podium/standings card for a driver row.
const driverCard = (r, i, value, unit = "PTS") => ({
  medal: i,
  tag: `P${r.position ?? i + 1}`,
  title: r.name,
  flag: r.country || null,
  logo: r.team?.logoUrl || null,
  dot: r.team?.color || null,
  sub: r.team?.name || "",
  value: value != null ? String(value) : null,
  unit,
});

// ---------------------------------------------------------------------------
// One builder per page. Each returns the picture's content, or null when the
// page has nothing of its own to show (then the uploaded or shipped picture
// stands in).
// ---------------------------------------------------------------------------

async function homePicture(prisma, ctx) {
  const { season } = ctx;
  const [{ rounds, done }, next, standings] = await Promise.all([
    seasonRounds(prisma, season.id),
    nextRace(prisma, season.id),
    getDriverStandings(prisma, season.id).catch(() => null),
  ]);
  const cards = [];
  if (next) {
    cards.push({
      kicker: `NEXT · ${roundName(next)}`,
      title: prettyTrack(next.track),
      flag: await countryOf(prisma, next),
      sub: shortDate(next.date),
    });
  }
  const leader = standings?.standings?.[0];
  if (leader && done.length && leader.total > 0) {
    cards.push({ ...driverCard(leader, 0, leader.total), tag: null, medal: null, kicker: "LEADER" });
  }
  const last = done[done.length - 1];
  if (last) {
    const detail = await raceDetailPayload(prisma, last);
    const win = (detail.results || []).find((r) => r.status === "FINISHED" && r.position === 1);
    if (win) {
      const team = (win.isSub && win.subForTeam) || win.team || {};
      cards.push({
        kicker: `LAST WINNER · ${upper(prettyTrack(last.track))}`,
        title: win.name,
        flag: win.country || null,
        logo: team.logoUrl || null,
        dot: team.color || null,
        sub: team.name || "",
      });
    }
  }
  const total = rounds.length;
  return {
    eyebrow: ["CHAMPIONSHIP", total ? `ROUND ${done.length} / ${total}` : null],
    title: ctx.series.name,
    sub: total ? `${done.length} OF ${total} ROUNDS RACED${total > done.length ? ` · ${total - done.length} TO GO` : ""}` : null,
    cards,
    background: await racePhoto(prisma, last || null, season),
  };
}

async function racesPicture(prisma, ctx) {
  const { series, query } = ctx;
  let race = null;
  let season = ctx.season;
  let latest = true;
  const raceId = typeof query?.race === "string" ? query.race.trim() : "";
  if (raceId) {
    // A single round's link (?race=<id>): that round's podium, if it is a
    // finished round of this series in a public season.
    const r = await prisma.race.findUnique({ where: { id: raceId } }).catch(() => null);
    if (!r?.isCompleted || !r.seasonId) return null;
    if ((await getPrivateSeasonIds(prisma)).has(r.seasonId)) return null;
    if ((await seasonSeriesId(prisma, r.seasonId)) !== series.id) return null;
    season = await prisma.season.findUnique({ where: { id: r.seasonId } });
    race = r;
    latest = false;
  } else {
    const { done } = await seasonRounds(prisma, season.id);
    race = done[done.length - 1] || null;
  }
  if (!race || !season) return null;
  const detail = await raceDetailPayload(prisma, race);
  const top = (detail.results || [])
    .filter((r) => r.status === "FINISHED" && r.position != null)
    .sort((a, b) => a.position - b.position)
    .slice(0, 3);
  if (!top.length) return null;
  const scores = !race.isSpecialEvent;
  return {
    season,
    eyebrow: [latest ? "LATEST RACE" : "RACE RESULT", roundName(race)],
    flag: await countryOf(prisma, race),
    title: prettyTrack(race.track),
    sub: race.date ? fullDate(race.date) : null,
    cards: top.map((r, i) => {
      // A sub drives for the team they stood in for, as on the Home hero.
      const team = (r.isSub && r.subForTeam) || r.team || {};
      return {
        ...driverCard({ ...r, team }, i, scores ? r.points : null),
        tag: `P${r.position}`,
      };
    }),
    background: await racePhoto(prisma, race, season),
  };
}

async function attendancePicture(prisma, ctx) {
  const { season, query } = ctx;
  const raceId = typeof query?.race === "string" ? query.race.trim() : "";
  let race = null;
  if (raceId) {
    race = await prisma.race.findFirst({ where: { id: raceId, seasonId: season.id } }).catch(() => null);
  }
  race ||= await nextRace(prisma, season.id);
  if (!race) return null;
  const facts = [];
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT "qualiMinutes", "raceLaps" FROM "Race" WHERE "id" = ?`, race.id);
    if (rows[0]?.qualiMinutes) facts.push(`QUALI ${rows[0].qualiMinutes} MIN`);
    if (rows[0]?.raceLaps) facts.push(`RACE ${rows[0].raceLaps} LAPS`);
  } catch {
    /* columns missing pre-migration */
  }
  if (race.capacity) facts.push(`GRID ${race.capacity}`);
  return {
    eyebrow: [race.isCompleted ? "SIGN-UPS" : "NEXT RACE", roundName(race)],
    flag: await countryOf(prisma, race),
    title: prettyTrack(race.track),
    sub: race.date ? startLine(race.date) : null,
    button: race.isCompleted ? null : "SIGN UP",
    facts,
    background: await racePhoto(prisma, race, season),
  };
}

async function driversPicture(prisma, ctx) {
  const { season } = ctx;
  const [{ rounds, done }, standings] = await Promise.all([
    seasonRounds(prisma, season.id),
    getDriverStandings(prisma, season.id),
  ]);
  const rows = (standings?.standings || []).filter((r) => r.total > 0).slice(0, 3);
  if (!done.length || !rows.length) return null;
  const left = rounds.length - done.length;
  const gap = rows[1] ? rows[0].total - rows[1].total : null;
  return {
    eyebrow: [`AFTER ROUND ${done.length}`, `OF ${rounds.length}`],
    title: "Driver standings",
    sub: [
      gap ? `${upper(rows[0].name)} LEADS BY ${gap} PTS` : gap === 0 ? "LEVEL ON POINTS AT THE TOP" : null,
      left > 0 ? `${left} ROUND${left > 1 ? "S" : ""} TO GO` : "FINAL STANDINGS",
    ]
      .filter(Boolean)
      .join(" · "),
    cards: rows.map((r, i) => driverCard(r, i, r.total)),
    background: await seasonHero(prisma, season),
  };
}

async function constructorsPicture(prisma, ctx) {
  const { season } = ctx;
  const [{ rounds, done }, teams, drivers] = await Promise.all([
    seasonRounds(prisma, season.id),
    getT1ConstructorStandings(prisma, season.id),
    getDriverStandings(prisma, season.id).catch(() => null),
  ]);
  const rows = (teams?.standings || []).filter((t) => t.total > 0).slice(0, 3);
  if (!done.length || !rows.length) return null;
  const left = rounds.length - done.length;
  const gap = rows[1] ? rows[0].total - rows[1].total : null;
  // Who drives for the team, as the standings list them: its two best placed.
  const lineup = (teamId) =>
    (drivers?.standings || [])
      .filter((d) => d.team?.id === teamId && d.isActive !== false)
      .slice(0, 2)
      .map((d) => d.name)
      .join(" · ");
  return {
    eyebrow: [`AFTER ROUND ${done.length}`, `OF ${rounds.length}`],
    title: "Constructors",
    sub: [
      gap ? `${upper(rows[0].name)} LEADS BY ${gap} PTS` : gap === 0 ? "LEVEL ON POINTS AT THE TOP" : null,
      left > 0 ? `${left} ROUND${left > 1 ? "S" : ""} TO GO` : "FINAL STANDINGS",
    ]
      .filter(Boolean)
      .join(" · "),
    cards: rows.map((t, i) => ({
      medal: i,
      tag: `P${t.position ?? i + 1}`,
      title: t.name,
      logo: t.logoUrl || null,
      dot: t.color || null,
      sub: lineup(t.teamId),
      value: String(t.total),
      unit: "PTS",
    })),
    background: await seasonHero(prisma, season),
  };
}

async function transfersPicture(prisma, ctx) {
  const { season } = ctx;
  const history = await readTeamHistory(prisma, season.id);
  const teams = new Map((history.teams || []).map((t) => [t.id, t]));
  const drivers = new Map((history.drivers || []).map((d) => [d.id, d]));
  const moves = (history.moves || []).filter((m) => !m.pending);
  // Latest round first; within a round, moves INTO a team before moves out.
  const intoTeam = (m) => ((teams.get(m.toTeamId)?.tier || 0) > 0 ? 1 : 0);
  const latest = [...moves].sort((a, b) => b.round - a.round || intoTeam(b) - intoTeam(a)).slice(0, 3);
  return {
    eyebrow: ["TRANSFER MARKET", moves.length ? `${moves.length} MOVE${moves.length > 1 ? "S" : ""}` : null],
    title: "Transfers",
    sub: latest.length ? `LATEST MOVES · ROUND ${latest[0].round}` : "NO MOVES YET THIS SEASON",
    cards: latest.map((m) => {
      const to = teams.get(m.toTeamId) || {};
      const from = teams.get(m.fromTeamId) || {};
      const d = drivers.get(m.driverId) || {};
      return {
        bar: to.color || null,
        tag: `R${m.round}`,
        title: d.name || "?",
        flag: d.country || null,
        logo: to.logoUrl || null,
        dot: to.color || null,
        // Drawn as "from", an arrow, "to" (the arrow is a drawn line: the
        // site fonts have no arrow character).
        sub: [from.name || "?", { arrow: true }, to.name || "?"],
      };
    }),
    background: await seasonHero(prisma, season),
  };
}

async function recordsPicture(prisma, ctx) {
  const data = await getSeriesRecords(prisma, ctx.series.slug).catch(() => null);
  if (!data?.lists?.length) return null;
  const pick = ["wins", "poles", "points"]
    .map((k) => data.lists.find((l) => l.key === k))
    .filter((l) => l?.rows?.length);
  if (!pick.length) return null;
  return {
    pill: "ALL TIME",
    eyebrow: ["HALL OF FAME", data.seasons ? `${data.seasons} SEASONS` : null],
    title: "Records",
    sub: `THE BEST OF ${upper(ctx.series.name)}, EVERY SEASON COUNTED`,
    cards: pick.map((l) => {
      const top = l.rows[0];
      // A shared record names everyone on it.
      const tied = l.rows.filter((r) => r.value === top.value).map((r) => r.name);
      return {
        kicker: upper(l.label),
        title: tied.join(" · "),
        flag: tied.length === 1 ? top.country || null : null,
        logo: tied.length === 1 ? top.team?.logoUrl || null : null,
        dot: tied.length === 1 ? top.team?.color || null : null,
        sub: tied.length === 1 ? top.team?.name || "" : "SHARED",
        value: Number(top.value).toLocaleString("en-GB"),
        unit: upper(l.unit || ""),
      };
    }),
    background: await seasonHero(prisma, ctx.season),
  };
}

async function livePicture(prisma, ctx) {
  const { season } = ctx;
  const race = await nextRace(prisma, season.id);
  return {
    live: true,
    eyebrow: ["LIVE TIMING", race ? roundName(race) : null],
    flag: race ? await countryOf(prisma, race) : null,
    title: race ? prettyTrack(race.track) : "Live timing",
    sub: race?.date ? `NEXT SESSION · ${startLine(race.date)}` : "RACE NIGHTS AND PRACTICE",
    facts: ["RUNNING ORDER", "GAPS", "BEST LAPS", "TYRES"],
    background: await racePhoto(prisma, race, season),
  };
}

const BUILDERS = {
  home: homePicture,
  races: racesPicture,
  attendance: attendancePicture,
  drivers: driversPicture,
  constructors: constructorsPicture,
  transfers: transfersPicture,
  records: recordsPicture,
  live: livePicture,
};

// ---------------------------------------------------------------------------
// State, version, cache
// ---------------------------------------------------------------------------

// Everything the picture of an address shows, plus the version naming exactly
// that, or null when the address gets no drawn picture.
export async function sharePictureState(prisma, pathname, query = {}) {
  const at = drawnPageOf(pathname);
  if (!at) return null;
  const series = await resolveSeries(prisma, at.slug ?? undefined, { includePrivate: false });
  if (!series) return null;
  // An uploaded picture for this page wins: nothing to draw.
  if (resolveShareImage(series, at.page).source === "page") return null;
  const season = await resolveSeason(prisma, query?.season, { series: series.slug }).catch(() => null);
  if (!season || (await getPrivateSeasonIds(prisma)).has(season.id)) return null;
  const body = await BUILDERS[at.page](prisma, { series, season, query });
  if (!body) return null;
  const shownSeason = body.season || season;
  delete body.season;
  const state = {
    page: at.page,
    path: at.slug ? `/s/${series.slug}${at.page === "home" ? "" : `/${at.page}`}` : "/",
    query: { race: query?.race || undefined, season: query?.season || undefined },
    series: { name: series.name, accent: themeColorOf(series), logoDarkUrl: series.logoDarkUrl || null },
    pill: body.pill || seasonLabel(shownSeason),
    ...body,
  };
  const hash = createHash("sha1")
    .update(JSON.stringify([DRAWING_REV, state]))
    .digest("hex")
    .slice(0, 5);
  state.version = hash;
  return state;
}

// A few seconds of memory, because every page load asks (the server writes
// the picture's address into the HTML it sends). Short enough that a link
// copied right after a results import already carries the new version.
const STATE_TTL_MS = 10 * 1000;
const stateCache = new Map(); // key -> { at, promise }

export function cachedSharePictureState(prisma, pathname, query = {}) {
  const key = `${pathname}|${query?.race || ""}|${query?.season || ""}`;
  const hit = stateCache.get(key);
  if (hit && Date.now() - hit.at < STATE_TTL_MS) return hit.promise;
  const promise = sharePictureState(prisma, pathname, query).catch(() => null);
  stateCache.set(key, { at: Date.now(), promise });
  if (stateCache.size > 300) stateCache.delete(stateCache.keys().next().value);
  return promise;
}

// The picture's address (site-relative) for a state.
export function sharePicturePath(state) {
  const q = new URLSearchParams({ path: state.path });
  if (state.query.race) q.set("race", state.query.race);
  if (state.query.season) q.set("season", state.query.season);
  q.set("v", state.version);
  return `/api/share/picture.jpg?${q}`;
}

// The og:image of any address: the drawn picture where the page has one,
// else whatever lib/pageMeta.js picks (own upload, series default, the
// shipped one).
export async function shareImageFor(prisma, pathname, query, origin) {
  if (origin) {
    const state = await cachedSharePictureState(prisma, pathname, query);
    if (state) return `${origin}${sharePicturePath(state)}`;
  }
  return pageShareImage(prisma, pathname, origin);
}
