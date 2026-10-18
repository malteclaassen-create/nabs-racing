import { test } from "node:test";
import assert from "node:assert/strict";
import { eventPhase, eventRace } from "./eventPhase.js";

const NOW = Date.parse("2026-11-06T18:00:00Z");
const race = (over) => ({ id: "r", date: "2026-11-06T17:30:00Z", isCompleted: false, isSpecialEvent: false, ...over });

test("the phase follows the race from countdown to result", () => {
  assert.equal(eventPhase(null, NOW), "none");
  assert.equal(eventPhase(race({ date: "2026-11-07T17:30:00Z" }), NOW), "before");
  assert.equal(eventPhase(race({ date: null }), NOW), "before");
  assert.equal(eventPhase(race(), NOW), "live");
  assert.equal(eventPhase(race({ date: "2026-11-06T12:00:00Z" }), NOW), "pending");
  assert.equal(eventPhase(race({ isCompleted: true }), NOW), "after");
});

test("the event's race is the next one to come, else the last one", () => {
  const done = race({ id: "a", date: "2026-10-01T17:30:00Z", isCompleted: true });
  const next = race({ id: "b", date: "2026-11-13T17:30:00Z" });
  const sprint = race({ id: "s", date: "2026-11-06T17:00:00Z", isSpecialEvent: true, sprintOf: "b" });
  assert.equal(eventRace([done, next, sprint], NOW).id, "b");
  assert.equal(eventRace([done], NOW).id, "a");
  assert.equal(eventRace([], NOW), null);
});

test("tonight's race stays the event's race while it is being run", () => {
  assert.equal(eventRace([race({ id: "tonight" })], NOW).id, "tonight");
});
