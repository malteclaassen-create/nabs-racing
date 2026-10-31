// How much time a pit stop costs at this circuit, learned from the stops of
// the race on air. The live map's pit window ("where would I come out if I
// boxed now?") needs exactly one number, and the honest source for it is the
// field itself: the laps a car spent partly in the pit lane, against that
// same car's ordinary laps either side.
//
//   loss = (in lap + out lap) - 2 x the driver's usual lap
//
// "Usual" is the median of their clean laps still on file, so one spin or a
// safety car lap does not drag it. Which laps count as pit laps is noted
// while the car is in the lane: every lap it is in there at some point. On
// most circuits the lane crosses the line and that is two laps (in and out),
// elsewhere it is one; the sum above works for both.
//
// Fed by the live relay (services/liveTiming.js) once per car per board
// build, with the same line crossings the race gaps are measured from.
// Cleared with them on a session change.

const MIN_LOSS_MS = 3000; // less than this was not a stop (a drive-through scare of the pit flag)
const MAX_LOSS_MS = 120000; // more than this was a repair, a penalty or a driver who went to make tea
const SAMPLES_KEPT = 40;

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function createPitLossLearner() {
  const touchedByGuid = new Map(); // guid -> Set of lap numbers spent partly in the lane
  const doneByGuid = new Map(); // guid -> Set of lap numbers already turned into a sample
  const samples = [];

  // `lapCount` is the laps COMPLETED, so the lap being driven is the next one.
  function note(guid, { inPits, lapCount, onTrack }) {
    if (!guid || !onTrack || !inPits) return;
    let set = touchedByGuid.get(guid);
    if (!set) touchedByGuid.set(guid, (set = new Set()));
    set.add((lapCount || 0) + 1);
  }

  // `crossings` = [{ lap, at }] oldest first, as the relay keeps them.
  function evaluate(guid, crossings, { inPits = false } = {}) {
    const touched = touchedByGuid.get(guid);
    if (!touched || !touched.size || !crossings || crossings.length < 2) return;
    // Still in the lane: the stop is not over and its laps are not all known.
    if (inPits) return;
    const at = new Map(crossings.map((c) => [c.lap, c.at]));
    let done = doneByGuid.get(guid);
    if (!done) doneByGuid.set(guid, (done = new Set()));

    const laps = [...touched].filter((l) => !done.has(l)).sort((a, b) => a - b);
    if (!laps.length) return;
    // Consecutive pit laps belong to one stop.
    const groups = [];
    for (const l of laps) {
      const g = groups[groups.length - 1];
      if (g && l === g[g.length - 1] + 1) g.push(l);
      else groups.push([l]);
    }

    // Clean laps: both ends on file, not a pit lap, not the opening lap.
    const clean = [];
    for (const c of crossings) {
      const prev = at.get(c.lap - 1);
      if (c.lap < 2 || prev == null || touched.has(c.lap)) continue;
      clean.push(c.at - prev);
    }
    const usual = median(clean);

    for (const g of groups) {
      const first = g[0];
      const last = g[g.length - 1];
      const end = at.get(last);
      if (end == null) continue; // out lap not finished yet
      const start = at.get(first - 1);
      // The lap before the stop scrolled off (or there never was one: a stop
      // on the opening lap). Nothing to measure; do not try again.
      if (start == null || usual == null) {
        if (start == null) g.forEach((l) => done.add(l));
        continue;
      }
      g.forEach((l) => done.add(l));
      const loss = end - start - g.length * usual;
      if (loss >= MIN_LOSS_MS && loss <= MAX_LOSS_MS) {
        samples.push(Math.round(loss));
        if (samples.length > SAMPLES_KEPT) samples.shift();
      }
    }
  }

  // The stop cost as the board publishes it, or null before the first stop.
  function result() {
    const ms = median(samples);
    return ms == null ? null : { ms: Math.round(ms), stops: samples.length };
  }

  function clear() {
    touchedByGuid.clear();
    doneByGuid.clear();
    samples.length = 0;
  }

  return { note, evaluate, result, clear, stats: () => ({ drivers: touchedByGuid.size, samples: samples.length }) };
}
