import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStrike } from "./profileLightning.mjs";

const distance = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);

test("random strikes stay connected throughout growth and start on an edge", () => {
  for (let seed = 0; seed < 1000; seed++) {
    const strike = makeStrike(seed * 104729 + 7919);
    const [x, y] = strike[0].points[0];
    assert.ok(x === 0 || x === 1000 || y === 0 || y === 700);
    for (const segment of strike) {
      assert.ok(segment.start >= 0 && segment.span > 0 && segment.start + segment.span <= 1);
      if (segment.parent === undefined) continue;
      const parent = strike[segment.parent];
      assert.deepEqual(segment.points[0], parent.points[segment.vertex]);
      const arrival = parent.start + parent.span * distance(parent.points.slice(0, segment.vertex + 1)) / distance(parent.points);
      assert.ok(segment.start > arrival, "A branch must wait for its parent to reach the junction");
      // The parent never retracts during growth; every visible branch must
      // retain its connection throughout the entire shared progress interval.
      for (let progress = 0; progress <= 1; progress += .01) {
        if (progress > segment.start) assert.ok(progress > arrival);
      }
    }
  }
});

test("long desktop and mobile profiles use document edges without stretching bolts", () => {
  for (const [width, height] of [[1440, 5200], [390, 8500], [1000, 700]]) {
    const edges = new Set();
    let lowestSideStart = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const strike = makeStrike(seed * 104729 + 7919, width, height);
      const [x, y] = strike[0].points[0];
      assert.ok(x === 0 || x === width || y === 0 || y === height);
      if (x === 0 || x === width) {
        edges.add(x === 0 ? "left" : "right");
        lowestSideStart = Math.max(lowestSideStart, y);
      } else edges.add(y === 0 ? "top" : "bottom");
      const last = strike[0].points.at(-1);
      assert.ok(Math.hypot(last[0] - x, last[1] - y) <= 571 * Math.min(1, width / 700));
      for (const segment of strike) {
        assert.ok(segment.points.every(point => point.every(Number.isFinite)));
        if (segment.parent !== undefined) assert.deepEqual(segment.points[0], strike[segment.parent].points[segment.vertex]);
      }
    }
    assert.equal(edges.size, 4);
    assert.ok(lowestSideStart > height * .85);
  }
});
