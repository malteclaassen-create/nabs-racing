import { test } from "node:test";
import assert from "node:assert/strict";
import { lapProfile } from "./telemetryAnalysis.js";

// Four slices, three intervals: 1 s flat out, 3 s on the brakes, 1 s on neither.
const lap = {
  t: [0, 1000, 4000, 5000],
  speed: [300, 300, 100, 100],
  gas: [100, 0, 0, 100],
  brake: [0, 80, 0, 0],
  gear: [7, 7, 3, 3],
};

test("lap profile shares are of time, not of slices", () => {
  const p = lapProfile(lap, 4);
  assert.equal(Math.round(p.fullThrottlePct), 20);
  assert.equal(Math.round(p.brakingPct), 60);
  assert.equal(Math.round(p.coastingPct), 20);
});

test("lap profile speeds and shifts", () => {
  const p = lapProfile(lap, 4);
  assert.equal(p.topSpeed, 300);
  assert.equal(p.minSpeed, 100);
  // (300·1 + 200·3 + 100·1) / 5
  assert.equal(p.avgSpeed, 200);
  assert.equal(p.shifts, 1);
  assert.equal(p.peakBrakeG, null);
});

test("lap profile peaks come from the g channels when given", () => {
  const p = lapProfile(lap, 4, { long: [0.5, -3.2, -1, 0.2], lat: [0.1, -2.4, 1.9, 0] });
  assert.equal(p.peakBrakeG, 3.2);
  assert.equal(p.peakLatG, 2.4);
});
