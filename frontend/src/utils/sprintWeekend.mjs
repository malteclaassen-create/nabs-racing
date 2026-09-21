// ---------------------------------------------------------------------------
// Which of a sprint weekend's two races a result is. Pure functions, so the
// import page's guesses can be pinned down in a test.
//
// A sprint+feature weekend runs two races on one night at one circuit, and
// the import page used to tell them apart by nothing at all: the server pick
// took "the newest session at this circuit tonight" for the feature as well
// as for the sprint, which is the sprint both times — the feature race was
// imported from the sprint's file, its reports offered the sprint's contacts,
// and nothing said so.
// ---------------------------------------------------------------------------

// The server session that belongs to one race of the night. `night` is the
// evening's sessions at the round's circuit, newest first (a practice race
// before the real one is in there too, that is why "the last one" was the
// rule). On a sprint weekend the newest is the sprint, since it is run
// second, and the feature is the one before it — as long as there IS one
// before it: right after the feature, before the sprint has been run, the
// newest session is the feature and it should still be offered.
export function pickNightSession(night, { sprintWeekend = false, session = "RACE" } = {}) {
  const list = (night || []).filter(Boolean);
  if (!list.length) return null;
  if (!sprintWeekend || session === "SPRINT") return list[0];
  return list.length >= 2 ? list[1] : list[0];
}

// Which race a result FILE is, read off its distance: the leader of a sprint
// completed the sprint distance, the leader of the feature the feature
// distance. Null when the round's distances are not both on file, when they
// are the same, or when the file matches neither — a race can end early, and
// a guess is worse than a question.
export function sessionOfFile({ leaderLaps, raceLaps, sprintLaps } = {}) {
  const laps = Number(leaderLaps);
  const race = Number(raceLaps);
  const sprint = Number(sprintLaps);
  if (![laps, race, sprint].every((n) => Number.isFinite(n) && n > 0)) return null;
  if (race === sprint) return null;
  if (laps === sprint) return "SPRINT";
  if (laps === race) return "RACE";
  return null;
}

// The laps the winner ran, from the parsed entries (each carries `laps`).
export function leaderLapsOf(entries) {
  let max = 0;
  for (const e of entries || []) {
    const n = Number(e?.laps);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max || null;
}
