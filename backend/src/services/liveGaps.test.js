import { describe, it, expect } from "vitest";
import { createGapTracker } from "./liveGaps.js";

// Two cars on the same pace profile, B `gapMs` behind A, frames every `step`
// ms (each car on its own frame clock). Returns the time of the last frame.
function race(tr, { gapMs, lapMs = 90000, laps = 2, step = 100, offset = 37, pace = () => 1 }) {
  const N = 4000;
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + 1 / pace((i - 0.5) / N));
  const sAt = (t) => {
    // spline at time t into the race (laps repeat)
    const lapT = ((t % lapMs) + lapMs) % lapMs;
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if ((cum[Math.round(mid * N)] / cum[N]) * lapMs < lapT) lo = mid; else hi = mid;
    }
    return lo;
  };
  const end = laps * lapMs;
  for (let t = 0; t <= end; t += step) {
    tr.onFrame("A", sAt(t), 10000 + t);
    if (t + offset >= gapMs) tr.onFrame("B", sAt(t + offset - gapMs), 10000 + t + offset);
  }
  return 10000 + end + offset;
}

describe("race gaps round the lap", () => {
  it("measures the gap mid-lap, not only at the line", () => {
    const tr = createGapTracker();
    const pace = (s) => (s > 0.4 && s < 0.6 ? 0.45 : 1.3); // a slow middle sector
    const now = race(tr, { gapMs: 1834, laps: 1.37, pace });
    expect(Math.abs(tr.gap("B", "A", 90000, now) - 1834)).toBeLessThan(25);
  });

  it("follows a gap that changes during the lap", () => {
    const tr = createGapTracker();
    let now = race(tr, { gapMs: 3000, laps: 1.2 });
    expect(Math.abs(tr.gap("B", "A", 90000, now) - 3000)).toBeLessThan(25);
    const tr2 = createGapTracker();
    now = race(tr2, { gapMs: 1200, laps: 1.25 });
    expect(Math.abs(tr2.gap("B", "A", 90000, now) - 1200)).toBeLessThan(25);
  });

  it("keeps working across the line", () => {
    const tr = createGapTracker();
    const now = race(tr, { gapMs: 800, laps: 2.0005 }); // A just over the line, B not yet
    expect(Math.abs(tr.gap("B", "A", 90000, now) - 800)).toBeLessThan(25);
  });

  it("refuses a pass older than one lap of the car ahead", () => {
    const tr = createGapTracker();
    const now = race(tr, { gapMs: 1000, laps: 1.5 });
    expect(tr.gap("B", "A", 500, now)).toBeNull();
  });

  it("says nothing for a car the telemetry has gone quiet on", () => {
    const tr = createGapTracker();
    const now = race(tr, { gapMs: 1000, laps: 1.5 });
    expect(tr.gap("B", "A", 90000, now + 10000)).toBeNull();
    expect(tr.gap("B", "nobody", 90000, now)).toBeNull();
  });

  it("leaves loops passed during a telemetry hole blank", () => {
    const tr = createGapTracker();
    tr.onFrame("A", 0.1, 1000);
    tr.onFrame("A", 0.2, 9000); // 8 s with nothing
    tr.onFrame("B", 0.1, 2000);
    tr.onFrame("B", 0.15, 2500);
    expect(tr.gap("B", "A", 90000, 2600)).toBeNull();
  });
});
