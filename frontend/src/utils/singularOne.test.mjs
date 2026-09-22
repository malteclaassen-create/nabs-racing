import { test } from "node:test";
import assert from "node:assert/strict";
import { singularOne } from "./format.js";

test("one dropped round reads singular", () => {
  assert.equal(singularOne("Every driver's 1 lowest-scoring rounds are dropped."), "Every driver's 1 lowest-scoring round is dropped.");
  assert.equal(singularOne("Teams drop their own 1 weakest single-driver rounds too."), "Teams drop their own 1 weakest single-driver round too.");
});

test("leaves everything else alone", () => {
  assert.equal(singularOne("Every driver's 3 lowest-scoring rounds are dropped."), "Every driver's 3 lowest-scoring rounds are dropped.");
  assert.equal(singularOne("P1 is 35 down to P18"), "P1 is 35 down to P18");
  assert.equal(singularOne("21 rounds"), "21 rounds");
});
