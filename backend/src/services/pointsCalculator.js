// ---------------------------------------------------------------------------
// NABS Racing League - Points calculator
// ---------------------------------------------------------------------------
// The points table and the (critical) Tier-2 constructor re-ranking logic.
// This module is pure / side-effect free so it can be unit-tested and reused
// both at seed time and during AC race import.
// ---------------------------------------------------------------------------

// P1..P18 -> points. P19+ = 0.
// index 0 == position 1.
const POINTS_TABLE = [
  35, // P1
  30, // P2
  25, // P3
  22, // P4
  20, // P5
  18, // P6
  16, // P7
  14, // P8
  12, // P9
  10, // P10
  8, // P11
  7, // P12
  6, // P13
  5, // P14
  4, // P15
  3, // P16
  2, // P17
  1, // P18
];

export function getPointsForPosition(position) {
  if (!position || position < 1) return 0;
  return POINTS_TABLE[position - 1] ?? 0;
}

// Points a single result actually scores in the driver standings.
// DNS / DNF / DSQ always score 0. Otherwise: explicit `points` if provided
// (historical R1-R8), else derived from finishing position.
export function getDriverResultPoints(result) {
  if (result.status && result.status !== "FINISHED") return 0;
  if (result.points !== null && result.points !== undefined) return result.points;
  return getPointsForPosition(result.position);
}

// Resolve the team a result counts towards: a reserve substituting for a team
// counts for that team, otherwise the driver's own team.
function effectiveTeamId(result, driverById) {
  if (result.subForTeamId) return result.subForTeamId;
  return driverById.get(result.driverId)?.teamId ?? null;
}

// ---------------------------------------------------------------------------
// TIER 1 CONSTRUCTORS
// Sum of the actual race points of every result whose effective team is a
// Tier-1 team. No re-ranking - real finishing points are used.
// ---------------------------------------------------------------------------
export function calculateT1ConstructorPoints(raceResults, drivers, teams) {
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const points = {};

  for (const result of raceResults) {
    if (result.status === "DNS") continue;
    const teamId = effectiveTeamId(result, driverById);
    const team = teamById.get(teamId);
    if (team?.tier !== 1) continue;
    points[teamId] = (points[teamId] || 0) + getDriverResultPoints(result);
  }
  return points;
}

// ---------------------------------------------------------------------------
// TIER 2 CONSTRUCTORS  (the critical bit)
// Only drivers whose effective team is a Tier-2 team are classified. Tier-1
// drivers AND team-less reserves are removed *entirely* — they do NOT occupy a
// slot. The remaining Tier-2 field is then re-ranked in finishing order and
// awarded points by the new rank.
//   - A reserve substituting for a Tier-2 team counts for that team (its
//     effective team is Tier 2, so it stays in the field and scores).
//   - A reserve substituting for a Tier-1 team is removed (effective Tier 1).
//   - A reserve with no team is removed (effective Tier 0) — does not score and
//     does not push anyone down.
//   - A Tier-2 DNF/DSQ keeps its slot in the order but scores 0.
// ---------------------------------------------------------------------------
export function calculateT2ConstructorPoints(raceResults, drivers, teams) {
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // Re-rank field: Tier-2-team results only, in finishing order. DNS excluded;
  // results without a position can't be ranked.
  const ranked = raceResults
    .filter((r) => {
      if (r.status === "DNS" || r.position == null) return false;
      return teamById.get(effectiveTeamId(r, driverById))?.tier === 2;
    })
    .sort((a, b) => a.position - b.position);

  const constructorPoints = {};
  ranked.forEach((result, index) => {
    if (result.status !== "FINISHED") return; // DNF/DSQ hold the slot, score 0
    const teamId = effectiveTeamId(result, driverById);
    constructorPoints[teamId] = (constructorPoints[teamId] || 0) + getPointsForPosition(index + 1);
  });

  return constructorPoints;
}
