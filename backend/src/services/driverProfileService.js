// ---------------------------------------------------------------------------
// Per-driver career profile: aggregates a driver's results across all completed
// races into the rich stats shown on the driver profile page. Official points
// and championship position come from the standings service (single source of
// truth); finishing-order extras (grid, best lap, positions gained) come from
// the per-result metadata stored at import/seed time.
// ---------------------------------------------------------------------------
import { getDriverStandings } from "./standingsService.js";
import { parseSocials } from "../lib/socials.js";
import { getLinkedDriverIds, getNameOverrides } from "../lib/persons.js";
import { telemetryForDriver } from "../lib/telemetryRead.js";

function avg(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
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
  if (seasons.length < 2) return null;
  seasons.sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0));
  const totals = seasons.reduce(
    (t, s) => ({
      seasons: t.seasons + 1,
      points: t.points + s.points,
      starts: t.starts + s.starts,
      wins: t.wins + s.wins,
      podiums: t.podiums + s.podiums,
    }),
    { seasons: 0, points: 0, starts: 0, wins: 0, podiums: 0 }
  );
  return { seasons, totals };
}

export async function getDriverProfile(prisma, driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { team: true },
  });
  if (!driver) return null;

  // A driver entry belongs to one season; their stats are scoped to it.
  const seasonId = driver.seasonId;
  const [standings, races, results, telemetry, nameOverrides] = await Promise.all([
    getDriverStandings(prisma, seasonId),
    prisma.race.findMany({
      where: { seasonId, isSpecialEvent: false, isCompleted: true },
      orderBy: { number: "asc" },
    }),
    prisma.raceResult.findMany({ where: { driverId } }),
    telemetryForDriver(prisma, driverId),
    getNameOverrides(prisma),
  ]);

  const standingRow = standings.standings.find((r) => r.driverId === driverId);
  const resultByRaceId = new Map(results.map((r) => [r.raceId, r]));
  const nameOv = nameOverrides.get(driverId);
  const career = await buildCareer(prisma, driverId, seasonId, standings);

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
      discordName: driver.discordName,
      tier: driver.tier,
      isActive: driver.isActive,
      country: driver.country || null,
      number: driver.number ?? null,
      photoUrl: driver.photoUrl || driver.discordAvatar || null,
      socials: parseSocials(driver.socials),
      team: { id: driver.team.id, name: driver.team.name, color: driver.team.color, tier: driver.team.tier, logoUrl: driver.team.logoUrl },
    },
    // Cross-season career (null unless this driver is linked to other seasons).
    career,
    championship: {
      position: standingRow?.position ?? null,
      points: standingRow?.total ?? 0,
      fieldSize: standings.standings.length,
    },
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
