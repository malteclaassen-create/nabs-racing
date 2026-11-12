// ---------------------------------------------------------------------------
// The decisions of the "Prepare a new season" guide (AdminSeasonWizard.jsx),
// kept free of React so they can be tested.
//
// A season follows on from an earlier one: of its own series (the usual
// rollover), or of ANOTHER championship (a second division racing the same
// teams under the same points, with its own drivers and standings). From
// another series the teams and the scoring come along; the drivers never do.
// ---------------------------------------------------------------------------

// A season's points table as an array, from the JSON string the admin season
// list carries (or an array already). null = the league default table.
export function parseTable(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw || "null");
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// The number the next season of this series gets: one past the highest.
export function nextSeasonNumber(list) {
  return (list || []).reduce((m, s) => Math.max(m, Number(s.number) || 0), 0) + 1;
}

// Out of every series' seasons (api.adminSeasonsAllSeries), the ones another
// championship holds: not this series' own, and no special events (a one-off
// race weekend, nothing to follow on from).
export function otherChampionshipSeasons(all, own) {
  const ownIds = new Set((own || []).map((s) => s.id));
  return (all || []).filter((s) => !ownIds.has(s.id) && s.seriesKind !== "event");
}

// Those seasons as picker groups, one per series, in the order they came
// (the admin list is newest season first): [{ seriesId, name, seasons }].
export function groupBySeries(others) {
  const groups = [];
  for (const s of others || []) {
    let g = groups.find((x) => x.seriesId === (s.seriesId ?? null));
    if (!g) groups.push((g = { seriesId: s.seriesId ?? null, name: s.seriesName || "Other series", seasons: [] }));
    g.seasons.push(s);
  }
  return groups;
}

// Which season the guide copies from, and whether it is another series':
// { source, crossSeries, sourceName }. The name says the series when it is
// another one ("Div 1 Season 8"), since every series has a "Season 8".
export function resolveSource(own, others, id) {
  if (!id) return { source: null, crossSeries: false, sourceName: "" };
  const mine = (own || []).find((s) => s.id === id);
  if (mine) return { source: mine, crossSeries: false, sourceName: mine.name };
  const theirs = (others || []).find((s) => s.id === id);
  if (!theirs) return { source: null, crossSeries: false, sourceName: "" };
  return { source: theirs, crossSeries: true, sourceName: `${theirs.seriesName || "Other series"} ${theirs.name}` };
}

// The form the guide starts with: following on from this series' active
// season (or its newest), numbered one past the highest.
export function initialForm(own) {
  const list = own || [];
  const active = list.find((s) => s.isActive) || list[0] || null;
  const n = nextSeasonNumber(list);
  return { fromId: active?.id || "", number: String(n), name: `Season ${n}`, game: "", keepScoring: true };
}

// The form after picking `id` as the season to follow on from. A series with
// no seasons of its own yet (a new division) usually numbers its first season
// like the one it starts next to, so it takes that number and name. Anything
// the admin typed stays otherwise.
export function formForSource(form, id, own, others) {
  const next = { ...form, fromId: id };
  const picked = (others || []).find((s) => s.id === id);
  if (picked && !(own || []).length) {
    next.number = String(picked.number);
    next.name = picked.name;
  }
  return next;
}

// The scoring fields the new season takes over from `source`, merged into the
// create body. Nothing without a source or with the box unticked.
export function scoringFrom(source, keep = true) {
  if (!keep || !source) return {};
  const out = { dropWorst: source.dropWorst, pointsTable: parseTable(source.pointsTable) };
  if (source.teamDropWorst != null) out.teamDropWorst = source.teamDropWorst;
  if (source.teamDropMode) out.teamDropMode = source.teamDropMode;
  if (source.fastestLapPoints) out.fastestLapPoints = source.fastestLapPoints;
  return out;
}

// What step 2 ("Bring the field over") offers, from the season's counts:
//   "teams-from-other"  another series' season: its teams only, drivers by hand
//   "copy-from-source"  teams and drivers, or teams only, from the source
//   "teams-by-hand"     no source: add the teams by hand
//   "drivers-from-source" teams are in: the source's drivers, or by hand
//   "drivers-by-hand"   teams are in, drivers by hand only
//   "check"             teams and drivers are both in
// Copying drivers across series is never offered: they are another
// division's people, and the copy would link their careers into this one.
export function fieldStep({ teams = 0, drivers = 0, source = null, crossSeries = false } = {}) {
  if (teams > 0 && drivers > 0) return "check";
  if (teams > 0) return source && !crossSeries ? "drivers-from-source" : "drivers-by-hand";
  if (!source) return "teams-by-hand";
  return crossSeries ? "teams-from-other" : "copy-from-source";
}
