// ---------------------------------------------------------------------------
// Standings service - reads from the DB and assembles the standings payloads.
// All computation happens here (server-side). Constructor totals are summed
// from the per-race ConstructorRaceScore rows; driver totals from RaceResult.
// ---------------------------------------------------------------------------
import { getDriverResultPoints, applyPenalties } from "./pointsCalculator.js";

// Apply each race's position penalties before scoring. Grouping by race keeps a
// penalty's re-ranking contained to its own round. With no penalties this is a
// no-op, so existing standings are unaffected.
function withPenaltiesApplied(results) {
  const byRace = new Map();
  for (const r of results) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId).push(r);
  }
  const out = [];
  for (const rs of byRace.values()) out.push(...applyPenalties(rs));
  return out;
}

// Number of lowest-scoring rounds dropped from every season total ("drop
// scores" / Streichresultate). A round a competitor didn't score in counts as
// 0 and is dropped first. Rounds not yet run also count as 0, so mid-season
// nothing real is dropped until fewer than this many rounds remain unscored.
// Applies identically to drivers and to constructors (the team's own per-race
// totals). For Season 7: 12 rounds -> the best 9 count.
const DROP_LOWEST_N = 3;

// Given a map of roundNumber -> points and the full list of calendar round
// numbers, returns { total, droppedRounds } after removing the DROP_LOWEST_N
// lowest rounds. Rounds missing from the map count as 0. If the calendar has
// DROP_LOWEST_N or fewer rounds, nothing is dropped (so a brand-new / very
// short season doesn't zero everyone out). Pure / side-effect free.
export function applyDropScores(pointsByRound, roundNumbers, dropN = DROP_LOWEST_N) {
  const entries = roundNumbers.map((num) => ({ num, points: pointsByRound[num] ?? 0 }));
  if (entries.length <= dropN) {
    return { total: entries.reduce((s, e) => s + e.points, 0), droppedRounds: [] };
  }
  // Lowest points first; on a tie drop the later round (keeps the earlier
  // result — purely cosmetic, equal points don't change the total).
  const sorted = [...entries].sort((a, b) => a.points - b.points || b.num - a.num);
  const droppedRounds = sorted.slice(0, dropN).map((e) => e.num).sort((a, b) => a - b);
  const total = sorted.slice(dropN).reduce((s, e) => s + e.points, 0);
  return { total, droppedRounds };
}

// Returns the ordered list of completed race numbers, e.g. [1,2,...,9].
async function getRaceNumbers(prisma, seasonId) {
  const races = await prisma.race.findMany({
    where: { seasonId, isSpecialEvent: false },
    orderBy: { number: "asc" },
    select: { number: true },
  });
  return races.map((r) => r.number);
}

// DRIVER STANDINGS -----------------------------------------------------------
export async function getDriverStandings(prisma, seasonId) {
  const [drivers, races, results] = await Promise.all([
    prisma.driver.findMany({ where: { seasonId }, include: { team: true } }),
    prisma.race.findMany({ where: { seasonId, isSpecialEvent: false }, orderBy: { number: "asc" } }),
    prisma.raceResult.findMany({ where: { race: { seasonId } } }),
  ]);

  const raceNumberById = new Map(races.map((r) => [r.id, r.number]));
  const raceNumbers = races.map((r) => r.number);
  const appliedResults = withPenaltiesApplied(results);

  const rows = drivers.map((driver) => {
    const perRace = {}; // raceNumber -> { points, status, position }
    const pointsByRound = {};

    for (const r of appliedResults) {
      if (r.driverId !== driver.id) continue;
      const num = raceNumberById.get(r.raceId);
      const pts = getDriverResultPoints(r);
      pointsByRound[num] = pts;
      perRace[num] = {
        points: pts,
        status: r.status,
        position: r.position,
      };
    }

    // Season total drops each driver's 3 lowest rounds (unscored / not-yet-run
    // rounds count as 0 and are dropped first). The per-race grid still shows
    // every real result; droppedRounds tells the UI which ones don't count.
    const { total, droppedRounds } = applyDropScores(pointsByRound, raceNumbers);

    return {
      driverId: driver.id,
      name: driver.name,
      discordName: driver.discordName,
      tier: driver.tier,
      isActive: driver.isActive,
      country: driver.country || null,
      photoUrl: driver.photoUrl || driver.discordAvatar || null,
      team: {
        id: driver.team.id,
        name: driver.team.name,
        color: driver.team.color,
        tier: driver.team.tier,
        logoUrl: driver.team.logoUrl,
      },
      perRace,
      droppedRounds,
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
    prisma.race.findMany({ where: { seasonId, isSpecialEvent: false }, orderBy: { number: "asc" } }),
    prisma.constructorRaceScore.findMany({ where: { tier, race: { seasonId } } }),
  ]);

  const raceNumberById = new Map(races.map((r) => [r.id, r.number]));
  const raceNumbers = races.map((r) => r.number);

  const rows = teams.map((team) => {
    const perRace = {};
    for (const s of scores) {
      if (s.teamId !== team.id) continue;
      const num = raceNumberById.get(s.raceId);
      perRace[num] = s.points;
    }
    // Same drop-3 rule as the drivers, on the team's own per-race totals.
    const { total, droppedRounds } = applyDropScores(perRace, raceNumbers);
    return {
      teamId: team.id,
      name: team.name,
      color: team.color,
      tier: team.tier,
      logoUrl: team.logoUrl,
      perRace,
      droppedRounds,
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
