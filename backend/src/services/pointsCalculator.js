// ---------------------------------------------------------------------------
// NABS Racing League - Points calculator
// ---------------------------------------------------------------------------
// The points table and the (critical) Tier-2 constructor re-ranking logic.
// This module is pure / side-effect free so it can be unit-tested and reused
// both at seed time and during AC race import.
// ---------------------------------------------------------------------------

// The league DEFAULT points table — P1..P18 -> points, P19+ = 0 (index 0 ==
// position 1). A season can override it (Season.pointsTable, admin-editable);
// every function below takes the effective table as an optional last argument
// and falls back to this default, so existing callers/data are unaffected.
export const DEFAULT_POINTS_TABLE = [
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

export function getPointsForPosition(position, table = DEFAULT_POINTS_TABLE) {
  if (!position || position < 1) return 0;
  return table[position - 1] ?? 0;
}

// ---------------------------------------------------------------------------
// TIME PENALTIES
// ---------------------------------------------------------------------------
// A penalty is added SECONDS, not places (the league's real rule): the steward
// adds e.g. 5 s or 10 s to a car's total race time, and it drops behind the cars
// it now trails — one place or several, depending on the gaps.
//
// CRUCIAL: total race time is only comparable BETWEEN CARS ON THE SAME LAP. A car
// that retired / ran fewer laps has a much SMALLER total time, yet finished
// behind. So we must NOT just re-sort the whole field by time (that would shoot
// those low-time retirees to the front, ahead of the real winners). Instead, a
// penalised car only bubbles DOWN past cars that genuinely finished behind it on
// the road — i.e. cars with a *larger* total time. A lapped / retired car has a
// smaller total time, so it is never jumped, and the laps-then-time order that
// the AC result file already encodes (the stored positions) is preserved.
//
// CLASSIFICATION (league rule, confirmed 2026-07-04): only FINISHED cars are
// classified, and they are classified contiguously — P1..Pn in road order. A
// DNS/DNF/DSQ car holds NO slot, so everyone behind it moves up (exactly like
// the official result posts, which list the classified field 1..n and the
// non-finishers separately). Historical rounds keep their official points
// (explicit `points` win over a shifted position), and their real gaps only
// sit beyond P18 where every slot is worth 0 — so past standings don't move.
//
// Returns a Map<driverId, effectivePosition> for the FINISHED results.
export function classifyResults(raceResults) {
  const finishers = raceResults
    .filter((r) => (!r.status || r.status === "FINISHED") && r.position != null)
    .sort((a, b) => a.position - b.position);
  const slots = finishers.map((_, i) => i + 1); // contiguous classified slots
  const out = new Map();

  const anyPenalty = finishers.some((r) => (r.penaltySeconds || 0) > 0);
  const haveAllTimes = finishers.every((r) => r.totalTimeMs > 0);

  // No penalty, or no usable time data -> keep the stored finishing ORDER,
  // but still classify contiguously (non-finishers hold no slot).
  if (!anyPenalty || !haveAllTimes) {
    finishers.forEach((r, i) => out.set(r.driverId, slots[i]));
    return out;
  }

  // Start from the real classification (stored finishing order) and let each
  // penalised car sink within its own lap group. Adjacent swap to a fixpoint:
  // swap a (currently ahead) with the car b just behind it only when
  //   - b genuinely finished behind a on the road  (b.origTime >= a.origTime, so
  //     b is same-lap-slower, never a fewer-laps car with a smaller time), AND
  //   - a's penalised time now exceeds b's          (a.adjusted > b.adjusted).
  // Adding seconds can only move a car down, never up.
  const order = finishers.map((r) => ({
    driverId: r.driverId,
    origTime: r.totalTimeMs,
    adjusted: r.totalTimeMs + (r.penaltySeconds || 0) * 1000,
  }));
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let j = 0; j + 1 < order.length; j++) {
      const a = order[j];
      const b = order[j + 1];
      if (b.origTime >= a.origTime && a.adjusted > b.adjusted) {
        order[j] = b;
        order[j + 1] = a;
        swapped = true;
      }
    }
  }
  order.forEach((c, idx) => out.set(c.driverId, slots[idx]));
  return out;
}

