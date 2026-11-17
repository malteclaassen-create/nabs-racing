import { test } from "node:test";
import assert from "node:assert/strict";
import { teamLabel, tierLabel } from "./teamLabel.js";

test("a Division 2 team carries its division, Division 1 keeps the plain name", () => {
  assert.equal(teamLabel({ name: "McLaren", tier: 1 }), "McLaren");
  assert.equal(teamLabel({ name: "McLaren", tier: 2 }), "McLaren");
  assert.equal(teamLabel({ name: "McLaren", tier: 3 }), "McLaren (Division 2)");
  assert.equal(teamLabel({ name: "Reserve", tier: 0 }), "Reserve");
  assert.equal(teamLabel(null), "");
});

test("tier numbers read as the league says them", () => {
  assert.equal(tierLabel(1), "Tier 1");
  assert.equal(tierLabel(2), "Tier 2");
  assert.equal(tierLabel(3), "Division 2");
  assert.equal(tierLabel(0), "Reserve");
});
