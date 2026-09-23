import { test } from "node:test";
import assert from "node:assert/strict";
import { knownTrackNames, nextFreeRoundNumber, planProblem, planRounds, TRACK_TBA } from "./roundBatch.js";

test("the next free round number skips events, trainings and sprint rows", () => {
  const races = [
    { number: 1, type: "CHAMPIONSHIP" },
    { number: 12, type: "CHAMPIONSHIP" },
    { number: null, type: "SPECIAL" },
    { number: 40, type: "TRAINING" },
    { number: 99, type: "SPECIAL", sprintOf: "x" },
  ];
  assert.equal(nextFreeRoundNumber(races), 13);
  assert.equal(nextFreeRoundNumber([]), 1);
});

test("a plan repeats weekly at the same wall-clock time, numbered on", () => {
  const first = new Date(2026, 2, 20, 20, 0); // across the change to summer time in Europe
  const plan = planRounds({ count: 3, firstDate: first, firstNumber: 13, tracks: ["Spa", "", "  Monza "] });
  assert.deepEqual(plan.map((r) => r.number), [13, 14, 15]);
  assert.deepEqual(plan.map((r) => r.track), ["Spa", TRACK_TBA, "Monza"]);
  for (const [i, r] of plan.entries()) {
    const d = new Date(r.date);
    assert.equal(d.getHours(), 20);
    assert.equal(d.getMinutes(), 0);
    assert.equal(d.getDate(), new Date(2026, 2, 20 + 7 * i).getDate());
  }
});

test("no date means undated rounds, and the count is capped", () => {
  assert.equal(planRounds({ count: 2, firstDate: "", firstNumber: 1 })[1].date, null);
  assert.equal(planRounds({ count: 50, firstNumber: 1 }).length, 20);
  assert.equal(planRounds({ count: 0, firstNumber: 1 }).length, 0);
});

test("the plan's problems are said before anything is sent", () => {
  assert.equal(planProblem({ count: 3, firstNumber: 13 }), null);
  assert.ok(planProblem({ count: 0, firstNumber: 13 }));
  assert.ok(planProblem({ count: 21, firstNumber: 13 }));
  assert.ok(planProblem({ count: 3, firstNumber: 0 }));
});

test("track suggestions are unique and sorted, and the season's spelling wins", () => {
  assert.deepEqual(knownTrackNames([{ track: "Spa" }, { track: "spa" }, { track: TRACK_TBA }], ["Monza", "Spa"]), ["Monza", "Spa"]);
});