// Returns a copy of the results with each finisher's `position` set to its
// classification. A car moved by a TIME PENALTY is re-scored from its new slot
// (its stale explicit points are dropped). A car that merely moved up because
// a non-finisher released its slot keeps explicit points when it has them
// (historical rounds stay official) and is re-scored from the new slot when it
// doesn't (fresh imports). The stored `position` stays raw, so re-opening a
// round in the editor is idempotent.
export function applyPenalties(raceResults) {
  const classified = classifyResults(raceResults);
  const anyPenalty = raceResults.some((r) => (r.penaltySeconds || 0) > 0);
  return raceResults.map((r) => {
    if (!classified.has(r.driverId)) return r;
    const position = classified.get(r.driverId);
    if (position === r.position) return { ...r, position };
    return { ...r, position, points: anyPenalty ? null : r.points ?? null };
  });
}

// Points a single result actually scores in the driver standings.
// DNS / DNF / DSQ always score 0. Otherwise: explicit `points` if provided
// (historical R1-R8), else derived from finishing position.
export function getDriverResultPoints(result, table = DEFAULT_POINTS_TABLE) {
  if (result.status && result.status !== "FINISHED") return 0;
  if (result.points !== null && result.points !== undefined) return result.points;
  return getPointsForPosition(result.position, table);
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
// The *Contributions variant keeps the per-driver breakdown so the standings
// can apply the per-driver drop rule (each DRIVER's worst rounds don't count
// for the team they drove for in those rounds).
// ---------------------------------------------------------------------------
export function calculateT1ConstructorContributions(raceResults, drivers, teams, table = DEFAULT_POINTS_TABLE) {
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const contributions = [];

  for (const result of raceResults) {
    if (result.status === "DNS") continue;
    const teamId = effectiveTeamId(result, driverById);
    const team = teamById.get(teamId);
    if (team?.tier !== 1) continue;
    contributions.push({ driverId: result.driverId, teamId, points: getDriverResultPoints(result, table) });
  }
  return contributions;
}

export function calculateT1ConstructorPoints(raceResults, drivers, teams, table = DEFAULT_POINTS_TABLE) {
  const points = {};
  for (const c of calculateT1ConstructorContributions(raceResults, drivers, teams, table)) {
    points[c.teamId] = (points[c.teamId] || 0) + c.points;
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
//   - A Tier-2 non-finisher (DNS/DNF/DSQ) is removed entirely — it does NOT hold
//     a slot, so the classified cars behind it bump up and score more.
// ---------------------------------------------------------------------------
export function calculateT2ConstructorContributions(raceResults, drivers, teams, table = DEFAULT_POINTS_TABLE) {
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // Re-rank field: classified Tier-2-team results only, in finishing order.
  // Every non-finisher (DNS/DNF/DSQ) and any result without a position is
  // excluded, so it does not occupy a slot in the re-rank.
  const ranked = raceResults
    .filter((r) => {
      if (r.status !== "FINISHED" || r.position == null) return false;
      return teamById.get(effectiveTeamId(r, driverById))?.tier === 2;
    })
    .sort((a, b) => a.position - b.position);

  return ranked.map((result, index) => ({
    driverId: result.driverId,
    teamId: effectiveTeamId(result, driverById),
    points: getPointsForPosition(index + 1, table),
  }));
}

export function calculateT2ConstructorPoints(raceResults, drivers, teams, table = DEFAULT_POINTS_TABLE) {
  const points = {};
  for (const c of calculateT2ConstructorContributions(raceResults, drivers, teams, table)) {
    points[c.teamId] = (points[c.teamId] || 0) + c.points;
  }
  return points;
}
