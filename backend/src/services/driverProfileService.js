// ---------------------------------------------------------------------------
// Per-driver career profile: aggregates a driver's results across all completed
// races into the rich stats shown on the driver profile page. Official points
// and championship position come from the standings service (single source of
// truth); finishing-order extras (grid, best lap, positions gained) come from
// the per-result metadata stored at import/seed time.
// ---------------------------------------------------------------------------
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "./standingsService.js";
import { parseSocials } from "../lib/socials.js";
import { getLinkedDriverIds, getNameOverrides, getIdentityOverrides } from "../lib/persons.js";
import { getActiveSeason } from "./seasonService.js";
import { seasonSeriesMap, dbListSeries } from "../lib/series.js";
import { telemetryForDriver } from "../lib/telemetryRead.js";
import { readProfileTiles } from "../lib/profileTiles.js";
import { readCardPhotoPos, parseCardPhotoPos } from "../lib/cardPhoto.js";
import { readDriverRoles } from "../lib/driverRoles.js";
import { isSeasonComplete, seasonConcluded } from "../lib/seasonComplete.js";
import { readCardEdition, readCardAnim } from "../lib/cardEditions.js";
import { achievementMeta } from "../lib/achievements.js";

function avg(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

// Laps beyond 30 minutes are import artefacts, not real flying laps.
const MAX_LAP_MS = 1_800_000;
const isLap = (ms) => ms != null && ms > 0 && ms <= MAX_LAP_MS;

// How many of the given result rows held their RACE's overall fastest lap —
// i.e. the number of rounds where this driver set the fastest lap of anyone.
// Needs the full field per race (a driver's own rows only know their own
// laps), so it loads every result of the races involved. Ties count for both.
async function countFastestLaps(prisma, ownRows) {
  const withLap = ownRows.filter((r) => isLap(r.bestLapMs));
  const raceIds = [...new Set(withLap.map((r) => r.raceId))];
  if (!raceIds.length) return 0;
  const field = await prisma.raceResult.findMany({
    where: { raceId: { in: raceIds } },
    select: { raceId: true, bestLapMs: true },
  });
  const minByRace = new Map();
  for (const r of field) {
    if (!isLap(r.bestLapMs)) continue;
    const m = minByRace.get(r.raceId);
    if (m == null || r.bestLapMs < m) minByRace.set(r.raceId, r.bestLapMs);
  }
  return withLap.filter((r) => r.bestLapMs === minByRace.get(r.raceId)).length;
}

// All-time stats across a person's linked driver rows — the same shape as the
// per-season `stats` object, so the profile's stat tiles can swap between the
// two with a toggle. Only built when a career exists (driver linked across
// seasons); private seasons and special events are excluded, exactly like the
// career table. Telemetry keys stay null-safe: seasons without telemetry simply
// don't contribute, and if NO round has any, the telemetry tiles hide.
// `seasonFilter`, when given, is a Set of the seasonIds that may contribute —
// used by the card editions to cap the career at "seasons <= N of this series"
// while everything else keeps the full all-time view.
async function buildAllTimeStats(prisma, linkedIds, privateSeasonIds, seasonFilter = null) {
  const results = await prisma.raceResult.findMany({
    where: { driverId: { in: linkedIds } },
    include: { race: { select: { seasonId: true, isSpecialEvent: true, isCompleted: true, track: true, number: true } } },
  });
  const rows = results.filter(
    (r) =>
      r.race &&
      !r.race.isSpecialEvent &&
      r.race.isCompleted &&
      r.race.seasonId &&
      !privateSeasonIds.has(r.race.seasonId) &&
      (!seasonFilter || seasonFilter.has(r.race.seasonId))
  );

  const starts = rows.filter((r) => r.status !== "DNS");
  const finishes = starts.filter((r) => r.status === "FINISHED" && r.position != null);
  const finishPositions = finishes.map((r) => r.position);
  const gained = finishes
    .filter((r) => r.grid != null && r.position != null)
    .map((r) => r.grid - r.position);
  const wins = finishes.filter((r) => r.position === 1).length;
  const podiums = finishes.filter((r) => r.position <= 3).length;

  let fastest = null;
  for (const r of rows) {
    if (r.bestLapMs && (!fastest || r.bestLapMs < fastest.bestLapMs)) {
      fastest = { bestLapMs: r.bestLapMs, track: r.race.track, number: r.race.number };
    }
  }
  const fastestLaps = await countFastestLaps(prisma, rows);

  // Telemetry across every linked row (per-driver reads, merged).
  let overtakesTotal = 0, contactsTotal = 0, lapsLedTotal = 0, consNum = 0, consDen = 0, gamePenSecTotal = 0;
  let anyTelemetry = false;
  for (const id of linkedIds) {
    const tel = await telemetryForDriver(prisma, id);
    for (const t of tel.values()) {
      if (t.overtakes != null) { overtakesTotal += t.overtakes; anyTelemetry = true; }
      if (t.contacts != null) { contactsTotal += t.contacts; anyTelemetry = true; }
      if (t.lapsLed != null) { lapsLedTotal += t.lapsLed; anyTelemetry = true; }
      if (t.gamePenaltySeconds != null) gamePenSecTotal += t.gamePenaltySeconds;
      if (t.consistencyMs != null && t.cleanLaps) { consNum += t.consistencyMs * t.cleanLaps; consDen += t.cleanLaps; }
    }
  }

  // "In the points": stored official points where present, else the position
  // against the default table — close enough for a cross-season counter.
  const scored = rows.filter((r) =>
    r.points != null ? r.points > 0 : r.status === "FINISHED" && r.position != null && r.position <= 18
  ).length;

  return {
    starts: starts.length,
    finishes: finishes.length,
    wins,
    podiums,
    top5: finishes.filter((r) => r.position <= 5).length,
    top10: finishes.filter((r) => r.position <= 10).length,
    pointsFinishes: scored,
    dnf: starts.filter((r) => r.status === "DNF").length,
    dsq: starts.filter((r) => r.status === "DSQ").length,
    bestFinish: finishPositions.length ? Math.min(...finishPositions) : null,
    worstFinish: finishPositions.length ? Math.max(...finishPositions) : null,
    avgFinish: avg(finishPositions),
    bestGrid: starts.some((r) => r.grid != null)
      ? Math.min(...starts.filter((r) => r.grid != null).map((r) => r.grid))
      : null,
    polePositions: starts.filter((r) => r.grid === 1).length,
    avgGrid: avg(starts.filter((r) => r.grid != null).map((r) => r.grid)),
    positionsGained: gained.length ? gained.reduce((a, b) => a + b, 0) : 0,
    winRate: starts.length ? Math.round((wins / starts.length) * 100) : 0,
    podiumRate: starts.length ? Math.round((podiums / starts.length) * 100) : 0,
    fastestLap: fastest,
    fastestLaps,
    overtakes: anyTelemetry ? overtakesTotal : null,
    contacts: anyTelemetry ? contactsTotal : null,
    lapsLed: anyTelemetry ? lapsLedTotal : null,
    avgConsistencyMs: consDen ? Math.round(consNum / consDen) : null,
    gamePenaltySeconds: anyTelemetry ? Math.round(gamePenSecTotal * 10) / 10 : null,
    stewardPenaltySeconds: rows.reduce((s, r) => s + (r.penaltySeconds || 0), 0),
  };
}

// Career summary across a person's linked driver rows (other seasons). Excludes
// private seasons so a public profile never leaks an unpublished season. Since
// the series model the career table is scoped to the profile row's OWN series
// (season numbers only mean something inside one series); the person's other
// series come back as a compact per-series summary for the "all series" look.
// Returns { career, otherSeries } — career null when the driver isn't linked
// to any other season of this series, otherSeries null when the person races
// nowhere else.
async function buildCareer(prisma, driverId, ownSeasonId, ownStandings) {
  const linkedIds = await getLinkedDriverIds(prisma, driverId);
  if (linkedIds.length < 2) return { career: null, otherSeries: null };
  const [linkedDrivers, privateRows, bySeries, allSeries] = await Promise.all([
    prisma.driver.findMany({ where: { id: { in: linkedIds } }, include: { team: true, season: true } }),
    prisma.$queryRawUnsafe(`SELECT "id" FROM "Season" WHERE "isPublic" = 0`).catch(() => []),
    seasonSeriesMap(prisma),
    dbListSeries(prisma, { includePrivate: true }),
  ]);
  const privateSeasonIds = new Set(privateRows.map((r) => r.id));
  const ownSeriesId = bySeries.get(ownSeasonId) ?? null;
  const seriesById = new Map(allSeries.map((s) => [s.id, s]));

  const seasons = [];
  const foreign = new Map(); // seriesId -> accumulating summary of OTHER series
  for (const ld of linkedDrivers) {
    if (!ld.seasonId || privateSeasonIds.has(ld.seasonId)) continue;
    const st = ld.seasonId === ownSeasonId ? ownStandings : await getDriverStandings(prisma, ld.seasonId);
    const row = st.standings.find((r) => r.driverId === ld.id);
    if (!row) continue;
    const rounds = Object.values(row.perRace || {});
    const finishes = rounds.filter((v) => v.status === "FINISHED" && v.position != null);
    const line = {
      driverId: ld.id,
      seasonNumber: ld.season?.number ?? null,
      seasonName: ld.season?.name ?? null,
      isCurrent: ld.seasonId === ownSeasonId,
      teamName: ld.team?.name ?? null,
      teamColor: ld.team?.color ?? null,
      position: row.position ?? null,
      points: row.total ?? 0,
      starts: rounds.filter((v) => v.status !== "DNS").length,
      wins: finishes.filter((v) => v.position === 1).length,
      podiums: finishes.filter((v) => v.position <= 3).length,
    };
    const seriesId = bySeries.get(ld.seasonId) ?? null;
    if (seriesId === ownSeriesId) {
      seasons.push(line);
    } else {
      // A season in ANOTHER series: folded into that series' summary line.
      // Hidden series (private, non-admin readers can't browse them anyway)
      // still count into the numbers but stay unnamed for safety.
      const series = seriesById.get(seriesId);
      if (series && !series.isPublic) continue;
      const acc = foreign.get(seriesId) || {
        seriesSlug: series?.slug ?? null,
        seriesName: series?.name ?? "Other series",
        seasons: 0,
        points: 0,
        starts: 0,
        wins: 0,
        podiums: 0,
        bestPosition: null,
      };
      acc.seasons += 1;
      acc.points += line.points;
      acc.starts += line.starts;
      acc.wins += line.wins;
      acc.podiums += line.podiums;
      if (line.position != null && line.starts > 0) {
        acc.bestPosition = acc.bestPosition == null ? line.position : Math.min(acc.bestPosition, line.position);
      }
      foreign.set(seriesId, acc);
    }
  }
  const otherSeries = foreign.size ? [...foreign.values()] : null;
  // One person can have TWO rows in the SAME season (e.g. started as a reserve,
  // then took over a seat under a new Discord handle). Fold those into a single
  // season line: totals add up, the row with more points is the "main" entry
  // (its profile link, colour and position), and every team they drove for is
  // named. Without this a handle change mid-season shows the season twice.
  const bySeason = new Map();
  for (const s of seasons) {
    const key = s.seasonNumber ?? `row-${s.driverId}`;
    const prev = bySeason.get(key);
    if (!prev) {
      bySeason.set(key, s);
      continue;
    }
    const main = s.points > prev.points || (s.points === prev.points && s.starts > prev.starts) ? s : prev;
    const teams = [...new Set([prev.teamName, s.teamName].filter(Boolean))];
    const positions = [prev, s].filter((r) => r.position != null && r.starts > 0).map((r) => r.position);
    bySeason.set(key, {
      ...main,
      teamName: teams.length ? teams.join(" / ") : null,
      position: positions.length ? Math.min(...positions) : null,
      points: prev.points + s.points,
      starts: prev.starts + s.starts,
      wins: prev.wins + s.wins,
      podiums: prev.podiums + s.podiums,
      isCurrent: prev.isCurrent || s.isCurrent,
    });
  }
  const merged = [...bySeason.values()];
  // Nothing to aggregate: a single row that didn't fold anything in.
  if (merged.length < 2 && merged.length === seasons.length) {
    return { career: null, otherSeries };
  }
  merged.sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0));
  const totals = merged.reduce(
    (t, s) => ({
      seasons: t.seasons + 1,
      points: t.points + s.points,
      starts: t.starts + s.starts,
      wins: t.wins + s.wins,
      podiums: t.podiums + s.podiums,
    }),
    { seasons: 0, points: 0, starts: 0, wins: 0, podiums: 0 }
  );
  return { career: { seasons: merged, totals }, otherSeries };
}

