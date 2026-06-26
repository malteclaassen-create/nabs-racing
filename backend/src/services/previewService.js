// ---------------------------------------------------------------------------
// Live preview: compute the would-be standings if a set of (unsaved) results
// were stored for one round, without touching the database. Reuses the exact
// scoring + drop-score logic so the preview matches what saving would produce.
// ---------------------------------------------------------------------------
import {
  applyPenalties,
  getDriverResultPoints,
  getPointsForPosition,
  calculateT1ConstructorPoints,
  calculateT2ConstructorPoints,
} from "./pointsCalculator.js";
import { applyDropScores } from "./standingsService.js";

// The classified, points-bearing view of one proposed round (for the result
// preview table): final order, points, and the Tier-2 re-rank.
function buildRoundPreview(proposed, drivers, teams) {
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const applied = applyPenalties(proposed);
  const rawById = new Map(proposed.map((r) => [r.driverId, r.position]));

  const effTeam = (r) => teamById.get(r.subForTeamId || driverById.get(r.driverId)?.teamId);

  // Tier-2 re-rank over the penalty-adjusted field.
  const t2 = {};
  applied
    .filter((r) => r.status === "FINISHED" && r.position != null && effTeam(r)?.tier === 2)
    .sort((a, b) => a.position - b.position)
    .forEach((r, i) => (t2[r.driverId] = getPointsForPosition(i + 1)));

  const rows = applied.map((r) => {
    const d = driverById.get(r.driverId);
    const team = effTeam(r);
    const penalty = r.penaltySeconds || 0; // seconds
    const totalTimeMs = r.totalTimeMs ?? null;
    // Adjusted race time = real time + the penalty seconds (only for finishers
    // that actually have a stored time).
    const adjustedMs =
      r.status === "FINISHED" && totalTimeMs > 0 ? totalTimeMs + penalty * 1000 : null;
    return {
      driverId: r.driverId,
      name: d?.name || r.driverId,
      finalPosition: r.position,
      rawPosition: rawById.get(r.driverId) ?? null,
      penalty,
      status: r.status,
      points: getDriverResultPoints(r),
      t2Points: t2[r.driverId] ?? null,
      // Effective team + tier so the preview can show who scores as T1 / T2 /
      // Reserve, and whether this is a reserve subbing for a team.
      tier: team?.tier ?? null,
      isSub: !!r.subForTeamId,
      totalTimeMs,
      adjustedMs,
      team: team ? { id: team.id, name: team.name, color: team.color, tier: team.tier } : null,
    };
  });

  rows.sort((a, b) => {
    if (a.finalPosition == null && b.finalPosition == null) return 0;
    if (a.finalPosition == null) return 1;
    if (b.finalPosition == null) return -1;
    // Same slot -> show the penalised car below the car that earned it.
    return a.finalPosition - b.finalPosition || a.penalty - b.penalty;
  });

  // Final gap to the leader, by adjusted race time (so it already reflects the
  // penalties). Only meaningful when the round has stored times.
  const leaderAdjusted = rows.find((r) => r.adjustedMs != null)?.adjustedMs ?? null;
  for (const r of rows) {
    r.gapMs =
      r.adjustedMs != null && leaderAdjusted != null ? r.adjustedMs - leaderAdjusted : null;
  }

  return rows;
}

// Rank rows by total desc, assign positions, and attach a delta vs the current
// standings position (positive = would move up).
function rankWithDelta(rows, currentPosById, idKey) {
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    r.position = i + 1;
    const cur = currentPosById.get(r[idKey]);
    r.delta = cur == null ? 0 : cur - r.position;
  });
  return rows;
}

