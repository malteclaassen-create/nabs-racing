// The actual kickoff instant for a stored race date. Mirror of the frontend's
// utils/raceTime.js: an explicit time is used as-is; a date-only entry (saved
// as UTC midnight) falls back to the league's usual start, 19:00 German time.
// The fallback is computed against Europe/Berlin so it follows daylight
// saving instead of drifting an hour when the clocks change.

const LEAGUE_TZ = "Europe/Berlin";
const LEAGUE_START_HOUR = 19;

function berlinHour(t) {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: LEAGUE_TZ, hour: "2-digit", hour12: false }).format(t)
  );
}

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

export function raceKickoff(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
    return atBerlinHour(d, LEAGUE_START_HOUR);
  }
  return d;
}
