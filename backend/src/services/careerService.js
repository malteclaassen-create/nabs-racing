// ---------------------------------------------------------------------------
// One person, every league, every season: the numbers behind /career/<handle>.
//
// The driver pages are season pages — they answer "how is this driver doing in
// Season 8 of F1 Friday". This one answers "what has this person done here,
// ever", so nothing is scoped to a series: the seasons of every league line up
// side by side, and the totals add them all together.
//
// A person is a PersonLink group (lib/persons.js), the same identity the
// career table and the rating cards use. Private seasons and hidden series
// never contribute, so a public page can't leak an unreleased roster.
// ---------------------------------------------------------------------------
import { getDriverStandings } from "./standingsService.js";
import { getPrivateSeasonIds, getActiveSeason } from "./seasonService.js";
import { buildAllTimeStats } from "./driverProfileService.js";
import { getSeriesRecords } from "./recordsService.js";
import { getCardRating } from "./cardRatingService.js";
import { getT1ConstructorStandings, getT2ConstructorStandings } from "./standingsService.js";
import { withClassifiedPositions } from "./penalisedResults.js";
import { getLinkedDriverIds, getPersonGroups, getNameOverrides, getIdentityOverrides, discordIdsForDrivers } from "../lib/persons.js";
import { seasonSeriesMap, dbListSeries } from "../lib/series.js";
import { driverHandle } from "../lib/driverHandles.js";
import { readScoringSprintParents } from "../lib/sprintRaces.js";
import { readPoleHolders, readManualFastestLaps } from "../lib/raceHonours.js";
import { hasRaced, finishesOf, startsOf } from "../lib/standingsRow.js";
import { isSeasonComplete, seasonConcluded } from "../lib/seasonComplete.js";
import { parseSocials } from "../lib/socials.js";
import { personPhotoFor, photoFallbacksFor } from "../lib/cardPhoto.js";
import { tokensPublic, flairsFor } from "../lib/tokens.js";


const avg = (nums) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null);

// Team names are per-season ids with drifting spellings, so anything that
// compares them across seasons normalises first (same rule as the profile).
const normName = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

// The page is a heavy read and changes only when an admin saves a result, so
// a short cache keeps a refresh cheap without going stale for long.
const CACHE_MS = 120_000;
const CACHE_MAX = 30; // a career object carries every race: don't hoard them
const cache = new Map();

export function invalidateCareerCache() {
  cache.clear();
}

// The firsts and the round counts, out of the person's races in the order they
// were driven. Pure, so the rules can be tested without a database.
export function milestonesOf(chrono) {
  const started = (chrono || []).filter((r) => r.status !== "DNS");
  const out = [];
  const mark = (key, label, race, detail) => {
    if (race) out.push({ key, label, detail, ...race });
  };
  mark("firstStart", "First start", started[0], started[0] ? `${started[0].seriesName} · Season ${started[0].seasonNumber}` : null);
  mark("firstPoints", "First points", started.find((r) => (r.points ?? 0) > 0), "first time on the board");
  mark("firstPodium", "First podium", started.find((r) => r.status === "FINISHED" && r.position != null && r.position <= 3), "top three");
  mark("firstWin", "First win", started.find((r) => r.status === "FINISHED" && r.position === 1), "race won");
  mark("firstPole", "First pole", started.find((r) => r.pole), "fastest in qualifying");
  for (const n of [25, 50, 100, 150, 200]) {
    if (started.length >= n) mark(`start${n}`, `${n}th start`, started[n - 1], "career milestone");
  }
  const t = (x) => (x.date ? new Date(x.date).getTime() : 0);
  out.sort((a, b) => t(a) - t(b) || (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) || (a.round ?? 0) - (b.round ?? 0));
  return out;
}

// One circuit is spelled a few ways across the archive ("RedBullRing", "Red
// Bull Ring", "interlagos"): the one that reads like a name wins.
export function prettiestName(names) {
  const score = (s) => (String(s).match(/ /g) || []).length * 10 + (/^[A-Z]/.test(s) ? 1 : 0) + String(s).length / 100;
  return (names || []).filter(Boolean).sort((a, b) => score(b) - score(a))[0] || null;
}