export async function previewRaceImpact(prisma, { seasonId, raceId, number, results }) {
  const [drivers, teams, races, dbResults, dbScores] = await Promise.all([
    prisma.driver.findMany({ where: { seasonId }, include: { team: true } }),
    prisma.team.findMany({ where: { seasonId } }),
    prisma.race.findMany({ where: { seasonId, isSpecialEvent: false }, orderBy: { number: "asc" } }),
    prisma.raceResult.findMany({ where: { race: { seasonId } } }),
    prisma.constructorRaceScore.findMany({ where: { race: { seasonId } } }),
  ]);

  // Which round are we previewing? An existing round (edit) or a new number
  // (import of a round not yet in the calendar).
  let targetNumber = number != null && number !== "" ? Number(number) : null;
  if (raceId) {
    const tr = races.find((r) => r.id === raceId);
    if (tr) targetNumber = tr.number;
  }

  const numById = new Map(races.map((r) => [r.id, r.number]));
  const numberSet = new Set(races.map((r) => r.number));
  if (targetNumber != null) numberSet.add(targetNumber);
  const raceNumbers = [...numberSet].sort((a, b) => a - b);

  // Proposed results keep only mapped drivers.
  const proposed = results.filter((r) => r.driverId);
  const proposedApplied = applyPenalties(proposed);

  // DB results grouped by round number (non-target rounds reuse these as-is).
  const dbByNum = new Map();
  for (const r of dbResults) {
    const n = numById.get(r.raceId);
    if (n == null) continue;
    if (!dbByNum.has(n)) dbByNum.set(n, []);
    dbByNum.get(n).push(r);
  }
  // Constructor scores already stored per round/team (used for every round
  // except the target — both baseline and proposal use them, so they cancel).
  const dbScoreByKey = new Map(); // `${num}|${teamId}` -> points
  for (const s of dbScores) dbScoreByKey.set(`${numById.get(s.raceId)}|${s.teamId}`, s.points);

  // Compute the full standings for ONE choice of the target round's results.
  // We run it twice — once with the proposal, once with what's currently stored
  // for that round (the "baseline") — and diff the two. Computing both the same
  // way means quirks of the historical/seed data cancel out, so the deltas show
  // only what the admin's edit actually changes.
  const computeStandings = (targetApplied) => {
    const resultsByNum = (n) => (n === targetNumber ? targetApplied : applyPenalties(dbByNum.get(n) || []));

    const driverRows = drivers.map((d) => {
      const pointsByRound = {};
      for (const n of raceNumbers) {
        const mine = resultsByNum(n).find((r) => r.driverId === d.id);
        if (mine) pointsByRound[n] = getDriverResultPoints(mine);
      }
      const { total } = applyDropScores(pointsByRound, raceNumbers);
      return { driverId: d.id, name: d.name, total, team: { name: d.team.name, color: d.team.color } };
    });

    const constructorRows = (tier) => {
      const calc = tier === 1 ? calculateT1ConstructorPoints : calculateT2ConstructorPoints;
      const targetScores = targetNumber != null ? calc(targetApplied, drivers, teams) : {};
      return teams
        .filter((t) => t.tier === tier)
        .map((t) => {
          const perRound = {};
          for (const n of raceNumbers) {
            perRound[n] =
              n === targetNumber ? targetScores[t.id] || 0 : dbScoreByKey.get(`${n}|${t.id}`) || 0;
          }
          const { total } = applyDropScores(perRound, raceNumbers);
          return { teamId: t.id, name: t.name, color: t.color, total };
        });
    };

    return { drivers: driverRows, t1: constructorRows(1), t2: constructorRows(2) };
  };

  const proposedStandings = computeStandings(proposedApplied);

  // Constructor points each team earns from THIS round (T1 = sum of real points,
  // T2 = re-ranked field), so the admin sees the per-round team haul directly.
  const teamRoundPoints = (scores, tier) =>
    teams
      .filter((t) => t.tier === tier)
      .map((t) => ({ teamId: t.id, name: t.name, color: t.color, points: scores[t.id] || 0 }))
      .filter((t) => t.points > 0)
      .sort((a, b) => b.points - a.points);
  const roundTeams = {
    t1: teamRoundPoints(calculateT1ConstructorPoints(proposedApplied, drivers, teams), 1),
    t2: teamRoundPoints(calculateT2ConstructorPoints(proposedApplied, drivers, teams), 2),
  };
  // Baseline = the round exactly as stored now (or absent, for a brand-new
  // import round). Both sides share every other round, so the diff is the edit.
  const baselineTarget = targetNumber != null ? applyPenalties(dbByNum.get(targetNumber) || []) : [];
  const baseline = computeStandings(baselineTarget);

  const basePos = (rows, idKey) => {
    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const m = new Map();
    rows.forEach((r, i) => m.set(r[idKey], i + 1));
    return m;
  };
  const baseD = basePos(baseline.drivers, "driverId");
  const baseT1 = basePos(baseline.t1, "teamId");
  const baseT2 = basePos(baseline.t2, "teamId");

  return {
    targetNumber,
    round: buildRoundPreview(proposed, drivers, teams),
    roundTeams,
    drivers: rankWithDelta(proposedStandings.drivers, baseD, "driverId"),
    t1: rankWithDelta(proposedStandings.t1, baseT1, "teamId"),
    t2: rankWithDelta(proposedStandings.t2, baseT2, "teamId"),
  };
}
