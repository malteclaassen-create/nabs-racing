// Where the series switcher lands when you pick a different series.
//
// The rule is "stay where you are". Everything under /s/<slug>/ keeps its
// section, and the pages that have no /s/<slug> at all (the admin, your
// profile, Race Info, the tools) keep the whole address: those are shared
// across series but still SHOW one, which they read off the sticky selection
// in SeriesContext rather than off the URL. So the switch there points that
// selection somewhere else and touches nothing about where you are.
//
// The one thing that cannot carry over is a deep page: the id in
// /s/<slug>/drivers/<id> belongs to the OLD series. Those fall back to the
// section's own list, or to the series home when the section has no list of
// its own (a race recap: /s/<slug>/recap is not a page).

// Sections that ARE a page of their own, so a deep page below them has
// somewhere to fall back to.
const LISTS = ["drivers", "constructors", "teams", "records", "transfers", "races", "results", "calendar", "attendance", "live"];

// Returns the path to navigate to, or null for "stay on this page and only
// change the series behind it".
export function seriesSwitchTarget(pathname, slug) {
  const m = /^\/s\/([^/]+)((?:\/[^/]+)*)\/?$/.exec(pathname || "");
  if (!m) return null;
  const segments = m[2].split("/").filter(Boolean);
  const deep = segments.length > 1;
  const section = !segments.length || (deep && !LISTS.includes(segments[0])) ? "" : `/${segments[0]}`;
  return `/s/${slug}${section}`;
}