// Which driver row the address means. A row id is itself; a handle is matched
// against every public row, newest season wins.
async function resolveStartRow(prisma, key, privateSeasonIds, publicSeasonIds) {
  const k = String(key || "").trim();
  if (!k) return null;
  const byId = await prisma.driver.findUnique({ where: { id: k }, select: { id: true, seasonId: true } }).catch(() => null);
  if (byId && publicSeasonIds.has(byId.seasonId)) return byId.id;
  const rows = await prisma.driver.findMany({
    where: { seasonId: { in: [...publicSeasonIds] } },
    select: { id: true, name: true, seasonId: true, season: { select: { number: true } } },
  });
  const hits = rows.filter((r) => r.id === k || driverHandle(r.name) === k);
  if (!hits.length) return byId?.id || null;
  hits.sort((a, b) => (b.season?.number ?? 0) - (a.season?.number ?? 0));
  return hits[0].id;
}

// Everything the person ever drove, folded into the shape the page renders.
export async function getCareer(prisma, key, { includePrivate = false } = {}) {
  const cacheKey = `${key}|${includePrivate ? 1 : 0}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = computeCareer(prisma, key, includePrivate);
  cache.set(cacheKey, { at: Date.now(), promise });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  promise.catch(() => {
    if (cache.get(cacheKey)?.promise === promise) cache.delete(cacheKey);
  });
  return promise;
}

async function computeCareer(prisma, key, includePrivate) {
  const [privateSeasonIds, bySeries, allSeries] = await Promise.all([
    includePrivate ? new Set() : getPrivateSeasonIds(prisma),
    seasonSeriesMap(prisma),
    dbListSeries(prisma, { includePrivate }),
  ]);
  const seriesById = new Map(allSeries.map((s) => [s.id, s]));
  const visibleSeries = (seasonId) => {
    const s = seriesById.get(bySeries.get(seasonId) ?? null);
    return s && (includePrivate || s.isPublic) ? s : null;
  };
  const allSeasons = await prisma.season.findMany({ select: { id: true, number: true, name: true, game: true, isActive: true, seriesId: true } });
  const seasonById = new Map(allSeasons.map((s) => [s.id, s]));
  const publicSeasonIds = new Set(
    allSeasons.filter((s) => !privateSeasonIds.has(s.id) && visibleSeries(s.id)).map((s) => s.id)
  );

  const startId = await resolveStartRow(prisma, key, privateSeasonIds, publicSeasonIds);
  if (!startId) return null;

  const linkedAll = await getLinkedDriverIds(prisma, startId);
  const rows = (
    await prisma.driver.findMany({
      where: { id: { in: linkedAll } },
      include: { team: true, season: true },
    })
  ).filter((r) => r.seasonId && publicSeasonIds.has(r.seasonId));
  if (!rows.length) return null;
  const rowIds = rows.map((r) => r.id);
  const isMine = new Set(rowIds);

  // Newest row of all carries the current identity (name, flag, picture).
  const seasonNum = (r) => r.season?.number ?? -1;
  const sorted = [...rows].sort(
    (a, b) => seasonNum(b) - seasonNum(a) || (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0)
  );
  const newest = sorted[0];
  const [nameOv, idOv] = await Promise.all([getNameOverrides(prisma), getIdentityOverrides(prisma)]);
  const ov = nameOv.get(newest.id);
  const idov = idOv.get(newest.id);
  // The newest row's own pictures; the person's identity override carries the
  // rest of the chain (lib/cardPhoto.js decides which one wins).
  const pictures = { cardPhotoUrl: null, photoUrl: newest.photoUrl || null, discordAvatar: newest.discordAvatar || null };

  // --- every classification the person ever drove ---------------------------
  const results = await withClassifiedPositions(
    prisma,
    await prisma.raceResult.findMany({
      where: { driverId: { in: rowIds } },
      include: {
        race: {
          select: {
            id: true, seasonId: true, number: true, track: true, country: true, date: true,
            isCompleted: true, isSpecialEvent: true,
          },
        },
      },
    })
  );
  const counts = results.filter((r) => r.race?.isCompleted && publicSeasonIds.has(r.race.seasonId));
  const featureRows = counts.filter((r) => !r.race.isSpecialEvent);
  // childId -> the round it belongs to, for the sprints that count at all
  // (lib/sprintRaces.js decides; a practice night's sprint is not a race).
  const sprintParents = await readScoringSprintParents(
    prisma,
    counts.filter((r) => r.race.isSpecialEvent).map((r) => r.raceId)
  );
  const sprintRows = counts.filter((r) => publicSeasonIds.has(sprintParents.get(r.raceId)?.seasonId));
  const raced = [...featureRows, ...sprintRows];

  // Poles: the qualifying holder of every round the person entered.
  const poleByRace = await readPoleHolders(prisma, [...new Set(raced.map((r) => r.raceId))]);
  const manualFl = await readManualFastestLaps(prisma, new Set(raced.map((r) => r.raceId)));

  // --- season by season, grouped by league ----------------------------------
  const seasonIds = [...new Set(rows.map((r) => r.seasonId))];
  const standingsBySeason = new Map();
  for (const id of seasonIds) standingsBySeason.set(id, await getDriverStandings(prisma, id));

  const activeBySeries = new Map();
  for (const s of allSeries) {
    const active = await getActiveSeason(prisma, s.id).catch(() => null);
    activeBySeries.set(s.id, active || null);
  }
  const completeCache = new Map();
  const concludedSeason = async (season) => {
    const series = seriesById.get(season.seriesId ?? bySeries.get(season.id) ?? null);
    const active = series ? activeBySeries.get(series.id) : null;
    if (!completeCache.has(active?.id ?? "none")) {
      completeCache.set(active?.id ?? "none", active ? await isSeasonComplete(prisma, active.id) : false);
    }
    return seasonConcluded(season.number, active?.number ?? null, completeCache.get(active?.id ?? "none"));
  };

  const BADGE = { 1: "champion", 2: "vice", 3: "third" };
  const leagues = new Map(); // seriesId -> { ...series, seasons: [] }
  const titles = [];
  const teamSeals = new Set();
  for (const row of rows) {
    const season = seasonById.get(row.seasonId);
    const series = visibleSeries(row.seasonId);
    if (!season || !series) continue;
    const st = standingsBySeason.get(row.seasonId);
    const line = st?.standings?.find((x) => x.driverId === row.id);
    const field = (st?.standings || []).filter(hasRaced);
    const rank = line && hasRaced(line) ? field.findIndex((x) => x.driverId === row.id) + 1 : null;
    const cells = Object.values(line?.perRace || {});
    const finishes = finishesOf(cells);
    const mine = raced.filter((r) => r.race.seasonId === row.seasonId && r.driverId === row.id);
    const entry = {
      driverId: row.id,
      handle: driverHandle(row.name),
      seasonId: row.seasonId,
      seasonNumber: season.number,
      seasonName: season.name,
      game: season.game || null,
      isActive: !!season.isActive,
      teamId: row.team?.id || null,
      teamName: row.team?.name || null,
      teamColor: row.team?.color || null,
      teamLogoUrl: row.team?.logoUrl || null,
      teamTier: row.team?.tier ?? null,
      position: rank && rank > 0 ? rank : null,
      fieldSize: field.length,
      points: line?.total ?? 0,
      starts: startsOf(cells).length,
      wins: finishes.filter((c) => c.position === 1).length,
      podiums: finishes.filter((c) => c.position <= 3).length,
      poles: mine.filter((r) => poleByRace.get(r.raceId) === r.driverId).length,
    };
    let lg = leagues.get(series.id);
    if (!lg) {
      lg = {
        slug: series.slug,
        name: series.name,
        accentColor: series.accentColor || null,
        game: series.game || null,
        seasons: [],
      };
      leagues.set(series.id, lg);
    }
    lg.seasons.push(entry);
    const done = await concludedSeason(season);
    if (entry.position && entry.position <= 3 && done) {
      titles.push({
        type: BADGE[entry.position],
        position: entry.position,
        kind: "driver",
        seriesSlug: series.slug,
        seriesName: series.name,
        seasonNumber: season.number,
        seasonName: season.name,
        teamName: entry.teamName,
        teamColor: entry.teamColor,
      });
    }
    // The constructors' side of the same season: a seal for the team, earned
    // in the tier it raced in.
    if (done && (row.team?.tier === 1 || row.team?.tier === 2) && entry.starts > 0) {
      const table = await (row.team.tier === 1 ? getT1ConstructorStandings : getT2ConstructorStandings)(prisma, row.seasonId).catch(() => null);
      const trow = (table?.standings || []).find((t) => t.teamId === row.team.id);
      // One seal per team per season: two rows of the same season (a handle
      // change) would otherwise hang the same trophy twice.
      const sealKey = `${series.slug}|${season.number}|${row.team.id}`;
      if (trow && trow.position >= 1 && trow.position <= 3 && !teamSeals.has(sealKey)) {
        teamSeals.add(sealKey);
        titles.push({
          type: BADGE[trow.position],
          position: trow.position,
          kind: "team",
          seriesSlug: series.slug,
          seriesName: series.name,
          seasonNumber: season.number,
          seasonName: season.name,
          teamName: row.team.name,
          teamColor: row.team.color,
        });
      }
    }
  }
  // Two rows in one season (a handle change mid-season) are one line.
  for (const lg of leagues.values()) {
    const bySeason = new Map();
    for (const s of lg.seasons) {
      const prev = bySeason.get(s.seasonNumber);
      if (!prev) {
        bySeason.set(s.seasonNumber, s);
        continue;
      }
      const main = s.points > prev.points ? s : prev;
      bySeason.set(s.seasonNumber, {
        ...main,
        teamName: [...new Set([prev.teamName, s.teamName].filter(Boolean))].join(" / ") || null,
        points: prev.points + s.points,
        starts: prev.starts + s.starts,
        wins: prev.wins + s.wins,
        podiums: prev.podiums + s.podiums,
        poles: prev.poles + s.poles,
        position: [prev, s].filter((r) => r.position).map((r) => r.position).sort((a, b) => a - b)[0] ?? null,
      });
    }
    // A roster line with no start is not a season somebody raced: a reserve on
    // the sign-up list of six seasons would otherwise fill a league block with
    // six empty rows. The season that is RUNNING stays, because sitting in a
    // car right now is worth saying even before the first round.
    lg.seasons = [...bySeason.values()]
      .filter((x) => x.starts > 0 || x.isActive)
      .sort((a, b) => b.seasonNumber - a.seasonNumber);
    lg.totals = lg.seasons.reduce(
      (t, s) => ({
        seasons: t.seasons + (s.starts > 0 ? 1 : 0),
        points: t.points + s.points,
        starts: t.starts + s.starts,
        wins: t.wins + s.wins,
        podiums: t.podiums + s.podiums,
        poles: t.poles + s.poles,
        best: s.position != null && (t.best == null || s.position < t.best) ? s.position : t.best,
      }),
      { seasons: 0, points: 0, starts: 0, wins: 0, podiums: 0, poles: 0, best: null }
    );
  }
  const leagueList = [...leagues.values()]
    .filter((lg) => lg.seasons.length > 0)
    .sort((a, b) => b.totals.starts - a.totals.starts);
  titles.sort((a, b) => a.position - b.position || b.seasonNumber - a.seasonNumber || (a.kind === "driver" ? -1 : 1));

  // --- career totals --------------------------------------------------------
  const totals = await buildAllTimeStats(prisma, rowIds, privateSeasonIds);
  const pointsAllTime = leagueList.reduce((n, l) => n + l.totals.points, 0);
  const seasonsRaced = leagueList.reduce((n, l) => n + l.totals.seasons, 0);

  // --- one line per circuit -------------------------------------------------
  // The same circuit is spelled a few ways across the archive ("RedBullRing",
  // "Red Bull Ring", "interlagos"), so one spelling is picked for all of them:
  // the one that reads like a name.
  const spellings = new Map();
  for (const r of raced) {
    const name = r.race.track || "Unknown";
    const k = normName(name);
    if (!spellings.has(k)) spellings.set(k, []);
    spellings.get(k).push(name);
  }
  const trackNameByKey = new Map([...spellings].map(([k, names]) => [k, prettiestName(names)]));
  const trackName = (raw) => trackNameByKey.get(normName(raw || "")) || raw || "Unknown";

  const trackMap = new Map();
  for (const r of raced) {
    const name = trackName(r.race.track);
    const k = normName(name);
    let t = trackMap.get(k);
    if (!t) {
      t = { track: name, country: r.race.country || null, starts: 0, wins: 0, podiums: 0, best: null, positions: [], bestLapMs: null, lastSeasonNumber: null };
      trackMap.set(k, t);
    }
    if (r.race.country && !t.country) t.country = r.race.country;
    if (r.status !== "DNS") t.starts += 1;
    if (r.status === "FINISHED" && r.position != null) {
      if (r.position === 1) t.wins += 1;
      if (r.position <= 3) t.podiums += 1;
      if (t.best == null || r.position < t.best) t.best = r.position;
      t.positions.push(r.position);
    }
    if (r.bestLapMs > 0 && (t.bestLapMs == null || r.bestLapMs < t.bestLapMs)) t.bestLapMs = r.bestLapMs;
    const num = seasonById.get(r.race.seasonId)?.number ?? null;
    if (num != null && (t.lastSeasonNumber == null || num > t.lastSeasonNumber)) t.lastSeasonNumber = num;
  }
  const tracks = [...trackMap.values()]
    .map((t) => ({ ...t, avgFinish: avg(t.positions), positions: undefined }))
    .sort((a, b) => b.wins - a.wins || b.podiums - a.podiums || b.starts - a.starts || a.track.localeCompare(b.track));

  // --- teams driven for -----------------------------------------------------
  const teamMap = new Map();
  for (const row of rows) {
    if (!row.team || row.team.tier === 0) continue;
    const k = normName(row.team.name);
    let t = teamMap.get(k);
    if (!t) {
      t = { name: row.team.name, color: row.team.color, logoUrl: row.team.logoUrl, teamId: row.team.id, seasons: [], starts: 0, wins: 0, podiums: 0, points: 0, current: false };
      teamMap.set(k, t);
    }
    const season = seasonById.get(row.seasonId);
    const series = visibleSeries(row.seasonId);
    if (season?.isActive) t.current = true;
    // Two rows of one season (a handle change) are still one season here.
    if (season && series && !t.seasons.some((x) => x.seriesSlug === series.slug && x.seasonNumber === season.number)) {
      t.seasons.push({ seriesSlug: series.slug, seriesName: series.name, seasonNumber: season.number });
    }
    const mine = raced.filter((r) => r.driverId === row.id);
    t.starts += mine.filter((r) => r.status !== "DNS").length;
    t.wins += mine.filter((r) => r.status === "FINISHED" && r.position === 1).length;
    t.podiums += mine.filter((r) => r.status === "FINISHED" && r.position != null && r.position <= 3).length;
    const line = standingsBySeason.get(row.seasonId)?.standings?.find((x) => x.driverId === row.id);
    t.points += line?.total ?? 0;
  }
  const teams = [...teamMap.values()]
    .filter((t) => t.starts > 0 || t.current)
    .sort((a, b) => b.starts - a.starts || b.wins - a.wins);

  // --- team-mate duels, every season, both sides person-resolved -------------
  const { byDriver, byPerson } = await getPersonGroups(prisma);
  const personOf = (id) => byDriver.get(id) || id;
  const mateRows = await prisma.driver.findMany({
    where: {
      seasonId: { in: seasonIds },
      teamId: { in: rows.map((r) => r.teamId).filter(Boolean) },
      id: { notIn: rowIds },
    },
    select: { id: true, name: true, seasonId: true, teamId: true, team: { select: { tier: true, name: true } } },
  });
  const mateIds = mateRows.map((m) => m.id);
  const mateResults = mateIds.length
    ? await withClassifiedPositions(
        prisma,
        await prisma.raceResult.findMany({
          where: { driverId: { in: mateIds }, raceId: { in: [...new Set(raced.map((r) => r.raceId))] } },
          select: { driverId: true, raceId: true, position: true, grid: true, status: true },
        })
      )
    : [];
  const mineByRace = new Map();
  for (const r of raced) mineByRace.set(`${r.driverId}|${r.raceId}`, r);
  const duels = new Map(); // personId -> tally
  for (const m of mateRows) {
    if (!m.team || m.team.tier === 0) continue;
    const myRow = rows.find((r) => r.seasonId === m.seasonId && r.teamId === m.teamId);
    if (!myRow) continue;
    const pid = personOf(m.id);
    let d = duels.get(pid);
    if (!d) {
      d = { driverId: m.id, name: m.name, races: 0, me: 0, them: 0, qualiMe: 0, qualiThem: 0, seasons: new Set() };
      duels.set(pid, d);
    }
    for (const mr of mateResults.filter((x) => x.driverId === m.id)) {
      const mine = mineByRace.get(`${myRow.id}|${mr.raceId}`);
      if (!mine) continue;
      const bothStarted = mine.status !== "DNS" && mr.status !== "DNS";
      if (!bothStarted) continue;
      d.races += 1;
      d.seasons.add(seasonById.get(mine.race.seasonId)?.number ?? null);
      const rank = (r) => (r.status === "FINISHED" && r.position != null ? r.position : Infinity);
      const a = rank(mine);
      const b = rank(mr);
      if (a < b) d.me += 1;
      else if (b < a) d.them += 1;
      if (mine.grid != null && mr.grid != null) {
        if (mine.grid < mr.grid) d.qualiMe += 1;
        else if (mr.grid < mine.grid) d.qualiThem += 1;
      }
    }
  }
  const teammates = [...duels.values()]
    .filter((d) => d.races > 0)
    .map((d) => ({
      driverId: d.driverId,
      name: nameOv.get(d.driverId)?.displayName || d.name,
      races: d.races,
      me: d.me,
      them: d.them,
      qualiMe: d.qualiMe,
      qualiThem: d.qualiThem,
      seasons: [...d.seasons].filter((n) => n != null).sort((a, b) => a - b),
    }))
    .sort((a, b) => b.races - a.races);

  // --- every race, newest first ---------------------------------------------
  // Who set the best lap of each round the person was in: the recorded holder
  // where there is one, the quickest lap of the field otherwise.
  const flByRace = new Map();
  for (const f of await prisma.raceResult.findMany({
    where: { raceId: { in: [...new Set(raced.map((r) => r.raceId))] } },
    select: { raceId: true, driverId: true, bestLapMs: true },
  })) {
    if (!(f.bestLapMs > 0) || f.bestLapMs > 1_800_000) continue;
    const cur = flByRace.get(f.raceId);
    if (!cur || f.bestLapMs < cur.ms) flByRace.set(f.raceId, { driverId: f.driverId, ms: f.bestLapMs });
  }
  for (const [raceId, driverId] of manualFl) flByRace.set(raceId, { driverId, ms: null });

  const lineByRow = new Map(
    rows.map((r) => [r.id, standingsBySeason.get(r.seasonId)?.standings?.find((x) => x.driverId === r.id) || null])
  );
  const isSprint = (r) => sprintParents.has(r.raceId);
  // One pole per ROUND, never one per classification. The qualifying session
  // belongs to the weekend: marking the sprint row as well counted a pole
  // twice, which is why the career total and this list disagreed. Where the
  // feature race has no holder on file, the sprint's grid-1 row is the round's
  // pole (a hand-recorded weekend that starts its sprint from the qualifying
  // order) — the same rule the driver page uses.
  const childOfRound = new Map([...sprintParents].map(([childId, parent]) => [parent.id, childId]));
  const poleOfRound = (raceId) => poleByRace.get(raceId) ?? poleByRace.get(childOfRound.get(raceId)) ?? null;
  const orderOf = (r, date) => {
    const t = date ? new Date(date).getTime() : 0;
    return t || (seasonById.get(r.race.seasonId)?.number ?? 0) * 1000 + (r.race.number ?? 0);
  };
  const races = raced
    .map((r) => {
      const season = seasonById.get(r.race.seasonId);
      const series = visibleSeries(r.race.seasonId);
      const parent = isSprint(r) ? sprintParents.get(r.raceId) || null : null;
      const round = parent ? parent.number : r.race.number;
      const date = parent?.date || r.race.date || null;
      const row = rows.find((x) => x.id === r.driverId);
      // Points come from the standings cell, never the raw row: a round's
      // points are computed from the position and the sprint has its own share.
      const cell = round != null ? lineByRow.get(r.driverId)?.perRace?.[round] : null;
      const points = cell ? (isSprint(r) ? cell.sprint?.points ?? 0 : cell.points - (cell.sprint?.points || 0)) : null;
      return {
        raceId: parent ? parent.id : r.raceId,
        seriesSlug: series?.slug || null,
        seriesName: series?.name || null,
        seasonNumber: season?.number ?? null,
        round,
        track: trackName(parent?.track || r.race.track),
        country: parent?.country || r.race.country || null,
        date,
        sprint: isSprint(r),
        grid: r.grid ?? null,
        position: r.position ?? null,
        status: r.status,
        points,
        bestLapMs: r.bestLapMs ?? null,
        fastestLap: flByRace.get(r.raceId)?.driverId === r.driverId,
        pole: !isSprint(r) && poleOfRound(r.raceId) === r.driverId,
        teamName: row?.team?.name || null,
        teamColor: row?.team?.color || null,
        _order: orderOf(r, date),
        _sprint: isSprint(r) ? 1 : 0,
      };
    })
    .sort(
      (a, b) =>
        b._order - a._order ||
        (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0) ||
        (b.round ?? 0) - (a.round ?? 0) ||
        a._sprint - b._sprint
    )
    .map(({ _order, _sprint, ...r }) => r);

  // --- the firsts and the round numbers worth remembering -------------------
  const chrono = [...races].reverse();
  const milestones = milestonesOf(chrono);

  // --- where the person sits in each league's all-time lists ----------------
  const rankings = [];
  for (const lg of leagueList) {
    const rec = await getSeriesRecords(prisma, lg.slug, { includePrivate }).catch(() => null);
    for (const list of rec?.lists || []) {
      const i = list.rows.findIndex((row) => isMine.has(row.driverId));
      if (i < 0) continue;
      rankings.push({
        seriesSlug: lg.slug,
        seriesName: lg.name,
        key: list.key,
        label: list.label,
        unit: list.unit || "",
        rank: i + 1,
        value: list.rows[i].value,
        of: list.rows.length,
      });
    }
  }
  rankings.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));

  // The flair from the token shop, when the shop is open.
  let flair = null;
  try {
    if (await tokensPublic(prisma)) {
      const discordId = (await discordIdsForDrivers(prisma, rowIds)).get(newest.id);
      if (discordId) flair = (await flairsFor(prisma, [discordId])).get(discordId) || null;
    }
  } catch {
    /* no flair then */
  }

  const current = leagueList
    .map((lg) => {
      const live = lg.seasons.find((s) => s.isActive);
      return live ? { seriesSlug: lg.slug, seriesName: lg.name, seasonNumber: live.seasonNumber, teamName: live.teamName, teamColor: live.teamColor, handle: live.handle, driverId: live.driverId } : null;
    })
    .filter(Boolean);

  // The rating card each league currently shows for this person (null where a
  // league never rated them, e.g. seasons raced before the telemetry).
  const ratings = [];
  for (const lg of leagueList) {
    const newestOfLeague = lg.seasons.find((x) => x.starts > 0) || lg.seasons[0];
    if (!newestOfLeague) continue;
    const card = await getCardRating(prisma, newestOfLeague.seasonId, newestOfLeague.driverId).catch(() => null);
    if (card?.ratings) {
      ratings.push({
        seriesSlug: lg.slug,
        seriesName: lg.name,
        seasonNumber: newestOfLeague.seasonNumber,
        teamColor: newestOfLeague.teamColor,
        ...card.ratings,
      });
    }
  }

  const numbers = [...new Set(rows.map((r) => r.number).filter((n) => n != null))];
  const allSeasonNumbers = leagueList.flatMap((l) => l.seasons.filter((s) => s.starts > 0).map((s) => s.seasonNumber));

  return {
    person: {
      key: driverHandle(ov?.displayName || newest.name),
      name: ov?.displayName || newest.name,
      formerName: ov?.formerName || null,
      country: newest.country || idov?.country || null,
      number: numbers[0] ?? null,
      photoUrl: personPhotoFor(pictures, idov),
      photoFallbacks: photoFallbacksFor(pictures, idov, { card: false }),
      bio: newest.bio || null,
      socials: parseSocials(newest.socials),
      flair,
      current,
    },
    span: {
      seasonsRaced,
      leagues: leagueList.length,
      firstSeason: allSeasonNumbers.length ? Math.min(...allSeasonNumbers) : null,
      lastSeason: allSeasonNumbers.length ? Math.max(...allSeasonNumbers) : null,
      firstRace: chrono[0] || null,
      lastRace: races[0] || null,
    },
    totals: { ...totals, points: pointsAllTime },
    titles,
    ratings,
    leagues: leagueList,
    teams,
    tracks,
    teammates,
    milestones,
    rankings,
    races,
  };
}
