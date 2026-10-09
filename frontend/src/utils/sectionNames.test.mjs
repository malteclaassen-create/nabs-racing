import { test } from "node:test";
import assert from "node:assert/strict";
import { labelSections, lapNames } from "./sectionNames.js";

const corners = [{ at: 8.2, turn: 1, name: "" }, { at: 9.6, turn: 2, name: "" }, { at: 11.1, turn: 3, name: "" }, { at: 40.9, turn: 8, name: "" }, { at: 70, turn: 12, name: "Anderson" }];
// n = 1001: slice i is i/10 % of the lap.
const section = (n, coreStart, coreEnd, apex) => ({ n, start: coreStart - 30, end: coreEnd + 12, coreStart, coreEnd, apex });

test("a section is named after the circuit's corners inside it", () => {
  const [a, b, c, d] = labelSections([section(1, 75, 115, 110), section(2, 395, 415, 409), section(3, 690, 705, 700), section(4, 900, 910, 905)], corners, 1001);
  assert.equal(a.label, "T1–T3");
  assert.equal(a.tag, "T1–3");
  assert.equal(b.label, "T8");
  assert.equal(c.label, "T12 Anderson");
  assert.equal(c.tag, "T12");
  // Nothing named near it: the number, said the same way everywhere.
  assert.equal(d.label, "Section 4");
  assert.equal(d.tag, "4");
  assert.equal(d.named, false);
});

test("two laps of one driver are told apart by their times", () => {
  const fmt = (ms) => `${ms}`;
  assert.deepEqual(lapNames({ name: "Neesh", steamId: "1" }, { name: "Malte", steamId: "2" }, fmt), { a: "Neesh", b: "Malte", same: false });
  assert.deepEqual(lapNames({ name: "Malte", steamId: "2", lapTimeMs: 1 }, { name: "Malte", steamId: "2", lapTimeMs: 2 }, fmt), { a: "1", b: "2", same: true });
});
