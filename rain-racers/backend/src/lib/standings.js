import { racePoints } from "./points.js";

// Driver and team standings of a season, worked out from the stored results
// every time (see points.js for why nothing is stored).
//
// `races` come with their results, each result with `driver` and `team`.
// Ties are split by countback: more wins, then more second places, and so on.
export function buildStandings(races, settings) {
  const ordered = [...races].sort((a, b) => a.round - b.round);
  const drivers = new Map();
  const teams = new Map();

  const entry = (map, id, base) => {
    if (!map.has(id)) map.set(id, { ...base, points: 0, finishes: [], rounds: {} });
    return map.get(id);
  };

  for (const race of ordered) {
    if (!race.results?.length) continue;
    const { points, fastestId } = racePoints(race, settings);
    for (const r of race.results) {
      const p = points.get(r.id) || 0;
      const d = entry(drivers, r.driverId, {
        id: r.driverId,
        name: r.driver?.name ?? "?",
        number: r.driver?.number ?? null,
        country: r.driver?.country ?? null,
        // the team they drive for now, else the last one they raced for
        team: r.driver?.team ? pickTeam(r.driver.team) : r.team ? pickTeam(r.team) : null,
      });
      d.points += p;
      if (r.status === "FIN") d.finishes.push(r.position);
      d.rounds[race.id] = { position: r.position, status: r.status, points: p, fastestLap: r.id === fastestId };
      if (!r.driver?.team && r.team) d.team = pickTeam(r.team);

      if (r.teamId) {
        const t = entry(teams, r.teamId, { id: r.teamId, name: r.team?.name ?? "?", color: r.team?.color ?? null });
        t.points += p;
        if (r.status === "FIN") t.finishes.push(r.position);
        const round = (t.rounds[race.id] ??= { points: 0 });
        round.points += p;
      }
    }
  }

  return {
    rounds: ordered.map((r) => ({ id: r.id, round: r.round, name: r.name, track: r.track, done: !!r.results?.length })),
    drivers: rank([...drivers.values()]),
    teams: rank([...teams.values()]),
  };
}

function pickTeam(t) {
  return { id: t.id, name: t.name, color: t.color ?? null };
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
  list.sort((a, b) => b.points - a.points || countback(a.finishes, b.finishes) || a.name.localeCompare(b.name));
  return list.map((e, i) => {
    const { finishes, ...rest } = e;
    return {
      ...rest,
      position: i + 1,
      points: round(e.points),
      wins: finishes.filter((p) => p === 1).length,
      podiums: finishes.filter((p) => p <= 3).length,
    };
  });
}

const round = (n) => Math.round(n * 100) / 100;
