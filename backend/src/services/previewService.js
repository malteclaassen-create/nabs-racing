// ---------------------------------------------------------------------------
// Live preview: compute the would-be standings if a set of (unsaved) results
// were stored for one round, without touching the database. Reuses the exact
// scoring + drop-score logic so the preview matches what saving would produce.
// ---------------------------------------------------------------------------
import {
  applyPenalties,
  getDriverResultPoints,
  fastestLapBonusOf,
  getPointsForPosition,
  stampFastestLapBonus,
  stampRacePointsTable,
  pointsTableOf,
  calculateT1ConstructorPoints,
  calculateT2ConstructorPoints,
  DEFAULT_POINTS_TABLE,
} from "./pointsCalculator.js";
import { applyDropScores, buildConstructorRows, scoringRaces, withScoringApplied, roundPointsTables } from "./standingsService.js";
import { resultTeamId } from "../lib/resultTeam.js";
import { getSeasonScoring } from "./seasonService.js";

// The classified, points-bearing view of one proposed round (for the result
// preview table): final order, points, and the Tier-2 re-rank. `fastestLapBonus`
// is the season's bonus for the fastest race lap, stamped onto the proposal's
// holder exactly as saving it would (from the proposal's own lap times — the
// round is not saved, so there is no recorded holder to defer to).
// `racePointsTable` is the round's own table (null = the season's), stamped
// the same way.
function buildRoundPreview(proposed, drivers, teams, table = DEFAULT_POINTS_TABLE, fastestLapBonus = 0, racePointsTable = null) {
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const applied = stampRacePointsTable(
    stampFastestLapBonus(applyPenalties(proposed), fastestLapBonus),
    new Map(proposed.map((r) => [r.raceId, racePointsTable]))
  );
  const rawById = new Map(proposed.map((r) => [r.driverId, r.position]));

  // Nothing is stamped yet at preview time (the round is not saved), so this
  // falls through to the drivers' teams as they stand — which is exactly what
  // saving would write. Same resolver as everywhere else (lib/resultTeam.js).
  const effTeam = (r) => teamById.get(resultTeamId(r, driverById));

  // Tier-2 re-rank over the penalty-adjusted field.
  const t2 = {};
  applied
    .filter((r) => r.status === "FINISHED" && r.position != null && effTeam(r)?.tier === 2)
    .sort((a, b) => a.position - b.position)
    .forEach((r, i) => (t2[r.driverId] = getPointsForPosition(i + 1, pointsTableOf(r, table)) + fastestLapBonusOf(r)));

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
      // Non-finishers are not classified — no final position, they sort to the
      // bottom of the preview like in the official result posts.
      finalPosition: r.status === "FINISHED" ? r.position : null,
      rawPosition: rawById.get(r.driverId) ?? null,
      penalty,
      status: r.status,
      points: getDriverResultPoints(r, table),
      // The share of `points` that is the fastest-lap bonus (0 = none), so the
      // preview can mark the row the way the standings cell will.
      fastestLap: fastestLapBonusOf(r),
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

// `session` = "SPRINT" says the proposal is the SPRINT of a sprint+feature
// weekend (the import page's session picker); a `raceId` that is itself a
// sprint child (the results editor lists them) says the same. Either way the
// proposal stands in for the sprint classification only, and the feature's
// stored results stay in the table — the weekend's other half scores too, so
// a preview that dropped it would show a round losing half its points.
export async function previewRaceImpact(prisma, { seasonId, raceId, number, results, session = null }) {
  const [drivers, teams, races, dbResults, scoring] = await Promise.all([
    prisma.driver.findMany({ where: { seasonId }, include: { team: true } }),
    prisma.team.findMany({ where: { seasonId } }),
    prisma.race.findMany({ where: { seasonId, isSpecialEvent: false }, orderBy: { number: "asc" } }),
    prisma.raceResult.findMany({ where: { race: { seasonId } } }),
    getSeasonScoring(prisma, seasonId),
  ]);
  const table = scoring.pointsTable || DEFAULT_POINTS_TABLE;
  const flBonus = scoring.fastestLapPoints || 0;

  // Rounds plus their sprint classifications, each under its round number —
  // the same map the standings score by, so the preview prices a sprint the
  // way saving it would.
  const { raceNumberById, sprintRaceIds, sprintChildOf } = await scoringRaces(prisma, races);

  // Which round are we previewing, and which classification of it? An
  // existing round (edit), a new number (import of a round not yet in the
  // calendar), or a weekend's sprint (see above). `targetRaceId` is the stored
  // classification the proposal replaces; null when there is none yet.
  let targetNumber = number != null && number !== "" ? Number(number) : null;
  let targetRaceId = null;
  let asSprint = false;
  if (raceId && sprintRaceIds.has(raceId)) {
    targetRaceId = raceId;
    targetNumber = raceNumberById.get(raceId);
    asSprint = true;
  } else {
    const tr = raceId ? races.find((r) => r.id === raceId) : races.find((r) => r.number === targetNumber);
    if (tr) {
      targetNumber = tr.number;
      asSprint = session === "SPRINT";
      targetRaceId = asSprint ? sprintChildOf.get(tr.id) ?? null : tr.id;
    }
  }

  const numberSet = new Set(races.map((r) => r.number));
  if (targetNumber != null) numberSet.add(targetNumber);
  const raceNumbers = [...numberSet].sort((a, b) => a - b);

  // Proposed results keep only mapped drivers. They carry the race they stand
  // in for, so the constructor builders can tell them from the weekend's other
  // classification (a Tier-2 re-rank runs per race, never across two).
  const proposalRaceId = targetRaceId || "__proposal__";
  const proposed = results.filter((r) => r.driverId).map((r) => ({ ...r, raceId: proposalRaceId }));
  // The round's own points table, so a finale that pays differently previews
  // as one. The round is found by its number: a sprint proposal's target is
  // the child, whose table is its round's.
  const targetRoundRow = races.find((r) => r.number === targetNumber) || null;
  const racePointsTable = targetRoundRow ? (await roundPointsTables(prisma, [targetRoundRow.id])).get(targetRoundRow.id) || null : null;
  // Penalties applied, then the fastest-lap bonus stamped from the proposal's
  // own laps, then the round's table — the same pricing saving the round would get.
  const proposedApplied = stampRacePointsTable(
    stampFastestLapBonus(applyPenalties(proposed), flBonus),
    new Map([[proposalRaceId, racePointsTable]])
  );

  // DB results grouped by round number, each race's penalties applied and its
  // fastest-lap bonus stamped within its own classification (non-target
  // rounds reuse these as-is). The target round is split: the classification
  // the proposal replaces (the baseline), and the rest of the weekend, which
  // stays in the table either way.
  const dbByNum = new Map();
  for (const r of await withScoringApplied(prisma, dbResults, scoring)) {
    const n = raceNumberById.get(r.raceId);
    if (n == null) continue;
    if (!dbByNum.has(n)) dbByNum.set(n, []);
    dbByNum.get(n).push(r);
  }
  const targetRound = dbByNum.get(targetNumber) || [];
  const baselineTarget = targetRaceId ? targetRound.filter((r) => r.raceId === targetRaceId) : [];
  const restOfTarget = targetRound.filter((r) => r.raceId !== targetRaceId);

  // Compute the full standings for ONE choice of the target classification's
  // results. We run it twice — once with the proposal, once with what's
  // currently stored for it (the "baseline") — and diff the two. Computing
  // both the same way means quirks of the historical/seed data cancel out, so
  // the deltas show only what the admin's edit actually changes.
  const computeStandings = (targetApplied) => {
    const resultsByRound = new Map();
    for (const n of raceNumbers) {
      const rs = n === targetNumber ? [...restOfTarget, ...targetApplied] : dbByNum.get(n) || [];
      if (rs.length) resultsByRound.set(n, rs);
    }

    const driverRows = drivers.map((d) => {
      const pointsByRound = {};
      for (const n of raceNumbers) {
        // Both halves of a sprint weekend add up, exactly as in the standings.
        const mine = (resultsByRound.get(n) || []).filter((r) => r.driverId === d.id);
        if (mine.length) pointsByRound[n] = mine.reduce((sum, r) => sum + getDriverResultPoints(r, table), 0);
      }
      const { total } = applyDropScores(pointsByRound, raceNumbers, scoring.dropWorst);
      return { driverId: d.id, name: d.name, total, team: { name: d.team.name, color: d.team.color } };
    });

    // Same per-driver drop rule as the live constructor standings: each
    // driver's dropped rounds don't count for the team they drove for.
    const constructorRows = (tier) =>
      buildConstructorRows({
        tier,
        teams,
        drivers,
        raceNumbers,
        resultsByRound,
        dropN: scoring.dropWorst,
        table,
      }).map(({ team, total }) => ({ teamId: team.id, name: team.name, color: team.color, total }));

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
    t1: teamRoundPoints(calculateT1ConstructorPoints(proposedApplied, drivers, teams, table), 1),
    t2: teamRoundPoints(calculateT2ConstructorPoints(proposedApplied, drivers, teams, table), 2),
  };
  // Baseline = the classification exactly as stored now (or absent, for a
  // brand-new import round or a sprint not yet on file). Both sides share every
  // other round and the weekend's other half, so the diff is the edit.
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
    // Which classification of the round the proposal is: the sprint of a
    // sprint+feature weekend, or the race itself.
    session: asSprint ? "SPRINT" : "RACE",
    round: buildRoundPreview(proposed, drivers, teams, table, flBonus, racePointsTable),
    roundTeams,
    drivers: rankWithDelta(proposedStandings.drivers, baseD, "driverId"),
    t1: rankWithDelta(proposedStandings.t1, baseT1, "teamId"),
    t2: rankWithDelta(proposedStandings.t2, baseT2, "teamId"),
  };
}
