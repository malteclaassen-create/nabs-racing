// ---------------------------------------------------------------------------
// Standings service - reads from the DB and assembles the standings payloads.
// All computation happens here (server-side). Constructor totals are summed
// from the per-race ConstructorRaceScore rows; driver totals from RaceResult.
// ---------------------------------------------------------------------------
import { getDriverResultPoints } from "./pointsCalculator.js";

// Returns the ordered list of completed race numbers, e.g. [1,2,...,9].
async function getRaceNumbers(prisma, seasonId) {
  const races = await prisma.race.findMany({
    where: { seasonId },
    orderBy: { number: "asc" },
    select: { number: true },
  });
  return races.map((r) => r.number);
}

// DRIVER STANDINGS -----------------------------------------------------------
export async function getDriverStandings(prisma, seasonId) {
  const [drivers, races, results] = await Promise.all([
    prisma.driver.findMany({ where: { seasonId }, include: { team: true } }),
    prisma.race.findMany({ where: { seasonId }, orderBy: { number: "asc" } }),
    prisma.raceResult.findMany({ where: { race: { seasonId } } }),
  ]);

  const raceNumberById = new Map(races.map((r) => [r.id, r.number]));
  const raceNumbers = races.map((r) => r.number);

  const rows = drivers.map((driver) => {
    const perRace = {}; // raceNumber -> { points, status, position }
    let total = 0;

    for (const r of results) {
      if (r.driverId !== driver.id) continue;
      const num = raceNumberById.get(r.raceId);
      const pts = getDriverResultPoints(r);
      total += pts;
      perRace[num] = {
        points: pts,
        status: r.status,
        position: r.position,
      };
    }

    return {
      driverId: driver.id,
      name: driver.name,
      discordName: driver.discordName,
      tier: driver.tier,
      isActive: driver.isActive,
      photoUrl: driver.photoUrl || driver.discordAvatar || null,
      team: {
        id: driver.team.id,
        name: driver.team.name,
        color: driver.team.color,
        tier: driver.team.tier,
      },
      perRace,
      total,
    };
  });

  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  rows.forEach((row, i) => (row.position = i + 1));

  return { raceNumbers, standings: rows };
}

// CONSTRUCTOR STANDINGS ------------------------------------------------------
async function getConstructorStandings(prisma, tier, seasonId) {
  const [teams, races, scores] = await Promise.all([
    prisma.team.findMany({ where: { tier, seasonId } }),
    prisma.race.findMany({ where: { seasonId }, orderBy: { number: "asc" } }),
    prisma.constructorRaceScore.findMany({ where: { tier, race: { seasonId } } }),
  ]);

  const raceNumberById = new Map(races.map((r) => [r.id, r.number]));
  const raceNumbers = races.map((r) => r.number);

  const rows = teams.map((team) => {
    const perRace = {};
    let total = 0;
    for (const s of scores) {
      if (s.teamId !== team.id) continue;
      const num = raceNumberById.get(s.raceId);
      perRace[num] = s.points;
      total += s.points;
    }
    return {
      teamId: team.id,
      name: team.name,
      color: team.color,
      tier: team.tier,
      perRace,
      total,
    };
  });

  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  rows.forEach((row, i) => (row.position = i + 1));

  return { tier, raceNumbers, standings: rows };
}

export function getT1ConstructorStandings(prisma, seasonId) {
  return getConstructorStandings(prisma, 1, seasonId);
}

export function getT2ConstructorStandings(prisma, seasonId) {
  return getConstructorStandings(prisma, 2, seasonId);
}

export { getRaceNumbers };
