// One question about a driver standings row: did this person actually take
// part in the season?
//
// The standings are computed for EVERY driver on the roster, and a season's
// reserve pool is the whole sign-up list — most of which never gets in a car.
// Those rows are identical zeroes that still carry a position, which is only
// where an empty row landed in the sort. The Driver Standings page leaves them
// out; anything that hands a P-number to a single driver (the public profile's
// scoreboard, the private Cockpit) has to withhold it from the same rows, or a
// reserve who never started a round reads a championship place on their own
// page and then cannot find themselves in the table it came from.
//
// A start counts even when it ended in a DNF and scored nothing — they turned
// up and drove — which is why this asks perRace rather than the total. Points
// with no per-race rows at all is an archived season stored as official totals
// only; there the total is the only evidence of a season raced, and it counts.
//
// The frontend keeps the same rule in utils/standingsRow.js, for the tables it
// filters in the browser. If either changes, change both.

// Did this driver race in the season this row belongs to?
export function hasRaced(row) {
  if (!row) return false;
  return Object.keys(row.perRace || {}).length > 0 || (row.total || 0) > 0;
}

// A reserve who signed up and never drove: on the roster, in the standings
// data, part of no championship.
export function isIdleReserve(row) {
  return !!row && row.tier === 0 && !hasRaced(row);
}
