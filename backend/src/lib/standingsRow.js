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

// ---------------------------------------------------------------------------
// EVERY CLASSIFICATION OF A ROUND. A sprint weekend is one round with two
// races, and the sprint's result rides on the round's cell as `sprint` (see
// standingsService.buildDriverPerRace and the profile's own perRace). The
// league counts both: a sprint win IS a win, a sprint podium IS a podium —
// which is how the sprints were scored before the site existed, and what the
// Hall of Fame, the profile tiles and the standings countback all read now.
//
// What does NOT go through here: starts, averages, best/worst finish, places
// gained and the grid stats. Those stay per ROUND — a sprint weekend is one
// race night, so counting it as two starts would quietly halve everybody's
// win rate on a league that runs a sprint every round.
//
// The frontend keeps the same rule in utils/standingsRow.js. If either
// changes, change both.
// ---------------------------------------------------------------------------

// The round cells of a standings row ({ [roundNumber]: cell }).
export function roundsOf(row) {
  return Object.values(row?.perRace || {});
}

// Flatten round cells into their classifications: the feature race of each
// round plus, on a sprint weekend, the sprint. Each entry is
// { status, position, sprint } — `sprint` true for the sprint half.
export function classificationsOf(cells) {
  const out = [];
  for (const cell of cells || []) {
    if (!cell) continue;
    out.push({ status: cell.status ?? null, position: cell.position ?? null, sprint: false });
    if (cell.sprint) {
      out.push({ status: cell.sprint.status ?? null, position: cell.sprint.position ?? null, sprint: true });
    }
  }
  return out;
}

// The classified finishes among those classifications — the list every wins /
// podiums / top-N counter on the site is built from.
export function finishesOf(cells) {
  return classificationsOf(cells).filter((c) => c.status === "FINISHED" && c.position != null);
}
