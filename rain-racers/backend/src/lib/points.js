// Points of one result. Kept as a pure function: the standings call it for
// every result, so a change to the points table applies to the whole season
// at once, with nothing stored that could go stale.
//
// `fastest` says whether this result holds the race's fastest lap.
export function pointsFor(result, { pointsTable, fastestLapPoints, fastestLapTopN, dnfScores }, multiplier = 1, fastest = false) {
  const scores = result.status === "FIN" || (result.status === "DNF" && dnfScores);
  let points = 0;
  if (scores) points += (pointsTable[result.position - 1] ?? 0) * multiplier;
  if (fastest && result.status === "FIN" && result.position <= fastestLapTopN) points += fastestLapPoints;
  return points + (result.pointsAdjust || 0);
}

// The result holding the race's fastest lap: the lowest best lap among the
// drivers who took part (a DNS or DSQ cannot hold it).
export function fastestLapResultId(results) {
  let best = null;
  for (const r of results) {
    if (!r.bestLapMs || r.status === "DNS" || r.status === "DSQ") continue;
    if (!best || r.bestLapMs < best.bestLapMs) best = r;
  }
  return best ? best.id : null;
}

// Points of every result of a race, keyed by result id.
export function racePoints(race, settings) {
  const fastestId = fastestLapResultId(race.results);
  const out = new Map();
  for (const r of race.results) {
    out.set(r.id, pointsFor(r, settings, race.pointsMultiplier ?? 1, r.id === fastestId));
  }
  return { points: out, fastestId };
}
