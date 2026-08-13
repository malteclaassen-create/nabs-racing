// ---------------------------------------------------------------------------
// One question about a standings row, asked in several places: did this person
// actually take part in the season?
//
// Why it matters: the standings are computed for EVERY driver on the roster,
// and a season's reserve pool is the whole sign-up list. Most of that list
// never gets in a car, so those rows are identical zeroes that still receive a
// position — which is nothing more than where an empty row happened to land in
// the sort. The Driver Standings page leaves them out for that reason. Any
// other page that prints a P-number has to leave it out too, or a reserve who
// never started a round reads "P54" on their own profile and then cannot find
// themselves anywhere in the table that number claims to come from.
//
// A start counts even when it ended in a DNF and scored nothing — they turned
// up and drove — which is why this asks perRace rather than the total. Points
// without any per-race rows is an archived season stored as official totals
// only; there the total is the only evidence of a season raced, and it counts.
//
// Related, deliberately not merged: filterStandings in resultGraphic.js (and
// its twin in the backend's resultsPostService) answers the same question for
// the poster and the Discord post, where the table is also re-ranked 1..n.
// ---------------------------------------------------------------------------

// Did this driver race in the season this row belongs to?
export function hasRaced(row) {
  if (!row) return false;
  return Object.keys(row.perRace || {}).length > 0 || (row.total || 0) > 0;
}

// A reserve who signed up and never drove: on the roster, in the standings
// data, part of no championship. Exactly the rows the standings table hides.
export function isIdleReserve(row) {
  return !!row && row.tier === 0 && !hasRaced(row);
}
