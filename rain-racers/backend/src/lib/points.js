// Points of one race. Kept as pure functions: the standings call them for
// every result, so a change to a points table applies to the whole season at
// once, with nothing stored that could go stale.

const parseTable = (json) => {
  if (!json) return null;
  try {
    const list = typeof json === "string" ? JSON.parse(json) : json;
    return Array.isArray(list) ? list.map(Number).filter((n) => Number.isFinite(n)) : null;
  } catch {
    return null;
  }
};

// The tables a round pays by: its own feature table, else the season's, else
// the league's; the sprint by the season's sprint table, else the league's.
export function tablesFor(race, season, settings) {
  return {
    FEATURE: parseTable(race?.pointsTable) ?? parseTable(season?.pointsTable) ?? settings.pointsTable,
    SPRINT: parseTable(season?.sprintPointsTable) ?? settings.sprintPointsTable,
  };
}

// `fastest` says whether this result holds the race's fastest lap; the bonus
// is only paid in the feature race.
export function pointsFor(result, table, { fastestLapPoints, fastestLapTopN, dnfScores }, multiplier = 1, fastest = false) {
  const scores = result.status === "FIN" || (result.status === "DNF" && dnfScores);
  let points = 0;
  if (scores) points += (table[result.position - 1] ?? 0) * multiplier;
  if (fastest && (result.session ?? "FEATURE") === "FEATURE" && result.status === "FIN" && result.position <= fastestLapTopN) {
    points += fastestLapPoints;
  }
  return points + (result.pointsAdjust || 0);
}

// The result holding a session's fastest lap: the lowest best lap among the
// drivers who took part (a DNS or DSQ cannot hold it).
export function fastestLapResultId(results) {
  let best = null;
  for (const r of results) {
    if (!r.bestLapMs || r.status === "DNS" || r.status === "DSQ") continue;
    if (!best || r.bestLapMs < best.bestLapMs) best = r;
  }
  return best ? best.id : null;
}

export const sessionOf = (r) => r.session ?? "FEATURE";

// Points of every result of a round, keyed by result id, and the fastest
// lap of each session.
export function racePoints(race, season, settings) {
  const tables = tablesFor(race, season, settings);
  const fastest = {};
  for (const s of ["FEATURE", "SPRINT"]) fastest[s] = fastestLapResultId(race.results.filter((r) => sessionOf(r) === s));
  const points = new Map();
  for (const r of race.results) {
    const s = sessionOf(r);
    points.set(r.id, pointsFor(r, tables[s], settings, race.pointsMultiplier ?? 1, r.id === fastest[s]));
  }
  return { points, fastest };
}

// The pole sitter of a round: qualifying P1 if a qualifying was imported,
// else whoever started the feature race from grid slot 1.
export function poleDriverId(race) {
  const q = (race.qualifying || []).find((x) => x.position === 1);
  if (q) return q.driverId;
  const g = race.results.find((r) => sessionOf(r) === "FEATURE" && r.grid === 1);
  return g ? g.driverId : null;
}

// Finishing order after time penalties: finishers by laps, then race time
// plus penalty (the old order breaks ties and keeps rows without a time in
// place); then DNF, DSQ and DNS in their old order.
export function orderWithPenalties(results) {
  const rank = { FIN: 0, DNF: 1, DSQ: 2, DNS: 3 };
  const time = (r) => (r.totalTimeMs != null ? r.totalTimeMs + (r.penaltyMs || 0) : null);
  return [...results].sort((a, b) => {
    const ra = rank[a.status] ?? 1;
    const rb = rank[b.status] ?? 1;
    if (ra !== rb) return ra - rb;
    if (ra === 0) {
      if (a.laps !== b.laps) return b.laps - a.laps;
      const ta = time(a);
      const tb = time(b);
      if (ta != null && tb != null && ta !== tb) return ta - tb;
    }
    return a.position - b.position;
  });
}
