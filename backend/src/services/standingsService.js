// ---------------------------------------------------------------------------
// Standings service - reads from the DB and assembles the standings payloads.
// All computation happens here (server-side). Both driver and constructor
// totals are computed from the RaceResult rows, so the per-driver drop rule
// (see below) can trace every team point back to the driver who scored it.
// ---------------------------------------------------------------------------
import {
  getDriverResultPoints,
  applyPenalties,
  calculateT1ConstructorContributions,
  calculateT2ConstructorContributions,
  DEFAULT_POINTS_TABLE,
} from "./pointsCalculator.js";
import { getSeasonScoring } from "./seasonService.js";

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

// DEFAULT number of lowest-scoring rounds dropped from every season total
// ("drop scores" / Streichresultate). A round a competitor didn't score in
// counts as 0 and is dropped first. Rounds not yet run also count as 0, so
// mid-season nothing real is dropped until fewer than this many rounds remain
// unscored. The drop is PER DRIVER: each driver's N lowest rounds don't count
// in the driver standings, and the constructor standings exclude exactly those
// driver-rounds too (the points go missing from whichever team the driver
// drove for in that round — their own team or, for a sub, the team they
// subbed for). There is no separate team-level drop. Each season can override
// the count (Season.dropWorst, 0 = keep every round); for Season 7: 12 rounds
// -> each driver's best 9 count.
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

// Each driver's dropped rounds, computed exactly like the driver standings do
// it: their driver-standings points per round (missing / DNS / DNF / unrun
// rounds = 0), lowest dropN rounds dropped. Takes the season's results grouped
// by round number (penalties already applied) and returns
// Map<driverId, Set<roundNumber>>. Pure / side-effect free.
export function computeDriverDropRounds(resultsByRound, raceNumbers, dropN, table = DEFAULT_POINTS_TABLE) {
  const pointsByDriver = new Map();
  for (const [num, results] of resultsByRound) {
    for (const r of results) {
      if (!pointsByDriver.has(r.driverId)) pointsByDriver.set(r.driverId, {});
      pointsByDriver.get(r.driverId)[num] = getDriverResultPoints(r, table);
    }
  }
  const dropped = new Map();
  for (const [driverId, pointsByRound] of pointsByDriver) {
    const { droppedRounds } = applyDropScores(pointsByRound, raceNumbers, dropN);
    dropped.set(driverId, new Set(droppedRounds));
  }
  return dropped;
}

// Constructor season rows under the per-driver drop rule. For every round the
// tier's constructor points are broken down per driver; a driver's
// contribution is excluded when that round is one of the driver's own dropped
// rounds. perRace keeps the FULL points the team scored in the round (what
// the race actually paid out); droppedPerRace says how much of it doesn't
// count; total sums only the counting share. Pure / side-effect free.
export function buildConstructorRows({ tier, teams, drivers, raceNumbers, resultsByRound, dropN, table = DEFAULT_POINTS_TABLE }) {
  const dropRounds = computeDriverDropRounds(resultsByRound, raceNumbers, dropN, table);
  const contributionsFor =
    tier === 1 ? calculateT1ConstructorContributions : calculateT2ConstructorContributions;
  const tierTeams = teams.filter((t) => t.tier === tier);

  const perTeam = new Map(
    tierTeams.map((t) => [t.id, { perRace: {}, droppedPerRace: {}, total: 0 }])
  );

  for (const num of raceNumbers) {
    const results = resultsByRound.get(num);
    if (!results || results.length === 0) continue; // round not run yet
    // The round happened: every tier team gets an explicit 0 so the UI can
    // tell "scored nothing" apart from "not raced yet".
    for (const row of perTeam.values()) row.perRace[num] = row.perRace[num] ?? 0;

    for (const c of contributionsFor(results, drivers, teams, table)) {
      const row = perTeam.get(c.teamId);
      if (!row) continue;
      row.perRace[num] += c.points;
      if (dropRounds.get(c.driverId)?.has(num)) {
        // 0-point contributions in a dropped round change nothing — don't
        // record them, so droppedPerRace only lists real deductions.
        if (c.points > 0) row.droppedPerRace[num] = (row.droppedPerRace[num] || 0) + c.points;
      } else {
        row.total += c.points;
      }
    }
  }

  return tierTeams.map((team) => ({ team, ...perTeam.get(team.id) }));
}

