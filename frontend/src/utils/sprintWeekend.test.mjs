import { test } from "node:test";
import assert from "node:assert/strict";
import { pickNightSession, sessionOfFile, leaderLapsOf } from "./sprintWeekend.mjs";

// The night's sessions as the import page holds them: newest first.
const sprint = { id: "sprint", ts: 3 };
const feature = { id: "feature", ts: 2 };
const practice = { id: "practice", ts: 1 };

test("an ordinary round takes the night's last session, practice race or not", () => {
  assert.equal(pickNightSession([feature, practice]), feature);
  assert.equal(pickNightSession([feature, practice], { session: "SPRINT" }), feature);
  assert.equal(pickNightSession([]), null);
  assert.equal(pickNightSession(null), null);
});

test("on a sprint weekend the sprint is the last session and the feature the one before", () => {
  const night = [sprint, feature, practice];
  assert.equal(pickNightSession(night, { sprintWeekend: true, session: "SPRINT" }), sprint);
  assert.equal(pickNightSession(night, { sprintWeekend: true, session: "RACE" }), feature);
});

test("before the sprint has been run, the feature is still the newest session", () => {
  assert.equal(pickNightSession([feature], { sprintWeekend: true, session: "RACE" }), feature);
});

test("a file is the sprint when its leader ran the sprint distance", () => {
  assert.equal(sessionOfFile({ leaderLaps: 12, raceLaps: 20, sprintLaps: 12 }), "SPRINT");
  assert.equal(sessionOfFile({ leaderLaps: 20, raceLaps: 20, sprintLaps: 12 }), "RACE");
});

test("a file that matches neither distance, or a round without both, is not guessed at", () => {
  assert.equal(sessionOfFile({ leaderLaps: 17, raceLaps: 20, sprintLaps: 12 }), null);
  assert.equal(sessionOfFile({ leaderLaps: 12, raceLaps: null, sprintLaps: 12 }), null);
  assert.equal(sessionOfFile({ leaderLaps: 12, raceLaps: 12, sprintLaps: 12 }), null);
  assert.equal(sessionOfFile({}), null);
});

test("the leader's laps are the most anybody in the file ran", () => {
  assert.equal(leaderLapsOf([{ laps: 11 }, { laps: 12 }, { laps: null }, {}]), 12);
  assert.equal(leaderLapsOf([]), null);
});
