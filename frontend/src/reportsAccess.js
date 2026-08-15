// ---------------------------------------------------------------------------
// Whether members can see any door to incident reports.
//
// One constant, asked by every entry point there is — the home page, a round on
// the Races page, the burger menu and the Personal Area — so turning reporting
// off for a week closes all of them and leaves none open.
//
// A switch rather than deleted code: a league might want it quiet for a while,
// and re-deleting four buttons is not a thing anybody should have to do twice.
// ---------------------------------------------------------------------------
export const REPORTS_OPEN_TO_MEMBERS = true;

// Where every one of those doors leads. A page, not a floating panel: a report
// is a conversation with pictures in it, and one place to read and write it
// beats a window for writing and a page for reading. `raceId` preselects the
// round, which is the one thing a driver would otherwise pick out of a list of
// forty.
// --- when the hero's report button is up ------------------------------------
//
// The button in the hero is not a permanent fixture, it is the race night's.
// It exists so that a driver who has never gone looking for stewarding can
// find it at nine on a Friday with a bent wing — and a week later, with the
// round decided and the next one not run, it is a large invitation to relitigate
// something that is closed.
//
// So it comes up with the session and goes down on the Monday. The other doors
// (the burger menu, the Races page, the Personal Area) stay open the whole time:
// this hides one button, it does not close reporting.
//
// "The Monday" is midnight at the END of the second full day after the race —
// Friday's round is reportable through Saturday and Sunday and gone when Monday
// starts. Written as "race day + 2 whole days" rather than "the next Monday" so
// a series that races on another day (there is a Sunday one in the schema) gets
// the same two days rather than four hours.
const LEAGUE_TZ = "Europe/Berlin";
const DAYS_AFTER = 2;
// Grid, formation and a red-flag restart all happen before the scheduled time
// means anything, and an incident in any of them is reportable. Same hour of
// slack the in-game ingest gives itself when it decides which round a report
// belongs to (backend routes/reports.js).
const OPENS_BEFORE_MS = 60 * 60 * 1000;

// What Europe/Berlin's clock reads at an instant, as civil parts.
function berlinParts(t) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LEAGUE_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const p = {};
  for (const x of parts) p[x.type] = x.value;
  return p;
}

// The instant at which a given civil midnight in the league's timezone happens.
// Guess UTC midnight, ask what Berlin called that moment, and correct by the
// difference. Off by an hour only for a cutoff falling inside the one hour a
// year the clocks go back, which costs a button an hour on a Sunday night.
function leagueMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  const p = berlinParts(guess);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return guess - (asUtc - guess);
}

// Is the button up for a round that started at `raceDate`? False for no date,
// an unparseable one, or a round whose evening is over.
export function reportsWindowOpen(raceDate, now = Date.now()) {
  if (!raceDate) return false;
  const start = new Date(raceDate).getTime();
  if (!Number.isFinite(start)) return false;
  if (now < start - OPENS_BEFORE_MS) return false;
  const p = berlinParts(start);
  // The midnight that STARTS the day after the last reportable one.
  return now < leagueMidnight(+p.year, +p.month, +p.day + DAYS_AFTER + 1);
}

export function reportsPath({ nw = false, raceId = null } = {}) {
  const q = new URLSearchParams();
  if (nw) q.set("new", "1");
  if (raceId) q.set("race", raceId);
  const s = q.toString();
  return `/reports${s ? `?${s}` : ""}`;
}