// Everything unlockStateFor (lib/cardEditions.js) needs to judge one driver
// row's card editions: the row's season number N, the person's career stats
// capped at seasons <= N of THIS series, and the person's podium/team seals
// (own series, live-complete rule). Milestone stats are person-wide (linked
// rows) so "50 starts" survives a season/handle change; titles stay per-season.
export async function cardUnlockInputs(prisma, driverId) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, include: { season: true } });
  if (!driver) return null;
  const n = driver.season?.number ?? null;
  const ownSeasonId = driver.seasonId;

  const [linkedIdsAll, bySeriesMap, privateRows] = await Promise.all([
    getLinkedDriverIds(prisma, driverId),
    seasonSeriesMap(prisma),
    prisma.$queryRawUnsafe(`SELECT "id" FROM "Season" WHERE "isPublic" = 0`).catch(() => []),
  ]);
  const ownSeriesId = bySeriesMap.get(ownSeasonId) ?? null;
  const privateSeasonIds = new Set(privateRows.map((r) => r.id));

  // The person's rows in THIS series (public seasons) with their season numbers.
  const linkedRows =
    linkedIdsAll.length > 1
      ? await prisma.driver.findMany({ where: { id: { in: linkedIdsAll } }, include: { team: true, season: true } })
      : [driver.team ? driver : await prisma.driver.findUnique({ where: { id: driverId }, include: { team: true, season: true } })];
  const ownSeriesRows = linkedRows.filter(
    (r) => (bySeriesMap.get(r.seasonId) ?? null) === ownSeriesId && !privateSeasonIds.has(r.seasonId)
  );

  // Milestone stats: person-wide over seasons <= N of this series.
  const seasonFilter = new Set(
    ownSeriesRows.filter((r) => (r.season?.number ?? Infinity) <= (n ?? -Infinity)).map((r) => r.seasonId)
  );
  const rawStats = await buildAllTimeStats(
    prisma,
    ownSeriesRows.map((r) => r.id),
    privateSeasonIds,
    seasonFilter
  );
  const stats = {
    starts: rawStats.starts,
    wins: rawStats.wins,
    podiums: rawStats.podiums,
    poles: rawStats.polePositions,
  };

  // Titles: the person's driver + team podium seals, per season, using the same
  // live-complete rule as the profile shelf (a title counts once its season is
  // done). Passed UNFILTERED — unlockStateFor matches the season number itself.
  const active = await getActiveSeason(prisma, ownSeriesId);
  const activeComplete = active ? await isSeasonComplete(prisma, active.id) : false;
  const isConcluded = (num) => seasonConcluded(num, active?.number ?? null, activeComplete);

  const BADGE_TYPE = { 1: "champion", 2: "vice", 3: "third" };
  const badges = [];
  const teamBadges = [];
  for (const row of ownSeriesRows) {
    const num = row.season?.number ?? null;
    if (num == null || !isConcluded(num)) continue;
    const dst = await getDriverStandings(prisma, row.seasonId);
    const drow = dst.standings.find((x) => x.driverId === row.id);
    if (drow && drow.position >= 1 && drow.position <= 3) {
      badges.push({ type: BADGE_TYPE[drow.position], position: drow.position, seasonNumber: num });
    }
    const tier = row.team?.tier;
    if (tier === 1 || tier === 2) {
      const table = await (tier === 1 ? getT1ConstructorStandings : getT2ConstructorStandings)(prisma, row.seasonId);
      const trow = (table?.standings || []).find((t) => t.teamId === row.team.id);
      if (trow && trow.position >= 1 && trow.position <= 3) {
        teamBadges.push({ position: trow.position, seasonNumber: num });
      }
    }
  }

  return { seasonNumber: n, stats, badges, teamBadges };
}

