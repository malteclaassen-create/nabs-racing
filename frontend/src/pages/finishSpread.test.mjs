import { test } from "node:test";
import assert from "node:assert/strict";
import { finishSpread, TAIL_FROM } from "./finishSpread.mjs";

const race = (position, status = "FINISHED") => ({ position, status });

test("one bar per position, up to the worst finish", () => {
  const s = finishSpread([race(1), race(3), race(3), race(5)]);
  assert.equal(s.bars.length, 5);
  assert.deepEqual(s.bars.map((b) => b.count), [1, 0, 2, 0, 1]);
  assert.equal(s.starts, 4);
  assert.equal(s.finishes, 4);
});

test("a DNS is not a start, a DNF is a start but not a finish", () => {
  const s = finishSpread([race(2), race(null, "DNS"), race(null, "DNF"), race(null, "DSQ")]);
  assert.equal(s.starts, 3);
  assert.equal(s.finishes, 1);
  assert.deepEqual(s.out.map((o) => [o.label, o.count]), [["DNF", 1], ["DSQ", 1]]);
});

test("everything past the tail mark is one bar", () => {
  const s = finishSpread([race(1), race(TAIL_FROM), race(TAIL_FROM + 4), race(31)]);
  const tail = s.bars[s.bars.length - 1];
  assert.equal(tail.label, `${TAIL_FROM}+`);
  assert.equal(tail.count, 3);
  assert.equal(s.bars.length, TAIL_FROM); // P1..P20 plus the tail
});

test("average and median describe the finishes only", () => {
  const s = finishSpread([race(2), race(4), race(6), race(null, "DNF")]);
  assert.equal(s.avg, 4);
  assert.equal(s.median, 4); // the middle finish of three
  assert.equal(s.starts, 4);
});

test("most often names a single position, never the bundled tail", () => {
  const s = finishSpread([race(5), race(5), race(30), race(30), race(30), race(30)]);
  assert.equal(s.most.label, "5");
  assert.equal(s.most.count, 2);
});

test("nothing to say about a career with no starts", () => {
  assert.equal(finishSpread([]), null);
  assert.equal(finishSpread([race(null, "DNS")]), null);
});
