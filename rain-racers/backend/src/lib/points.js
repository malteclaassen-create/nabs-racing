// Points of one round. Kept as pure functions: the standings call them for
// every result, so a change to a points table applies to the whole season at
// once, with nothing stored that could go stale.
//
// A round has one or more races; their results are the sessions R1, R2, ...
// (race 1, race 2, ...). A qualifying can pay points too.

const parseJson = (json) => {
  if (json == null) return null;
  if (typeof json !== "string") return json;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const parseTable = (json) => {
  const list = parseJson(json);
  return Array.isArray(list) && list.length ? list.map(Number).filter((n) => Number.isFinite(n)) : null;
};

export const sessionOf = (r) => r.session ?? "R1";
export const raceCountOf = (race) => Math.max(1, Math.min(MAX_RACES, race?.raceCount || 1));
export const MAX_RACES = 4;
// ["R1", "R2", ...] of a round
export const sessionsOf = (race) => Array.from({ length: raceCountOf(race) }, (_, i) => `R${i + 1}`);
export const raceNumber = (session) => Number(String(session).replace(/^R/, "")) || 1;

// The season's tables for rounds with more than one race: { "2": table or
// [table per race], ... }. Returns the table for race `no` of a round with
// `count` races, or null.
export function multiRaceTable(raceTables, count, no) {
  const entry = parseJson(raceTables)?.[count];
  if (!Array.isArray(entry)) return null;
  const perRace = entry.some((x) => x === null || Array.isArray(x));
  return perRace ? parseTable(entry[no - 1]) : parseTable(entry);
}

// The table race `no` of a round pays by: the round's own table, else the
// season's table for rounds with this many races, else the season's table,
// else the league's.
export function tableFor(race, season, settings, no = 1) {
  return (
    parseTable(race?.pointsTable) ??
    (raceCountOf(race) > 1 ? multiRaceTable(season?.raceTables, raceCountOf(race), no) : null) ??
    parseTable(season?.pointsTable) ??
    settings.pointsTable
  );
}

export const isReverse = (season) => season?.pointsMode === "REVERSE";

// Points of one result. `fastest` says whether it holds the race's fastest
// lap. With `reverseOf` set (back-to-front scoring) the table is not used: the
// last of `reverseOf` scoring drivers gets 1, the one ahead 2, and so on.
export function pointsFor(result, table, { fastestLapPoints, fastestLapTopN, dnfScores }, multiplier = 1, fastest = false, reverseOf = null) {
  const scores = result.status === "FIN" || (result.status === "DNF" && dnfScores);
  let points = 0;
  if (scores) {
    const base = reverseOf != null ? Math.max(0, reverseOf - result.position + 1) : table[result.position - 1] ?? 0;
    points += base * multiplier;
  }
  if (fastest && result.status === "FIN" && result.position <= fastestLapTopN) points += fastestLapPoints;
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

// Points of every result of a round, keyed by result id; the fastest lap of
// each race; and the qualifying points, keyed by driver id.
export function racePoints(race, season, settings) {
  const fastest = {};
  const points = new Map();
  const multiplier = race.pointsMultiplier ?? 1;
  for (const s of sessionsOf(race)) {
    const rows = race.results.filter((r) => sessionOf(r) === s);
    fastest[s] = fastestLapResultId(rows);
    const table = tableFor(race, season, settings, raceNumber(s));
    const reverseOf = isReverse(season) ? rows.filter((r) => r.status === "FIN" || (r.status === "DNF" && settings.dnfScores)).length : null;
    for (const r of rows) points.set(r.id, pointsFor(r, table, settings, multiplier, r.id === fastest[s], reverseOf));
  }
  const quali = new Map();
  const qualiTable = parseTable(season?.qualiPointsTable);
  if (qualiTable && race.results.length) {
    for (const q of race.qualifying || []) {
      const p = qualiTable[q.position - 1] ?? 0;
      if (p) quali.set(q.driverId, p);
    }
  }
  return { points, fastest, quali };
}

// The pole sitter of a round: qualifying P1 if a qualifying was imported,
// else whoever started race 1 from grid slot 1.
export function poleDriverId(race) {
  const q = (race.qualifying || []).find((x) => x.position === 1);
  if (q) return q.driverId;
  const g = race.results.find((r) => sessionOf(r) === "R1" && r.grid === 1);
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
