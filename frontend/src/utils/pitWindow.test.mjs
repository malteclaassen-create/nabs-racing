import { test } from "node:test";
import assert from "node:assert/strict";
import { createProgressTracker, computePitWindow, lapRefMs, positionAtSpline } from "./pitWindow.mjs";

const LAP = 100000;
const car = (guid, prog, extra = {}) => ({
  guid,
  name: guid.toUpperCase(),
  onTrack: true,
  inPits: false,
  lapCount: Math.floor(prog),
  spline: prog % 1,
  bestLapMs: LAP,
  lastLapMs: LAP,
  ...extra,
});

test("a car that has not been watched long works from its lap time", () => {
  const t = createProgressTracker();
  // Field spread out, 5 s apart on the road (0.05 of a 100 s lap).
  const cars = [car("a", 10.5), car("b", 10.45), car("me", 10.4), car("c", 10.35), car("d", 10.3), car("e", 10.25)];
  t.update(cars, 0);
  const w = computePitWindow({ cars, subjectGuid: "me", lossMs: 20000, tracker: t, now: 0 });
  assert.equal(w.source, "pace");
  assert.equal(w.positionNow, 3);
  // 20 s back is 0.2 of a lap: behind c, d and e, level with nobody.
  assert.ok(Math.abs(w.prog - 10.2) < 1e-9);
  assert.equal(w.position, 6);
  assert.equal(w.ahead.guid, "e");
  assert.equal(w.ahead.ms, 5000);
  assert.equal(w.traffic, false);
});

test("the car's own path wins once it covers the stop", () => {
  const t = createProgressTracker();
  // The car crawled through the first half of the last 20 s (a slow corner),
  // so its path puts the rejoin further round than its average pace would.
  for (let s = 0; s <= 20; s++) {
    const prog = s <= 10 ? 5 + s * 0.005 : 5.05 + (s - 10) * 0.015;
    t.update([car("me", prog, { pos: { x: s, z: 0 } })], s * 1000);
  }
  const cars = [car("me", 5.2)];
  const w = computePitWindow({ cars, subjectGuid: "me", lossMs: 20000, tracker: t, now: 20000 });
  assert.equal(w.source, "path");
  assert.ok(Math.abs(w.prog - 5) < 1e-9);
  assert.deepEqual(w.pos, { x: 0, z: 0 });
});

test("traffic: rejoining right next to another car", () => {
  const t = createProgressTracker();
  const cars = [car("me", 3.5), car("x", 3.31)];
  t.update(cars, 0);
  const w = computePitWindow({ cars, subjectGuid: "me", lossMs: 20000, tracker: t, now: 0 });
  assert.equal(w.ahead.guid, "x");
  assert.equal(w.ahead.ms, 1000);
  assert.equal(w.traffic, true);
});

test("a backmarker near the rejoin counts on the road but not in the order", () => {
  const t = createProgressTracker();
  const cars = [car("me", 8.5), car("slow", 7.29)];
  t.update(cars, 0);
  const w = computePitWindow({ cars, subjectGuid: "me", lossMs: 20000, tracker: t, now: 0 });
  assert.equal(w.position, 1);
  assert.equal(w.behind.guid, "slow");
  assert.equal(w.behind.laps, -1);
});

test("the line: spline wraps before the lap counter does", () => {
  const t = createProgressTracker();
  t.update([car("me", 4.98)], 0);
  // Across the line, counter still says 4.
  t.update([{ ...car("me", 4.02), lapCount: 4 }], 700);
  assert.ok(Math.abs(t.prog("me") - 5.02) < 1e-9);
  // Counter catches up: no jump.
  t.update([car("me", 5.03)], 1400);
  assert.ok(Math.abs(t.prog("me") - 5.03) < 1e-9);
});

test("a fresh session starts the history over", () => {
  const t = createProgressTracker();
  t.update([car("me", 20.5)], 0);
  t.update([car("me", 0.1)], 700);
  assert.ok(Math.abs(t.prog("me") - 0.1) < 1e-9);
  assert.equal(t.samples("me").length, 1);
});

test("in the pit lane already, or not on track", () => {
  const t = createProgressTracker();
  const cars = [car("me", 2.5, { inPits: true })];
  t.update(cars, 0);
  assert.deepEqual(computePitWindow({ cars, subjectGuid: "me", lossMs: 20000, tracker: t, now: 0 }), { inLane: true });
  assert.equal(computePitWindow({ cars, subjectGuid: "nobody", lossMs: 20000, tracker: t, now: 0 }), null);
});

test("lap reference ignores a slow last lap", () => {
  assert.equal(lapRefMs({ bestLapMs: 80000, lastLapMs: 81000 }), 81000);
  assert.equal(lapRefMs({ bestLapMs: 80000, lastLapMs: 140000 }), 82400);
  assert.equal(lapRefMs({}), null);
});

test("a position on track borrowed from another car", () => {
  const t = createProgressTracker();
  t.update([car("x", 1.3, { pos: { x: 7, z: 9 } })], 0);
  assert.deepEqual(positionAtSpline(t, 0.301), { x: 7, z: 9 });
  assert.equal(positionAtSpline(t, 0.5), null);
});
