// The live delta to a driver's own best lap, measured here rather than taken
// from the server manager's DeltaToSelf.
//
// How: the lap is cut into BINS equal slices of track (by NormalisedSplinePos)
// and, for every lap we watch from line to line, we note how long into the
// lap the car reached each slice boundary. The driver's best lap, once the
// server confirms it as their best, becomes the reference; the delta is then
// "time into this lap at this point of the track" minus "time into the best
// lap at the same point", interpolated between two boundaries. The line
// crossing itself is interpolated between the two frames around it, so the
// lap clock does not start up to a frame late.
//
// Kept cheap on purpose (the relay runs this for every car on every ET53):
//   * per driver at most four fixed Int32Array(BINS) buffers (2 KB each) —
//     the lap being driven, the reference, and the last two finished laps
//     waiting for the server to say whether one of them is the new best;
//     finished buffers are recycled for the next lap instead of allocated;
//   * per frame only the one or two boundaries the car just passed are
//     written; nothing is computed until a board build asks, and that is two
//     array reads and a multiplication.
//
// Anything we did not see whole (a lap that began before we connected, a
// pit visit, a gap in the telemetry, a reset to the pits) is never used as a
// reference, and a driver without a reference gets null — the caller falls
// back to the upstream's number.

export const BINS = 500;
const MAX_GAP_MS = 3000; // longer than this between frames: the trace has a hole
const STALE_MS = 3000; // no frame for this long: no live delta
const MATCH_MS = 250; // our lap time vs the server's best — same lap?
const KEEP_DONE = 2;

export function createDeltaTracker() {
  const byGuid = new Map();

  function fresh() {
    return {
      s: null, // last spline
      at: 0, // last frame, our clock
      lapStart: null, // interpolated line crossing, our clock
      cur: null, // Int32Array: ms into the lap at each boundary
      next: 1, // next boundary index to fill
      clean: false, // this lap seen whole from the line
      done: [], // [{ t, ms }] finished clean laps, newest last
      ref: null, // { t, ms, best, scale }
    };
  }

  function buffer(st) {
    // Recycle the oldest finished lap's buffer when there are enough of them.
    if (st.done.length > KEEP_DONE) return st.done.shift().t;
    return new Int32Array(BINS);
  }

  // Write every boundary between the last frame and this one.
  function fill(st, toSpline, elA, sA, elB, sB) {
    const last = Math.min(BINS - 1, Math.floor(toSpline * BINS));
    const span = sB - sA;
    for (let b = st.next; b <= last; b++) {
      const f = span > 0 ? (b / BINS - sA) / span : 1;
      st.cur[b] = Math.round(elA + f * (elB - elA));
    }
    if (last + 1 > st.next) st.next = last + 1;
  }

  function onFrame(guid, spline, at, inPits = false) {
    if (!guid || typeof spline !== "number" || !Number.isFinite(spline)) return;
    let st = byGuid.get(guid);
    if (!st) byGuid.set(guid, (st = fresh()));
    const ps = st.s;
    const pat = st.at;
    st.s = spline;
    st.at = at;
    if (inPits) st.clean = false;
    if (ps == null) return;
    const dt = at - pat;
    if (!(dt > 0) || dt > MAX_GAP_MS) st.clean = false;

    if (ps > 0.9 && spline < 0.1 && dt > 0 && dt <= MAX_GAP_MS) {
      // Across the line, somewhere between the two frames.
      const cross = pat + ((1 - ps) / (1 - ps + spline)) * dt;
      if (st.lapStart != null && st.clean && st.next >= BINS - 1) {
        fill(st, 0.99999, pat - st.lapStart, ps, cross - st.lapStart, 1);
        st.done.push({ t: st.cur, ms: Math.round(cross - st.lapStart) });
        st.cur = null;
      }
      st.lapStart = cross;
      st.cur = st.cur || buffer(st);
      st.cur[0] = 0;
      st.next = 1;
      st.clean = !inPits;
      fill(st, spline, 0, 0, at - cross, spline);
      return;
    }
    if (st.lapStart == null) return;
    if (spline < ps - 0.05 || spline > ps + 0.3) {
      // Reset to the pits, or a jump we cannot account for: this lap has no
      // clock we trust until the next crossing.
      st.lapStart = null;
      st.clean = false;
      return;
    }
    if (spline > ps) fill(st, spline, pat - st.lapStart, ps, at - st.lapStart, spline);
  }

  // Adopt the finished lap the server now calls this driver's best.
  function settle(st, bestMs) {
    if (bestMs == null) {
      st.ref = null;
      return;
    }
    if (st.ref && st.ref.best === bestMs) return;
    let pick = -1;
    for (let i = 0; i < st.done.length; i++) {
      const d = Math.abs(st.done[i].ms - bestMs);
      if (d <= MATCH_MS && (pick < 0 || d < Math.abs(st.done[pick].ms - bestMs))) pick = i;
    }
    if (pick < 0) {
      // The best is a lap we never saw whole: a reference for another lap
      // would only mislead.
      st.ref = null;
      return;
    }
    const [lap] = st.done.splice(pick, 1);
    st.ref = { t: lap.t, ms: lap.ms, best: bestMs, scale: bestMs / lap.ms };
  }

  // The delta for this driver right now, in ms (negative = up on their best),
  // or null when we cannot say.
  function deltaFor(guid, bestMs, now = Date.now()) {
    const st = byGuid.get(guid);
    if (!st) return null;
    settle(st, bestMs);
    if (!st.ref || st.lapStart == null || now - st.at > STALE_MS) return null;
    const x = st.s * BINS;
    const i = Math.min(BINS - 1, Math.max(0, Math.floor(x)));
    const t0 = st.ref.t[i];
    const t1 = i + 1 < BINS ? st.ref.t[i + 1] : st.ref.ms;
    const refAt = (t0 + (x - i) * (t1 - t0)) * st.ref.scale;
    return Math.round(st.at - st.lapStart - refAt);
  }

  return {
    onFrame,
    deltaFor,
    clear: () => byGuid.clear(),
    size: () => byGuid.size,
  };
}
