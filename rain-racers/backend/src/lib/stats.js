import { racePoints, sessionOf, poleDriverId } from "./points.js";
import { round } from "./standings.js";

// Per-driver numbers for one season, from the same rounds the standings use
// (each with results and qualifying). `race.season` may be absent; the points
// then use the season passed in.

const feature = (race, driverId) => race.results.find((r) => r.driverId === driverId && sessionOf(r) === "FEATURE");
const sprint = (race, driverId) => race.results.find((r) => r.driverId === driverId && sessionOf(r) === "SPRINT");
const qualiPos = (race, driverId) => (race.qualifying || []).find((q) => q.driverId === driverId)?.position ?? null;
const gridOf = (race, r) => r?.grid ?? qualiPos(race, r?.driverId) ?? null;

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
    sprintWins: 0,
    sprintPodiums: 0,
  };
  const finishes = [];
  const grids = [];
  const form = [];

  for (const race of done) {
    const { points, fastest } = racePoints(race, season, settings);
    const f = feature(race, driverId);
    const sp = sprint(race, driverId);
    const q = qualiPos(race, driverId);
    if (!f && !sp && q == null) continue;
    if (poleDriverId(race) === driverId) s.poles++;
    let roundPoints = 0;
    if (f) {
      roundPoints += points.get(f.id) || 0;
      if (f.status !== "DNS") s.starts++;
      if (f.status === "DNF") s.dnfs++;
      if (f.id === fastest.FEATURE) s.fastestLaps++;
      const grid = gridOf(race, f);
      if (grid != null) grids.push(grid);
      if (f.status === "FIN") {
        finishes.push(f.position);
        if (f.position === 1) s.wins++;
        if (f.position <= 3) s.podiums++;
        if (grid != null) s.placesGained += grid - f.position;
      }
    }
    if (sp) {
      roundPoints += points.get(sp.id) || 0;
      if (sp.status === "FIN" && sp.position === 1) s.sprintWins++;
      if (sp.status === "FIN" && sp.position <= 3) s.sprintPodiums++;
    }
    form.push({
      raceId: race.id,
      round: race.round,
      track: race.track,
      name: race.name,
      finish: f ? { position: f.position, status: f.status } : null,
      sprint: sp ? { position: sp.position, status: sp.status } : null,
      grid: f ? gridOf(race, f) : null,
      quali: q,
      points: round(roundPoints),
      fastestLap: !!f && f.id === fastest.FEATURE,
      pole: poleDriverId(race) === driverId,
    });
  }
  if (finishes.length) {
    s.bestFinish = Math.min(...finishes);
    s.avgFinish = round(finishes.reduce((a, b) => a + b, 0) / finishes.length);
  }
  if (grids.length) s.avgGrid = round(grids.reduce((a, b) => a + b, 0) / grids.length);
  return { stats: s, form };
}

// Two drivers of one season against each other, over the rounds both took
// part in: who finished ahead (a finisher beats a DNF, a DNF on more laps
// beats one on fewer), who qualified ahead, and the points of those rounds.
export function headToHead(aId, bId, races, settings, season) {
  const out = { rounds: [], race: { a: 0, b: 0 }, quali: { a: 0, b: 0 }, points: { a: 0, b: 0 } };
  for (const race of [...races].filter((r) => r.results?.length).sort((x, y) => x.round - y.round)) {
    const fa = feature(race, aId);
    const fb = feature(race, bId);
    if (!fa || !fb || fa.status === "DNS" || fb.status === "DNS") continue;
    const { points } = racePoints(race, season, settings);
    const pa = race.results.filter((r) => r.driverId === aId).reduce((sum, r) => sum + (points.get(r.id) || 0), 0);
    const pb = race.results.filter((r) => r.driverId === bId).reduce((sum, r) => sum + (points.get(r.id) || 0), 0);
    const aAhead = fa.position < fb.position;
    out.race[aAhead ? "a" : "b"]++;
    const qa = qualiPos(race, aId);
    const qb = qualiPos(race, bId);
    if (qa != null && qb != null) out.quali[qa < qb ? "a" : "b"]++;
    out.points.a += pa;
    out.points.b += pb;
    out.rounds.push({
      raceId: race.id,
      round: race.round,
      track: race.track,
      a: { position: fa.position, status: fa.status, quali: qa, points: round(pa) },
      b: { position: fb.position, status: fb.status, quali: qb, points: round(pb) },
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
// as raced when there is a result that is not a DNS; a "yes" without a start
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
      if (sessionOf(r) !== "FEATURE") continue;
      const row = rows.get(key(r.driverId));
      if (!row) continue;
      (row.cells[race.id] ??= {}).raced = r.status !== "DNS";
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
