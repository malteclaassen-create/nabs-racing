// ---------------------------------------------------------------------------
// "Add several rounds" in Races & Events: the plan of what gets created.
//
// A season is announced as a calendar, ten or twelve Fridays in a row, and the
// create form made that ten trips through the same seven fields. The batch form
// asks for the few things that differ (how many, the first date, the first
// round number, the tracks if they are known yet) and this works out the rest.
// The rounds are then created one by one through the same route the single
// form uses, so nothing here decides anything the server would not.
//
// Pure, so node can test it.
// ---------------------------------------------------------------------------

export const BATCH_MAX = 20;
export const REPEAT_DAYS = 7;
// What a round without a track yet is called. The route insists on a name,
// and this one says plainly that it is still to be decided (rename it in the
// round's editor once it is).
export const TRACK_TBA = "TBA";

const kindOf = (r) => r.type || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");

// One past the highest championship round number of the season, or 1.
export function nextFreeRoundNumber(races) {
  let max = 0;
  for (const r of races || []) {
    if (kindOf(r) !== "CHAMPIONSHIP" || r.sprintOf) continue;
    const n = Number(r.number);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

// The track names worth suggesting, without repeats (case-insensitive) and
// sorted. Where two spellings meet, the season's own wins: it is the one the
// league actually uses.
export function knownTrackNames(races, more = []) {
  const seen = new Map();
  for (const name of [...(races || []).map((r) => r?.track), ...(more || [])]) {
    const t = String(name || "").trim();
    if (t && t !== TRACK_TBA && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// The rounds to create. `firstDate` is a Date (or anything Date takes) or
// empty; each further round is REPEAT_DAYS later at the same wall-clock time,
// which is why the days are added on the calendar rather than as milliseconds
// (a batch across the change to summer time would otherwise slide by an hour).
// `tracks` are one per round in order; missing ones are TRACK_TBA.
export function planRounds({ count, firstDate, firstNumber, tracks = [] }) {
  const n = Math.max(0, Math.min(BATCH_MAX, Math.floor(Number(count) || 0)));
  const start = firstDate ? new Date(firstDate) : null;
  const dated = start && !isNaN(start.getTime());
  const first = Math.floor(Number(firstNumber));
  const out = [];
  for (let i = 0; i < n; i++) {
    let date = null;
    if (dated) {
      const d = new Date(start.getTime());
      d.setDate(d.getDate() + i * REPEAT_DAYS);
      date = d.toISOString();
    }
    out.push({
      number: Number.isInteger(first) && first > 0 ? first + i : null,
      date,
      track: String(tracks[i] || "").trim() || TRACK_TBA,
    });
  }
  return out;
}

// What is wrong with a plan before anything is sent, or null. A number the
// season already has is reported per round by the server (409) rather than
// here, so one taken number does not stop the rest.
export function planProblem({ count, firstNumber }) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > BATCH_MAX) return `Between 1 and ${BATCH_MAX} rounds at a time.`;
  const f = Number(firstNumber);
  if (!Number.isInteger(f) || f < 1) return "The first round number has to be a whole number of 1 or more.";
  return null;
}
