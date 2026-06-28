// ---------------------------------------------------------------------------
// Per-driver career profile: aggregates a driver's results across all completed
// races into the rich stats shown on the driver profile page. Official points
// and championship position come from the standings service (single source of
// truth); finishing-order extras (grid, best lap, positions gained) come from
// the per-result metadata stored at import/seed time.
// ---------------------------------------------------------------------------
import { getDriverStandings } from "./standingsService.js";

function avg(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

export async function getDriverProfile(prisma, driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { team: true },
  });
  if (!driver) return null;

  // A driver entry belongs to one season; their stats are scoped to it.
  const seasonId = driver.seasonId;
  const [standings, races, results] = await Promise.all([
    getDriverStandings(prisma, seasonId),
    prisma.race.findMany({
      where: { seasonId, isSpecialEvent: false, isCompleted: true },
      orderBy: { number: "asc" },
    }),
    prisma.raceResult.findMany({ where: { driverId } }),
  ]);

  const standingRow = standings.standings.find((r) => r.driverId === driverId);
  const resultByRaceId = new Map(results.map((r) => [r.raceId, r]));

  // One row per completed championship round, in calendar order. Rounds the
  // driver wasn't entered in still appear (status "DNS", 0 points) so the season
  // form and race-by-race show the whole campaign with the line simply carrying
  // over the gap — instead of those rounds vanishing from the chart entirely.
  const perRace = races.map((race) => {
    const r = resultByRaceId.get(race.id);
    const official = standingRow?.perRace?.[race.number];
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
    };
  });

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
      name: driver.name,
      discordName: driver.discordName,
      tier: driver.tier,
      isActive: driver.isActive,
      country: driver.country || null,
      photoUrl: driver.photoUrl || driver.discordAvatar || null,
      team: { id: driver.team.id, name: driver.team.name, color: driver.team.color, tier: driver.team.tier, logoUrl: driver.team.logoUrl },
    },
    championship: {
      position: standingRow?.position ?? null,
      points: standingRow?.total ?? 0,
      fieldSize: standings.standings.length,
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
    },
    perRace,
  };
}
