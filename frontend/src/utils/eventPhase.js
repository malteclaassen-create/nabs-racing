import { raceKickoff, LIVE_WINDOW_MS } from "./raceTime.js";

// A special event (Series.kind "event") is one race in a series of its own,
// and its home page and nav bar change with where that race stands:
//   "before"  — still to come (or no date yet): the film, the countdown, the
//               seat map, Sign up.
//   "live"    — lights out until the live window closes: the running order.
//   "pending" — the race has been run, its result is not in yet.
//   "after"   — the result is in: the winner, the podium, the ways back in.
//   "none"    — the series has no race at all yet.

const DAY_MS = 24 * 3600e3;

// The race the event is about, out of its season's races (api.races()):
// scored rounds only (a sprint or training row is not the event), the first
// one still to come, else the last one it had. Same rule as the server's
// eventRaceOf (backend routes/series.js), so page and switcher agree.
export function eventRace(races, now = Date.now()) {
  const rounds = (races || []).filter((r) => !r.isSpecialEvent && !r.sprintOf);
  const when = (r) => raceKickoff(r.date)?.getTime() ?? NaN;
  const upcoming = rounds
    .filter((r) => !r.isCompleted && (!r.date || when(r) > now - DAY_MS))
    .sort((a, b) => (Number.isNaN(when(a)) ? 1 : Number.isNaN(when(b)) ? -1 : when(a) - when(b)));
  if (upcoming.length) return upcoming[0];
  const past = rounds.filter((r) => r.date).sort((a, b) => when(b) - when(a));
  return past[0] || rounds[0] || null;
}

export function eventPhase(race, now = Date.now()) {
  if (!race) return "none";
  if (race.isCompleted) return "after";
  const kickoff = raceKickoff(race.date)?.getTime();
  if (kickoff == null || now < kickoff) return "before";
  if (now < kickoff + LIVE_WINDOW_MS) return "live";
  return "pending";
}
