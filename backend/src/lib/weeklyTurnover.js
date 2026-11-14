// The league's week turns over at the race, every week, whether or not that
// race is on the calendar. A training race nobody entered on the site, a free
// Friday between two rounds, the break after the last round of a season: the
// training laps and the Discord activity still start again from nothing at the
// usual time, a week after the last race that IS on the calendar.
//
// These are the stand-in turnovers for such weeks: the same weekday and the same
// Berlin wall-clock time as the last real race, one week apart. A stand-in that
// would land within a few days of the next real race is left out, so a round
// that moved by a day or two does not get a tiny extra week in front of it.

import { LEAGUE_TZ } from "./raceKickoff.js";

const WEEK_MS = 7 * 24 * 3600_000;
// Closer than this to the next real race and the stand-in is dropped.
const NEAR_REAL_MS = 3 * 24 * 3600_000;

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: LEAGUE_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// How far Berlin is ahead of UTC at an instant, in ms.
function berlinOffset(t) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

// The same Berlin time `weeks` weeks on, so 19:30 stays 19:30 when the clocks
// change in between.
export function sameTimeWeeksLater(t, weeks) {
  const guess = t + weeks * WEEK_MS;
  return guess + (berlinOffset(t) - berlinOffset(guess));
}

// Stand-in turnovers falling in [from, until], given the real race starts
// (instants, any order). Every gap of more than a week between two real races
// gets them, and so does the time after the last one.
export function weeklyTurnovers(realStarts, { from = -Infinity, until = Date.now() } = {}) {
  const starts = [...new Set(realStarts.filter((t) => Number.isFinite(t)))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const next = i + 1 < starts.length ? starts[i + 1] : Infinity;
    for (let k = 1; ; k++) {
      const t = sameTimeWeeksLater(starts[i], k);
      if (t > until || t > next - NEAR_REAL_MS) break;
      if (t >= from) out.push(t);
    }
  }
  return out;
}
