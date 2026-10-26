import { sessionOf, poleDriverId, orderWithPenalties } from "./points.js";

// A season told in a few numbers, for the series page once it is over:
// rounds and races run, how many drivers started, how many won a race, who
// won most and who took most poles, and the closest finish between the
// winner and the next car home. `standings` names the champion.
//
//   races      the season's rounds with `results` (with `driver`) and `qualifying`
export function seasonNumbers(races, standings) {
  const raced = races.filter((r) => r.results.length);
  if (!raced.length) return null;
  const names = new Map();
  const wins = new Map();
  const poles = new Map();
  const starters = new Set();
  let raceCount = 0;
  let closest = null;
  const add = (map, id) => map.set(id, (map.get(id) || 0) + 1);

  for (const race of raced) {
    for (const r of race.results) {
      names.set(r.driverId, r.driver?.name ?? "?");
      if (r.status !== "DNS") starters.add(r.driverId);
    }
    for (const q of race.qualifying || []) if (q.driver) names.set(q.driverId, q.driver.name);
    const pole = poleDriverId(race);
    if (pole) add(poles, pole);
    const sessions = [...new Set(race.results.map(sessionOf))];
    for (const s of sessions) {
      raceCount++;
      const order = orderWithPenalties(race.results.filter((r) => sessionOf(r) === s));
      const [first, second] = order;
      if (first?.status === "FIN") add(wins, first.driverId);
      const time = (r) => (r?.totalTimeMs != null ? r.totalTimeMs + (r.penaltyMs || 0) : null);
      if (first?.status === "FIN" && second?.status === "FIN" && first.laps === second.laps && time(first) != null && time(second) != null) {
        const gapMs = time(second) - time(first);
        if (gapMs >= 0 && (!closest || gapMs < closest.gapMs)) {
          closest = { gapMs, raceId: race.id, round: race.round, name: race.name, race: sessions.length > 1 ? Number(s.slice(1)) : null, winner: names.get(first.driverId), second: names.get(second.driverId) };
        }
      }
    }
  }
  const most = (map) => {
    const top = Math.max(0, ...map.values());
    if (!top) return null;
    const ids = [...map].filter(([, n]) => n === top).map(([id]) => id);
    return { count: top, drivers: ids.map((id) => ({ id, name: names.get(id) ?? "?" })) };
  };
  const champ = standings?.drivers?.[0] || null;
  return {
    rounds: raced.length,
    races: raceCount,
    drivers: starters.size,
    winners: wins.size,
    mostWins: most(wins),
    mostPoles: most(poles),
    closest,
    champion: champ ? { id: champ.id, name: champ.name, points: champ.points, wins: champ.wins } : null,
  };
}
