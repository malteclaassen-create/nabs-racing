// ---------------------------------------------------------------------------
// Who is still turning up, and who has quietly stopped.
//
// The rest of the Attendance tab answers questions about ONE race: who may
// answer it, who hasn't yet, what everybody said. None of them answers the
// question that actually decides a grid — is this driver still in the league?
// A seat held by somebody who last raced in round 2 is a seat nobody is using,
// and the only way to see that today is to open six past rounds and compare.
//
// So this walks the season the other way round: one row per driver, one column
// per round, and a verdict at the end of it.
//
// WHAT COUNTS AS BEING THERE. Two different things, kept apart because they
// mean different things:
//
//   raced     they were in the classification (a DNF still turned up; a DNS
//             did not). This is the number a grid is planned from.
//   answered  they touched the sign-up, whatever they said. "Out" is not
//             absence — it is somebody who read the post and replied.
//
// The verdict runs on the two together, on purpose. A Tier-1 driver is judged
// by the rounds they drive, but the reserve pool is most of the roster and a
// reserve who is never needed never races: judging them on starts alone would
// paint sixty perfectly present people as gone. Answering is the signal they
// DO give, so a sign-up counts as a sign of life and both halves of the roster
// can be read in the same table.
//
//   active    seen at the last completed round
//   quiet     last seen one or two rounds ago
//   inactive  last seen three or more rounds ago
//   never     no start and no answer all season
//
// The gap is counted in ROUNDS, not weeks: a league that skips a fortnight
// hasn't lost anybody, and a driver who misses three rounds back to back has
// gone whether that took a month or three.
// ---------------------------------------------------------------------------

// How many rounds of silence it takes. Two thresholds rather than one so there
// is a middle state: "quiet" is who you ask about, "inactive" is who you plan
// without.
export const QUIET_AFTER = 1;
export const INACTIVE_AFTER = 3;

export const ACTIVITY_STATES = ["active", "quiet", "inactive", "never"];

// A classification row means they were there; DNS means they were entered and
// didn't start, which is the same absence as not being entered at all.
const started = (status) => !!status && status !== "DNS";

// One driver against the season's rounds.
//
//   rounds   the completed rounds, oldest first: [{ id, number, track, date }]
//   results  Map raceId -> result status ("FINISHED" / "DNF" / "DSQ" / "DNS")
//   rsvps    Map raceId -> answer ("ACCEPTED" / "DECLINED" / "TENTATIVE")
//
// Both maps are keyed by the ROUND's id — a sprint weekend's sprint is folded
// into its parent round by the caller, because the round is the evening, not
// the classification.
export function activityFor(rounds, results, rsvps) {
  const cells = (rounds || []).map((r) => {
    const result = results?.get(r.id) || null;
    const rsvp = rsvps?.get(r.id) || null;
    return { raceId: r.id, result, raced: started(result), rsvp, seen: started(result) || !!rsvp };
  });

  const starts = cells.filter((c) => c.raced).length;
  const accepted = cells.filter((c) => c.rsvp === "ACCEPTED").length;
  const declined = cells.filter((c) => c.rsvp === "DECLINED").length;
  const tentative = cells.filter((c) => c.rsvp === "TENTATIVE").length;
  // Said yes and then wasn't there. The one number here that is a complaint
  // rather than an observation: it cost the grid a seat nobody could fill.
  const noShows = cells.filter((c) => c.rsvp === "ACCEPTED" && !c.raced).length;

  // Trailing runs. -1 means "not once all season", which the states below read
  // as never rather than as an enormous gap.
  const lastIndex = (pick) => {
    for (let i = cells.length - 1; i >= 0; i--) if (pick(cells[i])) return i;
    return -1;
  };
  const lastSeenIndex = lastIndex((c) => c.seen);
  const lastStartIndex = lastIndex((c) => c.raced);

  // Rounds since, counted from the newest round: 0 = the last one.
  const gapSince = (i) => (i < 0 ? null : cells.length - 1 - i);
  const roundsSinceSeen = gapSince(lastSeenIndex);
  const roundsSinceStart = gapSince(lastStartIndex);

  let state;
  if (lastSeenIndex < 0) state = "never";
  else if (roundsSinceSeen >= INACTIVE_AFTER) state = "inactive";
  else if (roundsSinceSeen >= QUIET_AFTER) state = "quiet";
  else state = "active";

  return {
    cells,
    rounds: cells.length,
    starts,
    answers: accepted + declined + tentative,
    accepted,
    declined,
    tentative,
    // Never answered, never raced — the rounds they were simply absent for.
    silent: cells.filter((c) => !c.seen).length,
    noShows,
    // The round itself rather than an index, so the caller can print "R5
    // Monza" without carrying the round list around with it.
    lastSeen: lastSeenIndex < 0 ? null : { ...rounds[lastSeenIndex], raced: cells[lastSeenIndex].raced },
    lastStart: lastStartIndex < 0 ? null : rounds[lastStartIndex],
    roundsSinceSeen,
    roundsSinceStart,
    state,
  };
}

// How many of each state in a group, in a fixed key order so the caller can
// print "3 quiet · 1 inactive" without worrying about a missing key.
export function tallyStates(drivers) {
  const out = { active: 0, quiet: 0, inactive: 0, never: 0 };
  for (const d of drivers || []) if (d?.state in out) out[d.state] += 1;
  return out;
}

// Who needs looking at first. The whole point of the page is the bottom of the
// roster, so the longest silence comes to the top; ties fall back to who has
// raced least, then to the name so the order never wobbles between reloads.
export function byNeedsAttention(a, b) {
  const rank = { never: 0, inactive: 1, quiet: 2, active: 3 };
  return (
    (rank[a.state] ?? 9) - (rank[b.state] ?? 9) ||
    (b.roundsSinceSeen ?? 99) - (a.roundsSinceSeen ?? 99) ||
    a.starts - b.starts ||
    String(a.name || "").localeCompare(String(b.name || ""))
  );
}
