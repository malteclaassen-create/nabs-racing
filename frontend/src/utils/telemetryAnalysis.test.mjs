import { test } from "node:test";
import assert from "node:assert/strict";
import { lapProfile, brakePoint, brakeZones, sectorDeltas } from "./telemetryAnalysis.js";

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

// A lap built from pieces: [slices, speed from, speed to, brake %].
const built = (parts) => {
  const speed = [], brake = [];
  for (const [len, a, b, p] of parts) for (let k = 0; k < len; k++) { speed.push(Math.round(a + ((b - a) * k) / len)); brake.push(p); }
  return { speed, brake };
};

test("brake point of the second of two corners close together is its own", () => {
  // Hard stop for the first corner at slice 10, then the car accelerates and
  // brakes again, softer, at slice 40 for the corner the section is named after.
  const l = built([[10, 280, 280, 0], [10, 280, 120, 100], [5, 120, 120, 0], [15, 120, 170, 0], [10, 170, 80, 60], [5, 80, 80, 0]]);
  assert.equal(brakePoint(l, 0, 49), 40);
});

test("a run of corners with no acceleration between them is one braking zone", () => {
  const l = built([[10, 280, 280, 0], [10, 280, 150, 100], [5, 150, 148, 0], [10, 148, 80, 50], [5, 80, 80, 0]]);
  assert.equal(brakePoint(l, 0, 34), 10);
});

test("a dab on the straight is not the brake point", () => {
  const l = built([[5, 260, 270, 0], [2, 270, 270, 50], [13, 270, 290, 0], [10, 290, 90, 90], [5, 90, 90, 0]]);
  assert.equal(brakePoint(l, 0, 29), 20);
});

test("each corner of a section has its own braking zone, first corner last in the list", () => {
  // Hard stop for the first corner at 10, accelerate, softer stop at 40 for
  // the slowest one. B brakes 3 slices (30 m) earlier into the first.
  const a = built([[10, 280, 280, 0], [10, 280, 120, 100], [5, 120, 120, 0], [15, 120, 170, 0], [10, 170, 80, 60], [5, 80, 80, 0]]);
  const b = built([[7, 280, 280, 0], [13, 280, 120, 100], [5, 120, 120, 0], [15, 120, 170, 0], [10, 170, 80, 60], [5, 80, 80, 0]]);
  const dist = Array.from({ length: 55 }, (_, i) => i * 10);
  const zones = brakeZones(a, b, { start: 0, apex: 49 }, dist);
  assert.equal(zones.length, 2);
  assert.equal(zones[0].apex, 49);
  assert.equal(zones[0].brakeDeltaM, 0);
  assert.equal(zones[1].brakeA, 10);
  assert.equal(zones[1].brakeB, 7);
  assert.equal(zones[1].brakeDeltaM, -30);
});

test("sectors follow the server's lines when they are known", () => {
  const flat = { t: Array.from({ length: 101 }, (_, i) => i * 1000) };
  const slow = { t: Array.from({ length: 101 }, (_, i) => i * 1000 + (i > 20 ? 500 : 0)) };
  const thirds = sectorDeltas(flat, slow, null, 101);
  assert.deepEqual(thirds.map((s) => s.to), [33, 67, 100]);
  const real = sectorDeltas(flat, slow, null, 101, 3, [35, 71]);
  assert.deepEqual(real.map((s) => s.to), [35, 71, 100]);
  assert.equal(real[0].deltaMs, 500);
});
