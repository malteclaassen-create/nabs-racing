import { racePoints, sessionOf, poleDriverId, raceCountOf, raceNumber } from "./points.js";

// Driver and team standings of a season, worked out from the stored results
// every time (see points.js for why nothing is stored).
//
//   races         the season's rounds, each with `results` (with `driver` and
//                 `team`) and `qualifying`
//   season        for its points tables, dropWorst and champion
//   manualPoints  [{ driverId, points, note }]
//
// A round scores all its races plus the qualifying points. With dropWorst N, each driver's N lowest
// round scores (a round not raced counts 0) are left out of the total and
// marked `dropped`. Ties are split by countback of the race finishes: more
// wins, then more second places, and so on. A champion named by hand goes
// to the top.
export function buildStandings(races, settings, { season = null, manualPoints = [] } = {}) {
  const ordered = [...races].sort((a, b) => a.round - b.round);
  const done = ordered.filter((r) => r.results?.length);
  const drivers = new Map();
  const teams = new Map();

  const driverEntry = (r) => {
    if (!drivers.has(r.driverId)) {
      drivers.set(r.driverId, {
        id: r.driverId,
        name: r.driver?.name ?? "?",
        number: r.driver?.number ?? null,
        country: r.driver?.country ?? null,
        team: null,
        raw: 0,
        finishes: [],
        rounds: {},
      });
    }
    return drivers.get(r.driverId);
  };
  const teamEntry = (r) => {
    if (!teams.has(r.teamId)) {
      teams.set(r.teamId, { id: r.teamId, name: r.team?.name ?? "?", color: r.team?.color ?? null, raw: 0, finishes: [], rounds: {} });
    }
    return teams.get(r.teamId);
  };

  for (const race of done) {
    const { points, fastest, quali } = racePoints(race, season, settings);
    const pole = poleDriverId(race);
    const count = raceCountOf(race);
    const roundOf = (d) => (d.rounds[race.id] ??= { points: 0, pole: pole === d.id, races: Array(count).fill(null) });
    for (const r of race.results) {
      const p = points.get(r.id) || 0;
      const s = sessionOf(r);
      const d = driverEntry(r);
      d.raw += p;
      // the team of the latest round they raced decides the table's team
      if (r.team) d.team = { id: r.team.id, name: r.team.name, color: r.team.color ?? null };
      const round = roundOf(d);
      round.points += p;
      round.races[raceNumber(s) - 1] = { position: r.position, status: r.status, points: p, fastestLap: r.id === fastest[s] };
      if (r.status === "FIN") d.finishes.push(r.position);
      if (r.teamId) {
        const t = teamEntry(r);
        t.raw += p;
        if (r.status === "FIN") t.finishes.push(r.position);
        (t.rounds[race.id] ??= { points: 0 }).points += p;
      }
    }
    // qualifying points go to the driver, and to the team of their race
    for (const [driverId, p] of quali) {
      const r = race.results.find((x) => x.driverId === driverId);
      if (!r) continue;
      const d = driverEntry(r);
      d.raw += p;
      const round = roundOf(d);
      round.points += p;
      round.qualiPoints = p;
      if (r.teamId) {
        const t = teamEntry(r);
        t.raw += p;
        (t.rounds[race.id] ??= { points: 0 }).points += p;
      }
    }
  }

  // Dropped rounds and manual points.
  const drop = Math.max(0, season?.dropWorst || 0);
  const manualByDriver = new Map();
  for (const m of manualPoints) {
    const list = manualByDriver.get(m.driverId) || [];
    list.push(m);
    manualByDriver.set(m.driverId, list);
  }
  for (const d of drivers.values()) {
    let dropped = 0;
    if (drop > 0 && done.length > drop) {
      const scores = done.map((race) => ({ id: race.id, points: d.rounds[race.id]?.points ?? 0, round: race.round }));
      scores.sort((a, b) => a.points - b.points || a.round - b.round);
      for (const s of scores.slice(0, drop)) {
        dropped += s.points;
        if (d.rounds[s.id]) d.rounds[s.id].dropped = true;
      }
    }
    const manual = manualByDriver.get(d.id) || [];
    d.manual = manual.length ? manual.reduce((sum, m) => sum + m.points, 0) : 0;
    d.manualNotes = manual.map((m) => m.note).filter(Boolean);
    d.points = d.raw - dropped + d.manual;
    d.droppedPoints = dropped;
  }
  for (const t of teams.values()) t.points = t.raw;

  let driverRows = rank([...drivers.values()]);
  if (season?.championId) {
    const i = driverRows.findIndex((d) => d.id === season.championId);
    if (i > 0) {
      const [champ] = driverRows.splice(i, 1);
      driverRows.unshift(champ);
      driverRows = driverRows.map((d, n) => ({ ...d, position: n + 1 }));
    }
    if (driverRows[0]?.id === season.championId) {
      driverRows[0] = { ...driverRows[0], champion: true, championNote: season.championNote || null };
    }
  }

  const teamRows = rank([...teams.values()]);
  return {
    rounds: ordered.map((r) => ({
      id: r.id,
      round: r.round,
      name: r.name,
      // a mystery track stays hidden until the round is raced
      track: r.mysteryTrack && !r.results?.length ? null : r.track,
      done: !!r.results?.length,
      raceCount: raceCountOf(r),
    })),
    drivers: driverRows,
    teams: teamRows,
    progression: progression(done, driverRows, teamRows),
  };
}

// Cumulative points after each finished round, from the round scores as
// they were raced (drops and manual points only touch the final total).
function progression(done, driverRows, teamRows) {
  const line = (row) => {
    let sum = 0;
    return done.map((race) => (sum = round(sum + (row.rounds[race.id]?.points ?? 0))));
  };
  return {
    rounds: done.map((r) => ({ id: r.id, round: r.round, track: r.track })),
    drivers: driverRows.map((d) => ({ id: d.id, name: d.name, color: d.team?.color ?? null, values: line(d) })),
    teams: teamRows.map((t) => ({ id: t.id, name: t.name, color: t.color, values: line(t) })),
  };
}

function countback(a, b) {
  const last = Math.max(0, ...a, ...b);
  for (let pos = 1; pos <= last; pos++) {
    const diff = b.filter((p) => p === pos).length - a.filter((p) => p === pos).length;
    if (diff) return diff;
  }
  return 0;
}

function rank(list) {
  const sorted = [...list].sort((a, b) => b.points - a.points || countback(a.finishes, b.finishes) || a.name.localeCompare(b.name));
  return sorted.map((e, i) => {
    const { finishes, raw, ...rest } = e;
    return {
      ...rest,
      position: i + 1,
      points: round(e.points),
      wins: finishes.filter((p) => p === 1).length,
      podiums: finishes.filter((p) => p <= 3).length,
      // kept for countback when the list is ranked again
      finishes,
      raw,
    };
  });
}

export const round = (n) => Math.round(n * 100) / 100;

// What goes out to the browser: the standings without the working fields.
export function publicStandings(s) {
  const clean = ({ finishes, raw, ...rest }) => rest;
  return { ...s, drivers: s.drivers.map(clean), teams: s.teams.map(clean) };
}
