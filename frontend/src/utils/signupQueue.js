// ---------------------------------------------------------------------------
// Which upcoming race(s) are taking sign-ups right now.
//
// Sign-up runs ONE round at a time: the earliest upcoming race is "the round we
// are on", and it stops taking answers an hour after its start (see the backend
// gate). From then until its result is saved, nothing is open — the entry list
// it leaves behind is the final grid, and the round after it does NOT quietly
// take over, or the sign-up would never be closed on a race night.
//
// The one way out of that queue is a person: an admin forcing a later round
// open in the Attendance tab (`attendanceForcedOpen`). That is the documented
// escape hatch — "the hand always wins" — so it has to survive the queue rule.
//
// Both the Attendance page (which race to show) and the Races page (which round
// gets the "Sign up now" button) answer from here, so they can never disagree.
// ---------------------------------------------------------------------------

// `events` as delivered by GET /api/events (upcoming, non-special races).
// Returns the ids that may be answered right now, newest queue race first.
export function signupRaceIds(events) {
  const list = [...(events || [])].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const ids = new Set();
  if (list[0]?.attendanceOpen) ids.add(list[0].id);
  for (const e of list) if (e.attendanceForcedOpen) ids.add(e.id);
  return ids;
}

// The race the Attendance page should show: an explicitly linked one wins, then
// the first race actually taking answers, and failing that the queue's race —
// which is then on screen with its lock and its frozen entry list, rather than
// the page claiming there is nothing on the calendar.
export function currentSignupRace(events, wantRaceId) {
  const list = [...(events || [])].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  if (wantRaceId) {
    const wanted = list.find((e) => e.id === wantRaceId);
    if (wanted) return wanted;
  }
  const ids = signupRaceIds(list);
  return list.find((e) => ids.has(e.id)) || list[0] || null;
}