export async function getDriverProfile(prisma, driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { team: true, season: true },
  });
  if (!driver) return null;

  // A driver entry belongs to one season; their stats are scoped to it.
  const seasonId = driver.seasonId;
  const [standings, races, results, telemetry, nameOverrides, profileTiles, photoPos, identityOverrides] = await Promise.all([
    getDriverStandings(prisma, seasonId),
    prisma.race.findMany({
      where: { seasonId, isSpecialEvent: false, isCompleted: true },
      orderBy: { number: "asc" },
    }),
    prisma.raceResult.findMany({ where: { driverId } }),
    telemetryForDriver(prisma, driverId),
    getNameOverrides(prisma),
    readProfileTiles(prisma, driverId),
    readCardPhotoPos(prisma, driverId),
    getIdentityOverrides(prisma),
  ]);
  // Person identity fallback: an archive row without its own picture/flag shows
  // the person's CURRENT ones (and the matching card framing), so a driver
  // looks the same in every season they raced. Own values always win.
  const idov = identityOverrides.get(driverId);
  const ownPhoto = driver.photoUrl || driver.discordAvatar || null;
  const effPhotoUrl = ownPhoto || idov?.photoUrl || null;
  const effPhotoPos = ownPhoto ? photoPos : parseCardPhotoPos(idov?.photoPos) || photoPos;
  // Optional card-only picture for THIS row (raw column). null -> the card
  // falls back to the profile photo (RatingCard handles the fallback).
  const cardPhotoUrl = (
    await prisma.$queryRaw`SELECT "cardPhotoUrl" FROM "Driver" WHERE "id" = ${driverId}`.catch(() => [])
  )[0]?.cardPhotoUrl || null;

  // Achievements the driver pinned in their Cockpit (validated at save time,
  // so showing them is just a key -> catalogue lookup). Raw column; [].
  const pinnedAchievements = await prisma
    .$queryRaw`SELECT "achievementsPinned" FROM "Driver" WHERE "id" = ${driverId}`
    .then((rows) => {
      const parsed = rows[0]?.achievementsPinned ? JSON.parse(rows[0].achievementsPinned) : null;
      return (Array.isArray(parsed) ? parsed : [])
        .map((key) => achievementMeta(key))
        .filter(Boolean)
        .map((a) => ({ key: a.key, cat: a.cat, name: a.name, tagline: a.tagline }));
    })
    .catch(() => []);

  const standingRow = standings.standings.find((r) => r.driverId === driverId);
  const resultByRaceId = new Map(results.map((r) => [r.raceId, r]));
  const nameOv = nameOverrides.get(driverId);
  const { career, otherSeries } = await buildCareer(prisma, driverId, seasonId, standings);

  // Linked rows + private seasons are shared by the all-time stats and both
  // badge shelves below, so resolve them once. Everything here is scoped to
  // the profile row's OWN series (default view "pro Serie"); the person's
  // other series appear only in the compact otherSeries summary above.
  const [linkedIdsAll, bySeriesMap] = await Promise.all([
    getLinkedDriverIds(prisma, driverId),
    seasonSeriesMap(prisma),
  ]);
  const ownSeriesId = bySeriesMap.get(seasonId) ?? null;
  const linkedSeasonRows =
    linkedIdsAll.length > 1
      ? await prisma.driver.findMany({
          where: { id: { in: linkedIdsAll } },
          select: { id: true, seasonId: true },
        })
      : [{ id: driverId, seasonId }];
  const linkedIds = linkedSeasonRows
    .filter((r) => (bySeriesMap.get(r.seasonId) ?? null) === ownSeriesId)
    .map((r) => r.id);
  const privateSeasonRows = await prisma
    .$queryRawUnsafe(`SELECT "id" FROM "Season" WHERE "isPublic" = 0`)
    .catch(() => []);
  const privateSeasonIds = new Set(privateSeasonRows.map((r) => r.id));

  // All-time stats power the Season ⇄ All-time toggle on the profile's stat
  // tiles — only when the driver actually spans more than one season of THIS
  // series (matching the career table next to it).
  let allTime = null;
  if (career) {
    allTime = await buildAllTimeStats(prisma, linkedIds, privateSeasonIds);
  }

  // Podium badges — earned, never assigned: one seal per CONCLUDED season this
  // person finished in the championship top three (gold P1, silver P2, bronze
  // P3). A season counts as concluded when it lies behind the active one OF
  // THIS SERIES, or when it's the live season and every championship round
  // has been run. Linked seasons come via the career block (own series), so
  // seals follow the person across handle changes. One seal per season (the
  // best result wins).
  const [activeSeasonRow, seasonMeta] = await Promise.all([
    getActiveSeason(prisma, ownSeriesId),
    prisma.season.findMany({ select: { id: true, number: true, game: true } }),
  ]);
  // A season's honours (podium seals) show as soon as it's COMPLETE — every
  // championship round run — not only once the next season starts (see
  // lib/seasonComplete.js). The reigning champion gets their seal on the day of
  // the finale. Only the active season needs the live check; archived seasons
  // are always behind it.
  const activeComplete = activeSeasonRow ? await isSeasonComplete(prisma, activeSeasonRow.id) : false;
  const concluded = (num) => seasonConcluded(num, activeSeasonRow?.number ?? null, activeComplete);
  // Season numbers only mean something inside one series -> the game lookup
  // for badge popovers is restricted to this series' seasons.
  const gameByNumber = new Map(
    seasonMeta
      .filter((s) => (bySeriesMap.get(s.id) ?? null) === ownSeriesId)
      .map((s) => [s.number, s.game || null])
  );
  const BADGE_TYPE = { 1: "champion", 2: "vice", 3: "third" };
  const badgeBySeason = new Map();
  const addBadge = (position, num, name, points) => {
    const type = BADGE_TYPE[position];
    if (!type || num == null) return;
    const existing = badgeBySeason.get(num);
    if (existing && existing.position <= position) return;
    badgeBySeason.set(num, {
      type,
      position,
      seasonNumber: num,
      seasonName: name || `Season ${num}`,
      // Popover extras: which game it was earned in, and the final score.
      game: gameByNumber.get(num) ?? null,
      points: Number.isFinite(points) ? points : null,
    });
  };
  const ownSeasonNumber = driver.season?.number ?? null;
  const ownConcluded = concluded(ownSeasonNumber);
  if (ownConcluded && standingRow?.position >= 1 && standingRow.position <= 3) {
    addBadge(standingRow.position, ownSeasonNumber, driver.season?.name, standingRow.total);
  }
  for (const s of career?.seasons || []) {
    if (s.position >= 1 && s.position <= 3 && s.starts > 0 && concluded(s.seasonNumber)) {
      addBadge(s.position, s.seasonNumber, s.seasonName, s.points);
    }
  }
  const badges = [...badgeBySeason.values()].sort((a, b) => a.seasonNumber - b.seasonNumber);

  // Team podium seals — the constructor twin of the driver seals: one per
  // concluded season in which this person's roster team finished its own
  // tier's constructor championship in the top three ("Season 7 · Williams ·
  // Teams P3"). Linked rows carry the seals across handle changes, exactly
  // like the driver shelf; private seasons and the reserve pool (no tier-1/2
  // team) never produce one.
  const linkedRows =
    linkedIds.length > 1
      ? await prisma.driver.findMany({
          where: { id: { in: linkedIds } },
          include: { team: true, season: true },
        })
      : [driver];
  const constructorCache = new Map();
  const constructorTable = async (sid, tier) => {
    const key = `${sid}:${tier}`;
    if (!constructorCache.has(key)) {
      const fn = tier === 1 ? getT1ConstructorStandings : getT2ConstructorStandings;
      constructorCache.set(key, await fn(prisma, sid));
    }
    return constructorCache.get(key);
  };
  const teamBadgeBySeason = new Map();
  for (const row of linkedRows) {
    if (!row.seasonId || !row.team || privateSeasonIds.has(row.seasonId)) continue;
    const num = row.season?.number ?? null;
    const tier = row.team.tier;
    if (num == null || (tier !== 1 && tier !== 2)) continue;
    // Same "concluded" rule as the driver seals: seasons behind the active
    // one, or the active season once every round has been run.
    if (!concluded(num)) continue;
    const table = await constructorTable(row.seasonId, tier);
    const trow = (table?.standings || []).find((t) => t.teamId === row.team.id);
    const pos = trow?.position;
    if (!trow || !(pos >= 1 && pos <= 3)) continue;
    const existing = teamBadgeBySeason.get(num);
    if (existing && existing.position <= pos) continue;
    teamBadgeBySeason.set(num, {
      type: BADGE_TYPE[pos],
      position: pos,
      seasonNumber: num,
      seasonName: row.season?.name || `Season ${num}`,
      game: gameByNumber.get(num) ?? null,
      points: Number.isFinite(trow.total) ? trow.total : null,
      team: { id: row.team.id, name: row.team.name, color: row.team.color, logoUrl: row.team.logoUrl },
    });
  }
  const teamBadges = [...teamBadgeBySeason.values()].sort((a, b) => a.seasonNumber - b.seasonNumber);

  // One row per completed championship round, in calendar order. Rounds the
  // driver wasn't entered in still appear (status "DNS", 0 points) so the season
  // form and race-by-race show the whole campaign with the line simply carrying
  // over the gap — instead of those rounds vanishing from the chart entirely.
  const perRace = races.map((race) => {
    const r = resultByRaceId.get(race.id);
    const official = standingRow?.perRace?.[race.number];
    const tel = r ? telemetry.get(race.id) : null;
    if (!r) {
      return {
        raceId: race.id,
        number: race.number,
        track: race.track,
        position: null,
        grid: null,
        status: "DNS",
        points: official ? official.points : 0,
        bestLapMs: null,
      };
    }
    return {
      raceId: race.id,
      number: race.number,
      track: race.track,
      position: r.position,
      grid: r.grid,
      status: r.status,
      points: official ? official.points : 0,
      bestLapMs: r.bestLapMs,
      penaltySeconds: r.penaltySeconds || 0,
      overtakes: tel?.overtakes ?? null,
      contacts: tel?.contacts ?? null,
      envContacts: tel?.envContacts ?? null,
      cuts: tel?.cuts ?? null,
      gamePenalties: tel?.gamePenalties ?? null,
    };
  });

  // Telemetry aggregates over the driver's actual result rows (null-safe: only
  // rounds with imported telemetry contribute; consistency is clean-lap weighted).
  let overtakesTotal = 0;
  let contactsTotal = 0;
  let lapsLedTotal = 0;
  let envTotal = 0;
  let cutsTotal = 0;
  let gamePenTotal = 0;
  let gamePenSecTotal = 0;
  let consNum = 0;
  let consDen = 0;
  let anyTelemetry = false;
  for (const r of results) {
    const t = telemetry.get(r.raceId);
    if (!t) continue;
    if (t.overtakes != null) { overtakesTotal += t.overtakes; anyTelemetry = true; }
    if (t.contacts != null) { contactsTotal += t.contacts; anyTelemetry = true; }
    if (t.lapsLed != null) { lapsLedTotal += t.lapsLed; anyTelemetry = true; }
    if (t.envContacts != null) envTotal += t.envContacts;
    if (t.cuts != null) cutsTotal += t.cuts;
    if (t.gamePenalties != null) gamePenTotal += t.gamePenalties;
    if (t.gamePenaltySeconds != null) gamePenSecTotal += t.gamePenaltySeconds;
    if (t.consistencyMs != null && t.cleanLaps) { consNum += t.consistencyMs * t.cleanLaps; consDen += t.cleanLaps; }
  }
  const stewardPenaltySeconds = results.reduce((s, r) => s + (r.penaltySeconds || 0), 0);

  const starts = perRace.filter((r) => r.status !== "DNS");
  const finishes = starts.filter((r) => r.status === "FINISHED" && r.position != null);
  const finishPositions = finishes.map((r) => r.position);
  const gained = finishes
    .filter((r) => r.grid != null && r.position != null)
    .map((r) => r.grid - r.position);

  // Fastest lap across the season: personal best (for the tile's subtitle) and
  // the count of rounds where this driver set the race's overall fastest lap.
  let fastest = null;
  for (const r of perRace) {
    if (r.bestLapMs && (!fastest || r.bestLapMs < fastest.bestLapMs)) {
      fastest = { bestLapMs: r.bestLapMs, track: r.track, number: r.number };
    }
  }
  const seasonRaceIds = new Set(races.map((r) => r.id));
  const fastestLaps = await countFastestLaps(
    prisma,
    results.filter((r) => seasonRaceIds.has(r.raceId))
  );

  const wins = finishes.filter((r) => r.position === 1).length;
  const podiums = finishes.filter((r) => r.position <= 3).length;

  return {
    driver: {
      id: driver.id,
      name: nameOv?.displayName || driver.name,
      formerName: nameOv?.formerName || null,
      // The season this row belongs to, so race links can steer the Races
      // page to the right season even when the visitor is viewing another one.
      seasonNumber: driver.season?.number ?? null,
      discordName: driver.discordName,
      tier: driver.tier,
      isActive: driver.isActive,
      country: driver.country || idov?.country || null,
      number: driver.number ?? null,
      photoUrl: effPhotoUrl,
      // How the picture sits on the rating card (null = default framing).
      photoPos: effPhotoPos,
      // The unlockable card edition chosen for THIS row (null = classic). Per
      // row, not person-inherited like the photo — an award of this season.
      cardStyle: await readCardEdition(prisma, driverId),
      // Card animation switch ("off" = a still card; null = baseline motion).
      cardAnim: await readCardAnim(prisma, driverId),
      // Optional card-only picture (null = the card uses photoUrl above).
      cardPhotoUrl,
      socials: parseSocials(driver.socials),
      // Self-written "about me" line and the driver's pick of headline stat
      // tiles (null = show all) — both self-service on /profile.
      bio: driver.bio || null,
      profileTiles,
      // Special league role ('safety' = safety car driver) — drives the role
      // badge on the profile and the SAFETY CAR rating card variant.
      role: (await readDriverRoles(prisma, [driver.id])).get(driver.id) || null,
      team: { id: driver.team.id, name: driver.team.name, color: driver.team.color, tier: driver.team.tier, logoUrl: driver.team.logoUrl },
    },
    // Cross-season career within this row's series (null unless this driver is
    // linked to other seasons of the same series).
    career,
    // Compact per-series summary of the person's OTHER series (null when they
    // race only here) — the optional "across all series" look.
    otherSeries,
    // Same shape as `stats`, aggregated across every linked season (null when
    // there's only one season — the toggle then has nothing to switch to).
    allTime,
    // Achievements pinned from the private Cockpit: [{ key, name, tagline }].
    pinnedAchievements,
    // Earned championship seals: [{ type, seasonNumber, seasonName }].
    badges,
    // Constructor seals for the teams this person drove for: [{ type,
    // position, seasonNumber, seasonName, game, points, team }].
    teamBadges,
    // The "P1 of 68" line speaks about people who FINISHED at least one race
    // this season — the roster also carries every sign-up, reserve and
    // DNF-only outing, and none of those should inflate the field. The rank is
    // recomputed within that group (same order as the standings); a driver
    // without a single finish gets no position at all.
    championship: (() => {
      let raced = standings.standings.filter((row) =>
        Object.values(row.perRace || {}).some((v) => v && v.status === "FINISHED")
      );
      // Future-proofing: a season stored ONLY as official totals (points on
      // the board but no per-race rows to detect finishes from) already IS the
      // official classification — fall back to the full table there. A season
      // that simply hasn't raced yet (no finishes, no points) stays empty:
      // fieldSize 0, no position, and the page says "no races yet".
      if (raced.length === 0 && standings.standings.some((r) => r.total > 0)) {
        raced = standings.standings;
      }
      const rank = raced.findIndex((row) => row.driverId === driverId) + 1;
      return {
        position: rank > 0 ? rank : null,
        points: standingRow?.total ?? 0,
        fieldSize: raced.length,
      };
    })(),
    // The full standings of THIS driver's own season, so the profile page's
    // head-to-head and drop-round logic use the driver's actual season — not
    // whatever season the site's switcher happens to be on (a driver reached
    // from an archived season otherwise wouldn't be found in the current one).
    season: {
      standings: standings.standings,
      raceNumbers: standings.raceNumbers,
      dropWorst: standings.dropWorst,
      officialTotals: standings.officialTotals,
    },
    stats: {
      starts: starts.length,
      finishes: finishes.length,
      wins,
      podiums,
      top5: finishes.filter((r) => r.position <= 5).length,
      top10: finishes.filter((r) => r.position <= 10).length,
      pointsFinishes: perRace.filter((r) => r.points > 0).length,
      dnf: starts.filter((r) => r.status === "DNF").length,
      dsq: starts.filter((r) => r.status === "DSQ").length,
      bestFinish: finishPositions.length ? Math.min(...finishPositions) : null,
      worstFinish: finishPositions.length ? Math.max(...finishPositions) : null,
      avgFinish: avg(finishPositions),
      bestGrid: starts.some((r) => r.grid != null) ? Math.min(...starts.filter((r) => r.grid != null).map((r) => r.grid)) : null,
      polePositions: starts.filter((r) => r.grid === 1).length,
      avgGrid: avg(starts.filter((r) => r.grid != null).map((r) => r.grid)),
      positionsGained: gained.length ? gained.reduce((a, b) => a + b, 0) : 0,
      winRate: starts.length ? Math.round((wins / starts.length) * 100) : 0,
      podiumRate: starts.length ? Math.round((podiums / starts.length) * 100) : 0,
      fastestLap: fastest,
      fastestLaps,
      // AC telemetry aggregates (null when no round has telemetry yet, so the
      // profile hides these tiles for position-only archive seasons).
      overtakes: anyTelemetry ? overtakesTotal : null,
      contacts: anyTelemetry ? contactsTotal : null,
      lapsLed: anyTelemetry ? lapsLedTotal : null,
      envContacts: anyTelemetry ? envTotal : null,
      cuts: anyTelemetry ? cutsTotal : null,
      gamePenalties: anyTelemetry ? gamePenTotal : null,
      gamePenaltySeconds: anyTelemetry ? Math.round(gamePenSecTotal * 10) / 10 : null,
      stewardPenaltySeconds,
      avgConsistencyMs: consDen ? Math.round(consNum / consDen) : null,
    },
    perRace,
  };
}