// Overlay official final standings on top of computed rows (archived seasons).
// Rows whose id appears in `finals` take its official total and keep the given
// array order; rows not listed keep their computed total and sort after, by
// total desc then name. `finals` is an array of { id, points }. Mutates &
// re-sorts `rows` in place and renumbers positions. No-op when `finals` is
// falsy/empty, so live seasons are completely unaffected.
export function applyFinalStandings(rows, finals, idKey) {
  if (!finals || finals.length === 0) return rows;
  const order = new Map(finals.map((e, i) => [e.id, { points: e.points, index: i }]));
  for (const row of rows) {
    const o = order.get(row[idKey]);
    if (o) row.total = o.points;
  }
  rows.sort((a, b) => {
    const oa = order.get(a[idKey]);
    const ob = order.get(b[idKey]);
    if (oa && ob) return oa.index - ob.index;
    if (oa) return -1;
    if (ob) return 1;
    return b.total - a.total || a.name.localeCompare(b.name);
  });
  rows.forEach((row, i) => (row.position = i + 1));
  return rows;
}

// Constructor rows built straight from stored OFFICIAL per-race team points
// (archived seasons whose sheet lists them, e.g. Season 6). These seasons used
// the old per-TEAM drop rule, so each team's own worst `dropN` rounds are
// dropped — reproduced here exactly, unlike the live per-driver computation
// which can't see per-round subs. `teamPerRace` = { teamId: { round: points } }.
export function buildStoredConstructorRows({ tier, teams, raceNumbers, teamPerRace, dropN }) {
  return teams
    .filter((t) => t.tier === tier)
    .map((team) => {
      const per = teamPerRace[team.id] || {};
      const perRace = {};
      const pointsByRound = {};
      for (const num of raceNumbers) {
        if (per[num] != null) {
          perRace[num] = per[num];
          pointsByRound[num] = per[num];
        }
      }
      const { total, droppedRounds } = applyDropScores(pointsByRound, raceNumbers, dropN);
      const droppedPerRace = {};
      for (const num of droppedRounds) if (perRace[num]) droppedPerRace[num] = perRace[num];
      return {
        teamId: team.id,
        name: team.name,
        color: team.color,
        tier: team.tier,
        logoUrl: team.logoUrl,
        perRace,
        droppedPerRace,
        total,
      };
    });
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
  const [drivers, races, results, scoring] = await Promise.all([
    prisma.driver.findMany({ where: { seasonId }, include: { team: true } }),
    prisma.race.findMany({ where: { seasonId, isSpecialEvent: false }, orderBy: { number: "asc" } }),
    prisma.raceResult.findMany({ where: { race: { seasonId } } }),
    getSeasonScoring(prisma, seasonId),
  ]);
  const table = scoring.pointsTable || DEFAULT_POINTS_TABLE;

  const raceNumberById = new Map(races.map((r) => [r.id, r.number]));
  const raceNumbers = races.map((r) => r.number);
  const appliedResults = withPenaltiesApplied(results);

  const rows = drivers.map((driver) => {
    const perRace = {}; // raceNumber -> { points, status, position }
    const pointsByRound = {};

    for (const r of appliedResults) {
      if (r.driverId !== driver.id) continue;
      const num = raceNumberById.get(r.raceId);
      const pts = getDriverResultPoints(r, table);
      pointsByRound[num] = pts;
      perRace[num] = {
        points: pts,
        status: r.status,
        position: r.position,
      };
    }

    // Season total drops each driver's N lowest rounds (unscored / not-yet-run
    // rounds count as 0 and are dropped first). The per-race grid still shows
    // every real result; droppedRounds tells the UI which ones don't count.
    const { total, droppedRounds } = applyDropScores(pointsByRound, raceNumbers, scoring.dropWorst);

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
  // Archived seasons: official totals & order win over the computed ones.
  applyFinalStandings(rows, scoring.finalStandings?.drivers, "driverId");

  // officialTotals tells the UI the totals come from the league's official
  // final sheet (not computed), so per-race sums may not add up exactly.
  return {
    raceNumbers,
    dropWorst: scoring.dropWorst,
    officialTotals: !!scoring.finalStandings?.drivers?.length,
    standings: rows,
  };
}

// CONSTRUCTOR STANDINGS ------------------------------------------------------
// Computed from the raw race results (not the stored per-team round scores),
// because the drop rule needs each round's points traced to the driver who
// scored them: a driver's own dropped rounds don't count for the team they
// drove for in those rounds.
async function getConstructorStandings(prisma, tier, seasonId) {
  const [teams, drivers, races, results, scoring] = await Promise.all([
    // ALL season teams/drivers (not just this tier): resolving a result's
    // effective team & tier needs the full grid, reserves included.
    prisma.team.findMany({ where: { seasonId } }),
    prisma.driver.findMany({ where: { seasonId } }),
    prisma.race.findMany({ where: { seasonId, isSpecialEvent: false }, orderBy: { number: "asc" } }),
    prisma.raceResult.findMany({ where: { race: { seasonId } } }),
    getSeasonScoring(prisma, seasonId),
  ]);
  const table = scoring.pointsTable || DEFAULT_POINTS_TABLE;

  const raceNumberById = new Map(races.map((r) => [r.id, r.number]));
  const raceNumbers = races.map((r) => r.number);

  // Group by round with each race's penalties applied; results of special
  // events (not in the number map) never score constructor points.
  const byRace = new Map();
  for (const r of results) {
    const num = raceNumberById.get(r.raceId);
    if (num == null) continue;
    if (!byRace.has(num)) byRace.set(num, []);
    byRace.get(num).push(r);
  }
  const resultsByRound = new Map();
  for (const [num, rs] of byRace) resultsByRound.set(num, applyPenalties(rs));

  // Archived seasons that ship official per-race team points use those directly
  // (old per-team drop rule); everyone else computes live from the race results.
  const rows = scoring.finalStandings?.teamPerRace
    ? buildStoredConstructorRows({ tier, teams, raceNumbers, teamPerRace: scoring.finalStandings.teamPerRace, dropN: scoring.dropWorst })
    : buildConstructorRows({
        tier,
        teams,
        drivers,
        raceNumbers,
        resultsByRound,
        dropN: scoring.dropWorst,
        table,
      }).map(({ team, perRace, droppedPerRace, total }) => ({
        teamId: team.id,
        name: team.name,
        color: team.color,
        tier: team.tier,
        logoUrl: team.logoUrl,
        perRace,
        droppedPerRace,
        total,
      }));

  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  rows.forEach((row, i) => (row.position = i + 1));
  // Archived seasons: official team totals & order win (finalStandings.teams
  // holds every team; only this tier's rows exist here, so the rest are ignored).
  applyFinalStandings(rows, scoring.finalStandings?.teams, "teamId");

  return {
    tier,
    raceNumbers,
    dropWorst: scoring.dropWorst,
    officialTotals: !!scoring.finalStandings?.teams?.length,
    standings: rows,
  };
}

export function getT1ConstructorStandings(prisma, seasonId) {
  return getConstructorStandings(prisma, 1, seasonId);
}

export function getT2ConstructorStandings(prisma, seasonId) {
  return getConstructorStandings(prisma, 2, seasonId);
}

export { getRaceNumbers };
