// Consistent handling of race start times across the site.
//
// The stored race `date` is the real kickoff instant when the admin entered a
// time. Older/date-only entries were saved as plain dates and land on UTC
// midnight — for those the league's usual start applies: 19:00 German time
// (Fridays). "German time" moves with daylight saving, so the fallback is
// computed against Europe/Berlin rather than a fixed UTC hour; otherwise every
// countdown would drift an hour when the clocks change in late October.

const LEAGUE_TZ = "Europe/Berlin";
const LEAGUE_START_HOUR = 19;

// How long after lights-out a race still counts as "running". Past this
// window an uncompleted race is treated as awaiting its results instead of
// being pinned on LIVE forever (league races last well under two hours).
export const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

function berlinHour(t) {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: LEAGUE_TZ, hour: "2-digit", hour12: false }).format(t)
  );
}

// The UTC instant of <hour>:00 German time on the given (UTC-midnight) day.
// Tries both possible offsets (CEST/CET) and keeps the one that lands on the
// requested wall-clock hour in Berlin.
function atBerlinHour(day, hour) {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  const d = day.getUTCDate();
  for (const offset of [2, 1]) {
    const t = new Date(Date.UTC(y, m, d, hour - offset));
    if (berlinHour(t) === hour) return t;
  }
  return new Date(Date.UTC(y, m, d, hour - 1));
}

// The actual kickoff instant for a stored race date (or null): an explicit
// time is used as-is; a date-only entry falls back to the league start.
export function raceKickoff(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
    return atBerlinHour(d, LEAGUE_START_HOUR);
  }
  return d;
}

// Countdown phase for a race date at a given moment:
//   "upcoming" — kickoff is still ahead
//   "live"     — lights out, race presumably running (within LIVE_WINDOW_MS)
//   "finished" — past the window; results just aren't imported yet
//   null       — no usable date
export function racePhase(date, now = Date.now()) {
  const target = raceKickoff(date);
  if (!target) return null;
  const t = target.getTime();
  if (now < t) return "upcoming";
  if (now < t + LIVE_WINDOW_MS) return "live";
  return "finished";
}

// e.g. "20:00 CEST" / "19:00 GMT" depending on the viewer's zone. Formats the
// resolved kickoff, so date-only entries show the league start instead of a
// nonsensical midnight.
export function fmtRaceTime(date) {
  const target = raceKickoff(date);
  if (!target) return "";
  return target.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
