// ---------------------------------------------------------------------------
// Rounds that have been run but have no result on the site.
//
// Importing a round is the one job of a race weekend that nothing reminds
// anybody about. The race is on Friday night, the result file sits on the race
// server, and the calendar goes on saying "upcoming" for a race that finished
// days ago until somebody happens to notice. The admin's To do card lists
// these, so the reminder is where the work starts.
//
// Only CHAMPIONSHIP rounds count: a training night or a special event is often
// never imported at all, and that is fine. A sprint weekend's sprint is part of
// its round (a hidden child row, lib/sprintRaces.js) and never a line of its
// own. The twelve hours are the race night itself plus some slack, so a round
// does not appear as overdue while it is still being driven, or at midnight
// before anyone could reasonably have got to it.
//
// Pure, so the rule can be tested without a database.
// ---------------------------------------------------------------------------

export const OVERDUE_AFTER_MS = 12 * 60 * 60 * 1000;

// `races`: rows with { id, number, track, date, isCompleted, isSpecialEvent,
// resultCount }. `typeOf` maps an id to its type (lib/raceTypes.js; missing =
// derived from isSpecialEvent), `sprintChildIds` holds the ids of sprint rows.
// Oldest first: the round that has waited longest is the first to fix.
export function overdueRounds(races, { now = Date.now(), typeOf = new Map(), sprintChildIds = new Set() } = {}) {
  const out = [];
  for (const r of races || []) {
    if (!r || sprintChildIds.has(r.id)) continue;
    const type = typeOf.get(r.id) || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
    if (type !== "CHAMPIONSHIP") continue;
    if (r.isCompleted || (r.resultCount || 0) > 0) continue;
    const at = r.date ? new Date(r.date).getTime() : NaN;
    if (!Number.isFinite(at) || now - at <= OVERDUE_AFTER_MS) continue;
    out.push({ raceId: r.id, number: r.number ?? null, track: r.track || "", date: new Date(at).toISOString() });
  }
  return out.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
