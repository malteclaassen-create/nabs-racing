import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTips, cornerName, explain, TIP_MIN_MS } from "./drivingTips.js";

// Two laps only need what the tips read off them directly: the lap time, the
// name, and a brake channel for the peak pressure.
const lap = (name, lapTimeMs, steamId, brake = 80) => ({ name, lapTimeMs, steamId, n: 101, brake: new Array(101).fill(brake), speed: new Array(101).fill(200) });

// A section as telemetryAnalysis.cornerInsights hands it over, written from
// B's side: + gainMs = B lost time, + brakeDeltaM = B brakes later.
const section = (over) => ({
  n: 1, start: 20, end: 40, apex: 30, atM: 900, gainMs: 0,
  brakeA: null, brakeB: null, gasA: null, gasB: null,
  brakeDeltaM: 0, throttleDeltaM: 0, minA: 100, minB: 100, midDelta: 0, exitA: 180, exitB: 180, exitDelta: 0,
  ...over,
});

test("tips are written for the slower lap, whichever side it is on", () => {
  const a = lap("Neesh", 82188, "1");
  const b = lap("Malte", 82914, "2");
  const out = buildTips([section({ gainMs: 230, brakeDeltaM: -15, minB: 96, minA: 104 })], a, b, { n: 101 });
  assert.equal(out.student, "B");
  assert.equal(out.studentName, "Malte");
  assert.equal(out.tips.length, 1);
  assert.equal(out.tips[0].kind, "braking");
  assert.match(out.tips[0].say, /15 m earlier/);
  assert.match(out.tips[0].say, /8 km\/h less/);
  // The same section with the laps the other way round is the same advice.
  const flipped = buildTips([section({ gainMs: -230, brakeDeltaM: 15, minA: 96, minB: 104 })], b, a, { n: 101 });
  assert.equal(flipped.student, "A");
  assert.equal(flipped.tips[0].kind, "braking");
  assert.match(flipped.tips[0].say, /15 m earlier\*\* than Neesh/);
});

test("small differences give no tip, and a gain becomes a strength", () => {
  const out = buildTips([
    section({ n: 1, gainMs: TIP_MIN_MS - 1 }),
    section({ n: 2, gainMs: -40, minB: 108, minA: 104 }),
  ], lap("A", 80000, "1"), lap("B", 80100, "2"), { n: 101 });
  assert.equal(out.tips.length, 0);
  assert.equal(out.strengths.length, 1);
  assert.match(out.strengths[0].say, /4 km\/h more/);
});

test("each kind of difference gets its own explanation", () => {
  const base = { lostMs: 100, brakeLaterM: 0, throttleLaterM: 0, minMe: 100, minRef: 100, exitMe: 180, exitRef: 180, peakMe: 90, peakRef: 90 };
  assert.equal(explain({ ...base, brakeLaterM: -12 }, "Ref").kind, "braking");
  assert.equal(explain({ ...base, brakeLaterM: 8, minMe: 94 }, "Ref").kind, "entry");
  assert.equal(explain({ ...base, minMe: 92 }, "Ref").kind, "speed");
  assert.equal(explain({ ...base, throttleLaterM: 24 }, "Ref").kind, "exit");
  assert.equal(explain(base, "Ref").kind, "line");
});

test("a soft first press of the brake pedal is mentioned with the braking tip", () => {
  const t = explain({ lostMs: 100, brakeLaterM: -15, throttleLaterM: 0, minMe: 96, minRef: 104, exitMe: 180, exitRef: 180, peakMe: 84, peakRef: 100 }, "Ref");
  assert.match(t.try, /84%/);
});

test("a section takes the name of the admin-named corner near its apex, round the lap", () => {
  const corners = [{ at: 11, turn: 1, name: "Rettifilo" }, { at: 99, turn: null, name: "Parabolica" }, { at: 50, turn: 6, name: "" }];
  assert.equal(cornerName(12.5, corners).label, "T1 Rettifilo");
  assert.equal(cornerName(1, corners).label, "Parabolica");
  assert.equal(cornerName(51, corners).label, "T6");
  assert.equal(cornerName(30, corners), null);
});

test("one habit behind most of the lost time is called out as a pattern", () => {
  const out = buildTips([
    section({ n: 1, apex: 10, gainMs: 200, brakeDeltaM: -15 }),
    section({ n: 2, apex: 50, gainMs: 120, brakeDeltaM: -10 }),
    section({ n: 3, apex: 80, gainMs: 60, throttleDeltaM: 20 }),
  ], lap("A", 80000, "1"), lap("B", 80500, "2"), { n: 101 });
  assert.equal(out.pattern?.kind, "braking");
  assert.equal(out.pattern.count, 2);
  assert.equal(out.top3Ms, 380);
  assert.equal(out.restMs, 500 - 380);
});

test("two laps of the same driver compare against 'your quicker lap'", () => {
  const out = buildTips([section({ gainMs: 100, brakeDeltaM: -10 })], lap("Malte", 80000, "7"), lap("Malte", 80300, "7"), { n: 101 });
  assert.match(out.tips[0].say, /your quicker lap/);
});

test("without a measured brake point the tip says nothing about braking", () => {
  const t = explain({ lostMs: 100, brakeLaterM: null, throttleLaterM: null, minMe: 92, minRef: 100, exitMe: 180, exitRef: 180, peakMe: 90, peakRef: 90 }, "Ref");
  assert.equal(t.kind, "speed");
  assert.doesNotMatch(t.say, /Braking/);
  const measured = explain({ lostMs: 100, brakeLaterM: 1, throttleLaterM: 0, minMe: 92, minRef: 100, exitMe: 180, exitRef: 180, peakMe: 90, peakRef: 90 }, "Ref");
  assert.match(measured.say, /Braking is about the same/);
});
