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
export function reportsPath({ nw = false, raceId = null } = {}) {
  const q = new URLSearchParams();
  if (nw) q.set("new", "1");
  if (raceId) q.set("race", raceId);
  const s = q.toString();
  return `/reports${s ? `?${s}` : ""}`;
}
