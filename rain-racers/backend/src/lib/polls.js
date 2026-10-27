// Combo votes: for a round nobody knows yet the league puts up a few car and
// track combos, the members (signed in with Discord) pick one each, and the
// winner is raced in the round. The admin makes the pick final, which gives
// the round its car, track and name.

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;

// What a vote is loaded with for pollOut.
export const POLL_INCLUDE = {
  options: { orderBy: [{ order: "asc" }, { id: "asc" }] },
  votes: { select: { userId: true, optionId: true } },
  race: { select: { id: true, round: true, name: true, startsAt: true, seasonId: true, _count: { select: { results: true } } } },
};

// "Ferrari F2004 at Magny-Cours", the way the league names its rounds.
export const comboName = (option) => [option.car, option.track].filter(Boolean).join(" at ");

// A vote as the site shows it: the combos with their votes, whether it is
// still open, the leaders, the winner and the visitor's own pick. Who voted
// for what is never sent, only the counts.
//
// Open while the closing time is ahead, no combo has been picked and the
// round has no results. The winner is the combo the admin picked, else once
// the vote is closed the one with the most votes (none on a tie: the league
// decides).
export function pollOut(poll, { userId = null, now = Date.now() } = {}) {
  const counts = new Map(poll.options.map((o) => [o.id, 0]));
  for (const v of poll.votes) if (counts.has(v.optionId)) counts.set(v.optionId, counts.get(v.optionId) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const most = Math.max(0, ...counts.values());
  const leaders = most > 0 ? poll.options.filter((o) => counts.get(o.id) === most).map((o) => o.id) : [];
  const raced = (poll.race?._count?.results ?? 0) > 0;
  const applied = poll.options.some((o) => o.id === poll.appliedOptionId);
  const open = !applied && !raced && new Date(poll.closesAt).getTime() > now;
  const mine = userId ? poll.votes.find((v) => v.userId === userId) : null;
  return {
    id: poll.id,
    closesAt: poll.closesAt,
    open,
    total,
    leaders,
    winnerId: applied ? poll.appliedOptionId : !open && leaders.length === 1 ? leaders[0] : null,
    applied,
    myVote: mine && counts.has(mine.optionId) ? mine.optionId : null,
    race: poll.race ? { id: poll.race.id, round: poll.race.round, name: poll.race.name, startsAt: poll.race.startsAt } : null,
    options: poll.options.map((o) => ({ id: o.id, car: o.car, track: o.track, note: o.note, votes: counts.get(o.id) })),
  };
}
