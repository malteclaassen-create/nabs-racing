import { describe, it, expect } from "vitest";
import { createDeltaTracker, BINS } from "./liveDelta.js";

// Drive one lap at a given pace profile: speedAt(s) -> spline per ms. Frames
// every `step` ms, starting just before the line so the crossing is seen.
function driveLap(tr, guid, { start, lapMs, step = 100, pace = () => 1, inPitsUntil = -1 }) {
  // Time at spline s for a lap whose pace curve is normalised to lapMs.
  const N = 2000;
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + 1 / pace((i - 0.5) / N));
  const timeAt = (s) => (cum[Math.round(s * N)] / cum[N]) * lapMs;
  let at = start;
  // invert by stepping in time
  const frames = [];
  for (let t = 0; t < lapMs; t += step) {
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (timeAt(mid) < t) lo = mid; else hi = mid;
    }
    frames.push([start + t, lo]);
  }
  for (const [a, s] of frames) tr.onFrame(guid, s >= 1 ? 0 : s, a, a < inPitsUntil);
  at = start + lapMs;
  return { end: at, timeAt };
}

describe("live delta", () => {
  it("stays near zero on a lap driven exactly like the best one", () => {
    const tr = createDeltaTracker();
    // A corner-heavy pace curve: slow in the middle third, fast elsewhere.
    const pace = (s) => (s > 0.33 && s < 0.66 ? 0.5 : 1.4);
    tr.onFrame("g", 0.99, 950);
    let t = driveLap(tr, "g", { start: 1000, lapMs: 90000, pace }); // best lap, traced whole
    t = driveLap(tr, "g", { start: t.end, lapMs: 90000, pace, step: 130 }); // same again, other frame rate
    const d = tr.deltaFor("g", 90000, t.end - 200);
    expect(Math.abs(d)).toBeLessThan(30);
  });

  it("reads the time gained at the same point of the track", () => {
    const tr = createDeltaTracker();
    tr.onFrame("g", 0.99, 900);
    let t = driveLap(tr, "g", { start: 1000, lapMs: 92000 }); // first full lap
    t = driveLap(tr, "g", { start: t.end, lapMs: 90000 }); // the best
    const now = t.end + 30000;
    // Current lap is 2% quicker everywhere: after 30 s it is 0.6 s up.
    const frames = [];
    for (let el = 0; el <= 30000; el += 100) frames.push([t.end + el, el / (90000 * 0.98)]);
    for (const [a, s] of frames) tr.onFrame("g", s, a);
    const d = tr.deltaFor("g", 90000, now);
    expect(d).toBeGreaterThan(-650);
    expect(d).toBeLessThan(-550);
  });

  it("gives nothing until the server's best is a lap it saw whole", () => {
    const tr = createDeltaTracker();
    tr.onFrame("g", 0.5, 0);
    let t = driveLap(tr, "g", { start: 1000, lapMs: 90000 }); // started mid-lap: not whole
    expect(tr.deltaFor("g", 89000, t.end)).toBeNull(); // best from before we connected
    t = driveLap(tr, "g", { start: t.end, lapMs: 90000 }); // the first whole lap
    tr.onFrame("g", 0.002, t.end + 20); // ...ends at the line
    expect(tr.deltaFor("g", 89000, t.end + 20)).toBeNull(); // still not that best
    expect(tr.deltaFor("g", 90000, t.end + 20)).not.toBeNull(); // the new best: now it does
  });

  it("never takes a lap with a pit visit as the reference", () => {
    const tr = createDeltaTracker();
    tr.onFrame("g", 0.99, 900);
    const t = driveLap(tr, "g", { start: 1000, lapMs: 90000, inPitsUntil: 5000 });
    driveLap(tr, "g", { start: t.end, lapMs: 10000 });
    expect(tr.deltaFor("g", 90000, t.end + 10000)).toBeNull();
  });

  it("goes quiet when the telemetry stops", () => {
    const tr = createDeltaTracker();
    tr.onFrame("g", 0.99, 900);
    let t = driveLap(tr, "g", { start: 1000, lapMs: 90000 });
    t = driveLap(tr, "g", { start: t.end, lapMs: 90000 });
    expect(tr.deltaFor("g", 90000, t.end + 10000)).toBeNull();
  });

  it("holds a fixed amount of memory per driver however long the session", () => {
    const tr = createDeltaTracker();
    tr.onFrame("g", 0.99, 900);
    let t = { end: 1000 };
    for (let i = 0; i < 40; i++) t = driveLap(tr, "g", { start: t.end, lapMs: 90000 + i });
    expect(tr.size()).toBe(1);
    expect(BINS).toBe(500);
  });
});
