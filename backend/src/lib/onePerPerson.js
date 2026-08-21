// ---------------------------------------------------------------------------
// One person, one answer.
//
// Driver rows are per-season and a person can end up with more than one of
// them in the SAME season: they sign up, change their handle, log in again,
// and the login lands on a second roster row. Both rows are the same human,
// and once an admin has linked them (lib/persons.js) the league knows it — but
// the answers they left behind are still two rows in RaceRsvp, so the entry
// list showed "urma" and "urmagaeddon" one above the other, the grid counted
// them twice, and the chase list asked one of them for an answer the other had
// already given.
//
// This is the rule that fixes all of that in one place: wherever a race asks
// "who answered", people are counted, not rows. A person who is not linked to
// anybody is their own person, so nothing here changes what a league without
// duplicates sees.
//
// It does NOT merge driver rows. Those are per-season on purpose — the results,
// the team, the season's standings all hang off them, and deleting one to tidy
// up an entry list would take a career with it. What gets merged is the
// duplicated ANSWER, which is the thing that was wrong.
// ---------------------------------------------------------------------------

// The person a driver row belongs to. Rows with no link stand for themselves,
// and the prefix keeps a driver id from ever colliding with a personId.
export function personKey(driverId, byDriver) {
  return byDriver?.get?.(driverId) || `row:${driverId}`;
}

// The same question asked of a whole list: Map<driverId, personKey>.
export function personKeys(driverIds, byDriver) {
  return new Map((driverIds || []).map((id) => [id, personKey(id, byDriver)]));
}

// Collapse rows that belong to one person down to a single row.
//
// `rank` decides which survives, higher wins; equal ranks fall back to the
// order the rows arrived in, so the result is stable rather than whichever the
// database happened to return first.
//
// Returns both halves. The dropped ones are not waste: the sign-up path uses
// them to clear the duplicate answers out of the table, which is what stops
// the same person coming back twice tomorrow.
export function collapseByPerson(rows, byDriver, rank = () => 0) {
  const best = new Map();
  const dropped = [];
  for (const row of rows || []) {
    const key = personKey(row.driverId, byDriver);
    const seen = best.get(key);
    if (!seen) {
      best.set(key, row);
      continue;
    }
    // The loser is dropped whichever way round it is, so a caller cleaning up
    // never has to work out which of the two it is holding.
    if (rank(row) > rank(seen)) {
      best.set(key, row);
      dropped.push(seen);
    } else {
      dropped.push(row);
    }
  }
  return { kept: [...best.values()], dropped };
}

// The newest answer wins. An answer is a promise that can be changed, so when
// one person has left two, the one they gave last is the one they meant: a
// driver who accepted, renamed, logged in again and then declined is not
// coming, however emphatically the older row says otherwise.
export const byNewestAnswer = (r) => new Date(r.updatedAt || 0).getTime() || 0;

// Every RSVP on one race that belongs to a person who has answered somewhere
// else on it too — the ones to delete. Handed the same list the entry list is
// built from.
export function duplicateRsvps(rsvps, byDriver) {
  return collapseByPerson(rsvps, byDriver, byNewestAnswer).dropped;
}
