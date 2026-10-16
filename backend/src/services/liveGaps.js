// Race gaps measured all the way round the lap, not only at the line.
//
// The track is cut into BINS equal slices by NormalisedSplinePos, and every
// slice boundary acts as a timing loop: for each car we keep the moment (our
// clock) it last passed each one. The gap between two cars is then "when the
// car behind passed the last loop it reached" minus "when the car ahead passed
// that same loop" — the way TV timing does it, and fresh to within a few
// metres of track instead of once a lap.
//
// Cheap on purpose (it runs for every car on every ET53):
//   * one Float64Array(BINS) per car, 4 KB, overwritten lap after lap — the
//     memory does not grow with the length of the race;
//   * per frame only the one or two loops the car just passed are written;
//     a gap is two array reads, done only when a board is built.
//
// A gap is only given when it makes sense: the car ahead must have passed the
// loop before the car behind, less than one of its laps earlier (so it is the
// same lap, not the previous time round), and both traces must be live. Frames
// further apart than MAX_GAP_MS leave their loops blank rather than invented.
// Anything else returns null and the caller keeps its line-crossing gap.

export const BINS = 500;
const MAX_GAP_MS = 3000;
const STALE_MS = 3000;

export function createGapTracker() {
  const byGuid = new Map(); // guid -> { pass: Float64Array, s, at }

  // Stamp every loop in (sA, sB] — sA < sB, both within one lap.
  function stamp(pass, sA, tA, sB, tB) {
    const first = Math.floor(sA * BINS) + 1;
    const last = Math.min(BINS - 1, Math.floor(sB * BINS));
    const span = sB - sA;
    for (let b = first; b <= last; b++) pass[b] = tA + ((b / BINS - sA) / span) * (tB - tA);
  }

  function blank(pass, sA, sB) {
    const first = Math.floor(sA * BINS) + 1;
    const last = Math.min(BINS - 1, Math.floor(sB * BINS));
    for (let b = first; b <= last; b++) pass[b] = 0;
  }

  function onFrame(guid, spline, at) {
    if (!guid || typeof spline !== "number" || !Number.isFinite(spline)) return;
    let st = byGuid.get(guid);
    if (!st) byGuid.set(guid, (st = { pass: new Float64Array(BINS), s: null, at: 0 }));
    const ps = st.s;
    const pat = st.at;
    st.s = spline;
    st.at = at;
    if (ps == null) return;
    const dt = at - pat;
    const wrapped = ps > 0.9 && spline < 0.1;
    if (!(dt > 0) || dt > MAX_GAP_MS) {
      // A hole in the telemetry: whatever loops were passed in it are unknown.
      if (wrapped) {
        blank(st.pass, ps, 1);
        blank(st.pass, -1 / BINS, spline);
      } else if (spline > ps) {
        blank(st.pass, ps, spline);
      }
      return;
    }
    if (wrapped) {
      const cross = pat + ((1 - ps) / (1 - ps + spline)) * dt;
      stamp(st.pass, ps, pat, 1, cross);
      st.pass[0] = cross; // the line itself
      stamp(st.pass, 0, cross, spline, at);
      return;
    }
    // Backwards (a reset, a spin) or an impossible jump forwards: nothing
    // passed, nothing stamped.
    if (spline <= ps || spline > ps + 0.3) return;
    stamp(st.pass, ps, pat, spline, at);
  }

  // How far `behind` is behind `ahead`, in ms, or null. aheadLapMs bounds it:
  // a pass more than one of the leading car's laps old is a different lap.
  function gap(behind, ahead, aheadLapMs, now = Date.now()) {
    const b = byGuid.get(behind);
    const a = byGuid.get(ahead);
    if (!b || !a || b.s == null || a.s == null) return null;
    if (now - b.at > STALE_MS || now - a.at > STALE_MS) return null;
    const loop = Math.min(BINS - 1, Math.floor(b.s * BINS));
    const mine = b.pass[loop];
    const theirs = a.pass[loop];
    if (!mine || !theirs) return null;
    const ms = mine - theirs;
    if (ms < 0) return null;
    if (aheadLapMs > 0 && ms >= aheadLapMs) return null;
    return Math.round(ms);
  }

  return {
    onFrame,
    gap,
    clear: () => byGuid.clear(),
    size: () => byGuid.size,
  };
}
