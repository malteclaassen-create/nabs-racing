import { describe, it, expect } from "vitest";
import { createPitLossLearner } from "./pitLoss.js";

// Laps of `lapMs` from t=0, with extra time added to the listed laps.
function crossings(upTo, lapMs, extra = {}) {
  const out = [];
  let t = 0;
  for (let lap = 1; lap <= upTo; lap++) {
    t += lapMs + (extra[lap] || 0);
    out.push({ lap, at: t });
  }
  return out;
}

describe("pit loss learner", () => {
  it("measures a stop whose lane crosses the line (in lap + out lap)", () => {
    const l = createPitLossLearner();
    // In the lane at the end of lap 4 and the start of lap 5.
    l.note("a", { inPits: true, lapCount: 3, onTrack: true });
    l.note("a", { inPits: true, lapCount: 4, onTrack: true });
    l.evaluate("a", crossings(5, 90000, { 4: 8000, 5: 14000 }).slice(-6));
    expect(l.result()).toEqual({ ms: 22000, stops: 1 });
  });

  it("waits until the out lap is complete", () => {
    const l = createPitLossLearner();
    l.note("a", { inPits: true, lapCount: 3, onTrack: true });
    l.note("a", { inPits: true, lapCount: 4, onTrack: true });
    l.evaluate("a", crossings(4, 90000, { 4: 8000 }));
    expect(l.result()).toBeNull();
    l.evaluate("a", crossings(5, 90000, { 4: 8000, 5: 14000 }));
    expect(l.result()?.ms).toBe(22000);
  });

  it("does not measure while the car is still in the lane", () => {
    const l = createPitLossLearner();
    l.note("a", { inPits: true, lapCount: 3, onTrack: true });
    l.evaluate("a", crossings(4, 90000, { 4: 20000 }), { inPits: true });
    expect(l.result()).toBeNull();
  });

  it("counts each stop once and takes the median over the field", () => {
    const l = createPitLossLearner();
    for (const [guid, loss] of [["a", 20000], ["b", 24000], ["c", 60000]]) {
      l.note(guid, { inPits: true, lapCount: 4, onTrack: true });
      const list = crossings(6, 85000, { 5: loss });
      l.evaluate(guid, list);
      l.evaluate(guid, list);
    }
    expect(l.result()).toEqual({ ms: 24000, stops: 3 });
  });

  it("ignores a flicker that cost nothing, and a car parked for minutes", () => {
    const l = createPitLossLearner();
    l.note("a", { inPits: true, lapCount: 4, onTrack: true });
    l.evaluate("a", crossings(6, 85000, { 5: 400 }));
    l.note("b", { inPits: true, lapCount: 4, onTrack: true });
    l.evaluate("b", crossings(6, 85000, { 5: 300000 }));
    expect(l.result()).toBeNull();
  });

  it("forgets everything on clear", () => {
    const l = createPitLossLearner();
    l.note("a", { inPits: true, lapCount: 4, onTrack: true });
    l.evaluate("a", crossings(6, 85000, { 5: 20000 }));
    l.clear();
    expect(l.result()).toBeNull();
  });
});
