import { racePoints, sessionOf, sessionsOf, poleDriverId } from "./points.js";
import { round } from "./standings.js";

// Per-driver numbers for one season, from the same rounds the standings use
// (each with results and qualifying). Every race of a round counts: a round
// of two races is two starts.

const qualiPos = (race, driverId) => (race.qualifying || []).find((q) => q.driverId === driverId)?.position ?? null;
// the grid of race 1 follows the qualifying where the file gave none
const gridOf = (race, r) => r?.grid ?? (sessionOf(r) === "R1" ? qualiPos(race, r.driverId) : null) ?? null;
// the driver's result in each race of the round (null where they have none)
const racesOf = (race, driverId) => sessionsOf(race).map((s) => race.results.find((r) => r.driverId === driverId && sessionOf(r) === s) || null);

export function driverSeasonStats(driverId, races, settings, season) {
  const done = [...races].filter((r) => r.results?.length).sort((a, b) => a.round - b.round);
  const s = {
    starts: 0,
    wins: 0,
    podiums: 0,
    poles: 0,
    fastestLaps: 0,
    dnfs: 0,
    bestFinish: null,
    avgFinish: null,
    avgGrid: null,
    placesGained: 0,
  };
  const finishes = [];
  const grids = [];
  const form = [];

  for (const race of done) {
    const { points, fastest, quali } = racePoints(race, season, settings);
    const mine = racesOf(race, driverId);
    const q = qualiPos(race, driverId);
    if (!mine.some(Boolean) && q == null) continue;
    const pole = poleDriverId(race) === driverId;
    if (pole) s.poles++;
    let roundPoints = quali.get(driverId) || 0;
    let fastestLap = false;
    for (const r of mine) {
      if (!r) continue;
      roundPoints += points.get(r.id) || 0;
      if (r.status !== "DNS") s.starts++;
      if (r.status === "DNF") s.dnfs++;
      if (r.id === fastest[sessionOf(r)]) {
        s.fastestLaps++;
        fastestLap = true;
      }
      const grid = gridOf(race, r);
      if (grid != null) grids.push(grid);
      if (r.status === "FIN") {
        finishes.push(r.position);
        if (r.position === 1) s.wins++;
        if (r.position <= 3) s.podiums++;
        if (grid != null) s.placesGained += grid - r.position;
      }
    }
    form.push({
      raceId: race.id,
      round: race.round,
      track: race.track,
      name: race.name,
      races: mine.map((r) => (r ? { position: r.position, status: r.status } : null)),
      grid: mine[0] ? gridOf(race, mine[0]) : q,
      quali: q,
      points: round(roundPoints),
      fastestLap,
      pole,
    });
  }
  if (finishes.length) {
    s.bestFinish = Math.min(...finishes);
    s.avgFinish = round(finishes.reduce((a, b) => a + b, 0) / finishes.length);
  }
  if (grids.length) s.avgGrid = round(grids.reduce((a, b) => a + b, 0) / grids.length);
  return { stats: s, form };
}

// Two drivers of one season against each other: every race both started
// (who finished ahead), every qualifying both set a time in, and the points
// of the rounds both raced.
export function headToHead(aId, bId, races, settings, season) {
  const out = { rounds: [], race: { a: 0, b: 0 }, quali: { a: 0, b: 0 }, points: { a: 0, b: 0 } };
  for (const race of [...races].filter((r) => r.results?.length).sort((x, y) => x.round - y.round)) {
    const ra = racesOf(race, aId);
    const rb = racesOf(race, bId);
    const both = ra.map((x, i) => [x, rb[i]]).filter(([x, y]) => x && y && x.status !== "DNS" && y.status !== "DNS");
    if (!both.length) continue;
    const { points, quali } = racePoints(race, season, settings);
    const sum = (id) => race.results.filter((r) => r.driverId === id).reduce((t, r) => t + (points.get(r.id) || 0), quali.get(id) || 0);
    for (const [x, y] of both) out.race[x.position < y.position ? "a" : "b"]++;
    const qa = qualiPos(race, aId);
    const qb = qualiPos(race, bId);
    if (qa != null && qb != null) out.quali[qa < qb ? "a" : "b"]++;
    const pa = sum(aId);
    const pb = sum(bId);
    out.points.a += pa;
    out.points.b += pb;
    out.rounds.push({
      raceId: race.id,
      round: race.round,
      track: race.track,
      a: { races: ra.map((r) => (r ? { position: r.position, status: r.status } : null)), quali: qa, points: round(pa) },
      b: { races: rb.map((r) => (r ? { position: r.position, status: r.status } : null)), quali: qb, points: round(pb) },
    });
  }
  out.points.a = round(out.points.a);
  out.points.b = round(out.points.b);
  return out;
}

// The team a driver drives for at a round: the latest transfer that applies
// from that round or earlier, else the team they entered the season with.
export function teamAt({ entry, transfers }, roundNo) {
  let teamId = entry?.teamId ?? null;
  let best = null;
  for (const t of transfers) {
    if (t.fromRound > roundNo) continue;
    if (!best || t.fromRound > best.fromRound || (t.fromRound === best.fromRound && t.id > best.id)) best = t;
  }
  if (best) teamId = best.teamId ?? null;
  return teamId;
}

// Who turned up: every driver on the entry list (and every member who
// answered a sign-up without being on it) against every round. A round counts
// as raced when any of its races has a result that is not a DNS; a "yes" without a start
// on a finished round is a no-show.
export function attendance({ races, entries, signups }) {
  const ordered = [...races].sort((a, b) => a.round - b.round);
  const rows = new Map();
  const key = (driverId, userId) => (driverId ? `d${driverId}` : `u${userId}`);
  for (const e of entries) {
    rows.set(key(e.driverId), { driverId: e.driverId, userId: e.driver?.userId ?? null, name: e.driver?.name ?? "?", team: e.team?.name ?? null, cells: {} });
  }
  const byUser = new Map([...rows.values()].filter((r) => r.userId).map((r) => [r.userId, r]));
  for (const s of signups) {
    let row = byUser.get(s.userId);
    if (!row) {
      const driver = s.user?.driver;
      const k = key(driver?.id, s.userId);
      row = rows.get(k) || { driverId: driver?.id ?? null, userId: s.userId, name: driver?.name || s.user?.name || "?", team: null, cells: {} };
      rows.set(k, row);
      byUser.set(s.userId, row);
    }
    (row.cells[s.raceId] ??= {}).answer = s.status;
  }
  for (const race of ordered) {
    for (const r of race.results || []) {
      const row = rows.get(key(r.driverId));
      if (!row) continue;
      const cell = (row.cells[race.id] ??= {});
      // raced if they started any race of the round
      cell.raced = cell.raced || r.status !== "DNS";
    }
  }
  const done = ordered.filter((r) => r.results?.length);
  const out = [...rows.values()].map((row) => {
    let raced = 0;
    let answered = 0;
    let noShows = 0;
    for (const race of ordered) {
      const c = row.cells[race.id];
      if (!c) continue;
      if (c.raced) raced++;
      if (c.answer) answered++;
      if (c.answer === "in" && !c.raced && race.results?.length) {
        c.noShow = true;
        noShows++;
      }
    }
    return { ...row, raced, answered, noShows, of: done.length };
  });
  out.sort((a, b) => b.raced - a.raced || a.name.localeCompare(b.name));
  return {
    rounds: ordered.map((r) => ({ id: r.id, round: r.round, track: r.track, done: !!r.results?.length })),
    rows: out,
  };
}
