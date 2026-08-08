// ---------------------------------------------------------------------------
// The site's formatting vocabulary: dates, lap times, and the one glyph that
// stands for "no value". Everything user-facing that turns a number or a
// timestamp into text belongs here.
//
// Why it exists: the same handful of jobs had grown fourteen date formats and
// seven lap-time functions, several of them byte-identical copies that had
// since drifted apart in the ways that matter — three different answers for an
// unusable lap ("-", "–", null), two of the seven missing the upper bound that
// keeps a pit lap out of a "best lap" column, and one using a different
// algorithm entirely. Two dates printed side by side could disagree about
// whether a weekday belongs there.
//
// Companion modules, kept separate on purpose:
//   raceTime.js     — WHEN a race starts (kickoff resolution, live window)
//   raceDuration.js — elapsed race time and gaps behind another car
// This module formats; those two decide what the number is.
// ---------------------------------------------------------------------------
import { raceKickoff } from "./raceTime.js";

// The dash that stands for a missing value, everywhere. An EN dash: the em
// dash is banned in user-facing text site-wide, and a plain hyphen reads as a
// minus sign next to numbers. Screen readers announce a bare dash as noise, so
// prefer the <NoData /> component in ui.jsx where markup is possible.
export const NO_VALUE = "–";

// Longest thing that can still be a lap time: 30 minutes. Above it the value
// is a pit lap or a red-flagged stint, and printing it as a lap makes a
// "best lap" column nonsense.
export const MAX_LAP_MS = 1_800_000;

export function isLapTime(ms) {
  return Number.isFinite(ms) && ms > 0 && ms <= MAX_LAP_MS;
}

// A lap time, "1:15.227". Returns null for anything that is not a lap, so the
// caller decides how a blank looks — `fmtLap(x) ?? NO_VALUE` in a table cell,
// or a conditional block where a missing lap should hide a whole row.
export function fmtLap(ms) {
  if (!isLapTime(ms)) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;
}

// A lap delta, "+0.213" / "−1.480". Signed, so it reads as a comparison
// rather than a duration. Uses the real minus sign, matching the points gaps
// in the standings.
export function fmtLapDelta(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const sign = ms < 0 ? "−" : "+";
  const abs = Math.abs(ms);
  const s = Math.floor(abs / 1000);
  return `${sign}${s}.${String(Math.floor(abs % 1000)).padStart(3, "0")}`;
}

// --- Dates -----------------------------------------------------------------
// Named formats, one job each. The names say what they are FOR, not what they
// look like, so a caller picks by intent and every screen showing the same kind
// of date agrees.
//
// All of them resolve a race date through raceKickoff() first. A date-only
// entry is stored at UTC midnight and means "19:00 German time"; formatting it
// raw printed the day BEFORE for every viewer west of UTC, right next to a
// kickoff time that had been resolved properly. Seven places did that.
const LOCALE = "en-GB";

const fmt = (date, opts) => {
  const d = raceKickoff(date) ?? (date ? new Date(date) : null);
  if (!d || isNaN(d.getTime())) return "";
  return d.toLocaleDateString(LOCALE, opts);
};

// "Fri 14 Aug" — a race in a list, a card, a countdown header. The workhorse.
export const fmtRaceDate = (d) => fmt(d, { weekday: "short", day: "2-digit", month: "short" });

// "Fri 14 Aug 2026" — the same, where the year matters (archives, admin lists
// spanning seasons).
export const fmtRaceDateFull = (d) => fmt(d, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

// "14 Aug" — tight spaces: chips, table cells, the calendar grid.
export const fmtDateShort = (d) => fmt(d, { day: "2-digit", month: "short" });

// "Friday 14 August 2026" — a headline naming one specific day.
export const fmtDateLong = (d) => fmt(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// "Friday" — a weekday on its own, for a countdown that names the day rather
// than the date ("racing on Friday"). Only meaningful inside a week.
export const fmtWeekday = (d) => fmt(d, { weekday: "long" });

// "14 Aug 2026" — a record's timestamp (uploads, member joins, feedback):
// administrative dates, where a weekday is noise.
export const fmtStamp = (d) => fmt(d, { day: "2-digit", month: "short", year: "numeric" });

// "14 Aug 2026, 19:04" — a stamp that needs the time too (health checks, logs).
export function fmtStampTime(date) {
  const d = date ? new Date(date) : null;
  if (!d || isNaN(d.getTime())) return "";
  return d.toLocaleString(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
