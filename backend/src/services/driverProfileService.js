// ---------------------------------------------------------------------------
// Per-driver career profile: aggregates a driver's results across all completed
// races into the rich stats shown on the driver profile page. Official points
// and championship position come from the standings service (single source of
// truth); finishing-order extras (grid, best lap, positions gained) come from
// the per-result metadata stored at import/seed time.
// ---------------------------------------------------------------------------
import { getDriverStandings } from "./standingsService.js";
import { parseSocials } from "../lib/socials.js";
import { getLinkedDriverIds, getNameOverrides, getIdentityOverrides } from "../lib/persons.js";
import { telemetryForDriver } from "../lib/telemetryRead.js";
import { readProfileTiles } from "../lib/profileTiles.js";
import { readCardPhotoPos, parseCardPhotoPos } from "../lib/cardPhoto.js";
import { readDriverRoles } from "../lib/driverRoles.js";

function avg(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

// All-time stats across a person's linked driver rows — the same shape as the
// per-season `stats` object, so the profile's stat tiles can swap between the
// two with a toggle. Only built when a career exists (driver linked across
// seasons); private seasons and special events are excluded, exactly like the
// career table. Telemetry keys stay null-safe: seasons without telemetry simply
// don't contribute, and if NO round has any, the telemetry tiles hide.
async function buildAllTimeStats(prisma, linkedIds, privateSeasonIds) {
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
      !privateSeasonIds.has(r.race.seasonId)
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

  // Telemetry across every linked row (per-driver reads, merged).
  let overtakesTotal = 0, contactsTotal = 0, consNum = 0, consDen = 0, gamePenSecTotal = 0;
  let anyTelemetry = false;
  for (const id of linkedIds) {
    const tel = await telemetryForDriver(prisma, id);
    for (const t of tel.values()) {
      if (t.overtakes != null) { overtakesTotal += t.overtakes; anyTelemetry = true; }
      if (t.contacts != null) { contactsTotal += t.contacts; anyTelemetry = true; }
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
    overtakes: anyTelemetry ? overtakesTotal : null,
    contacts: anyTelemetry ? contactsTotal : null,
    avgConsistencyMs: consDen ? Math.round(consNum / consDen) : null,
    gamePenaltySeconds: anyTelemetry ? Math.round(gamePenSecTotal * 10) / 10 : null,
    stewardPenaltySeconds: rows.reduce((s, r) => s + (r.penaltySeconds || 0), 0),
  };
}

// Career summary across a person's linked driver rows (other seasons). Excludes
// private seasons so a public profile never leaks an unpublished season. Returns
// null when the driver isn't linked to any other season.
async function buildCareer(prisma, driverId, ownSeasonId, ownStandings) {
  const linkedIds = await getLinkedDriverIds(prisma, driverId);
  if (linkedIds.length < 2) return null;
  const [linkedDrivers, privateRows] = await Promise.all([
    prisma.driver.findMany({ where: { id: { in: linkedIds } }, include: { team: true, season: true } }),
    prisma.$queryRawUnsafe(`SELECT "id" FROM "Season" WHERE "isPublic" = 0`).catch(() => []),
  ]);
  const privateSeasonIds = new Set(privateRows.map((r) => r.id));

  const seasons = [];
  for (const ld of linkedDrivers) {
    if (!ld.seasonId || privateSeasonIds.has(ld.seasonId)) continue;
    const st = ld.seasonId === ownSeasonId ? ownStandings : await getDriverStandings(prisma, ld.seasonId);
    const row = st.standings.find((r) => r.driverId === ld.id);
    if (!row) continue;
    const rounds = Object.values(row.perRace || {});
    const finishes = rounds.filter((v) => v.status === "FINISHED" && v.position != null);
    seasons.push({
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
    });
  }
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
  if (merged.length < 2 && merged.length === seasons.length) return null;
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
  return { seasons: merged, totals };
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

  const standingRow = standings.standings.find((r) => r.driverId === driverId);
  const resultByRaceId = new Map(results.map((r) => [r.raceId, r]));
  const nameOv = nameOverrides.get(driverId);
  const career = await buildCareer(prisma, driverId, seasonId, standings);

  // All-time stats power the Season ⇄ All-time toggle on the profile's stat
  // tiles — only when the driver actually spans more than one season.
  let allTime = null;
  if (career) {
    const linkedIds = await getLinkedDriverIds(prisma, driverId);
    const privateRows = await prisma
      .$queryRawUnsafe(`SELECT "id" FROM "Season" WHERE "isPublic" = 0`)
      .catch(() => []);
    allTime = await buildAllTimeStats(prisma, linkedIds, new Set(privateRows.map((r) => r.id)));
  }

  // Podium badges — earned, never assigned: one seal per CONCLUDED season this
  // person finished in the championship top three (gold P1, silver P2, bronze
  // P3). A season counts as concluded when it lies behind the active one, or
  // when it's the live season and every championship round has been run.
  // Linked seasons come via the career block, so seals follow the person
  // across handle changes. One seal per season (the best result wins).
  const [activeSeasonRow, seasonMeta] = await Promise.all([
    prisma.season.findFirst({ where: { isActive: true }, select: { number: true } }),
    prisma.season.findMany({ select: { number: true, game: true } }),
  ]);
  const gameByNumber = new Map(seasonMeta.map((s) => [s.number, s.game || null]));
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
  const ownConcluded =
    ownSeasonNumber != null &&
    activeSeasonRow &&
    (ownSeasonNumber < activeSeasonRow.number ||
      (standings.raceNumbers.length > 0 && races.length >= standings.raceNumbers.length));
  if (ownConcluded && standingRow?.position >= 1 && standingRow.position <= 3) {
    addBadge(standingRow.position, ownSeasonNumber, driver.season?.name, standingRow.total);
  }
  for (const s of career?.seasons || []) {
    if (s.position >= 1 && s.position <= 3 && s.starts > 0 && activeSeasonRow && s.seasonNumber != null && s.seasonNumber < activeSeasonRow.number) {
      addBadge(s.position, s.seasonNumber, s.seasonName, s.points);
    }
  }
  const badges = [...badgeBySeason.values()].sort((a, b) => a.seasonNumber - b.seasonNumber);

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

  // Fastest lap across the season.
  let fastest = null;
  for (const r of perRace) {
    if (r.bestLapMs && (!fastest || r.bestLapMs < fastest.bestLapMs)) {
      fastest = { bestLapMs: r.bestLapMs, track: r.track, number: r.number };
    }
  }

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
    // Cross-season career (null unless this driver is linked to other seasons).
    career,
    // Same shape as `stats`, aggregated across every linked season (null when
    // there's only one season — the toggle then has nothing to switch to).
    allTime,
    // Earned championship seals: [{ type, seasonNumber, seasonName }].
    badges,
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
      // AC telemetry aggregates (null when no round has telemetry yet, so the
      // profile hides these tiles for position-only archive seasons).
      overtakes: anyTelemetry ? overtakesTotal : null,
      contacts: anyTelemetry ? contactsTotal : null,
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
