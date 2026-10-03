import { test } from "node:test";
import assert from "node:assert/strict";
import { fitRoad } from "./roadFit.js";

// A rectangle of track, 600 m by 300 m, as points every 3 m, anticlockwise.
// `detour` sends the middle of the top side 150 m up and back — the old
// stadium section, in Singapore's terms.
function loop({ detour = false } = {}) {
  const pts = [];
  const leg = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), k = Math.round(len / 3);
    for (let i = 0; i < k; i++) pts.push([x0 + ((x1 - x0) * i) / k, z0 + ((z1 - z0) * i) / k]);
  };
  leg(0, 0, 600, 0);
  leg(600, 0, 600, 300);
  if (detour) {
    leg(600, 300, 400, 300);
    leg(400, 300, 400, 450);
    leg(400, 450, 200, 450);
    leg(200, 450, 200, 300);
    leg(200, 300, 0, 300);
  } else leg(600, 300, 0, 300);
  leg(0, 300, 0, 0);
  return pts;
}

// A road 12 m wide around a line.
function roadAround(pts) {
  const n = pts.length, left = [], right = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n], q = pts[(i + 1) % n];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len;
    left.push([pts[i][0] + nx * 6, pts[i][1] + nz * 6]);
    right.push([pts[i][0] - nx * 6, pts[i][1] - nz * 6]);
  }
  return { closed: true, left, right };
}

test("a road that matches the lap is left exactly as it is", () => {
  const fit = fitRoad(roadAround(loop()), loop());
  assert.equal(fit.useless, false);
  assert.equal(fit.keep, null);
  assert.deepEqual(fit.patches, []);
});

test("a short trip into the run-off is the driver's, not the road's", () => {
  const lap = loop().map(([x, z]) => (x > 290 && x < 320 && z === 0 ? [x, -20] : [x, z]));
  const fit = fitRoad(roadAround(loop()), lap);
  assert.equal(fit.keep, null);
  assert.deepEqual(fit.patches, []);
});

test("an AI line from the old layout: the lap's straight is patched, the detour dropped", () => {
  const road = roadAround(loop({ detour: true }));
  const lap = loop();
  const fit = fitRoad(road, lap);
  assert.equal(fit.useless, false);
  assert.equal(fit.patches.length, 1);
  const patch = fit.patches[0];
  // The strip covers the new straight between the two ends of the detour, as
  // wide as the rest of the road.
  const xs = patch.left.map((p) => p[0]);
  assert.ok(Math.min(...xs) < 230 && Math.max(...xs) > 370);
  assert.ok(patch.left.every(([, z]) => Math.abs(Math.abs(z - 300) - 6) < 0.5));
  // The far side of the detour is no longer drawn; the rest of the loop is.
  const centre = road.left.map((l, i) => [(l[0] + road.right[i][0]) / 2, (l[1] + road.right[i][1]) / 2]);
  centre.forEach(([x, z], i) => {
    if (z > 420) assert.equal(fit.keep[i], false, `top of the detour at ${x},${z}`);
    if (z < 10) assert.equal(fit.keep[i], true, `bottom straight at ${x},${z}`);
  });
  // Where they meet, the old road's edges inside the strip are not drawn, nor
  // the strip's edges on the old road.
  const inStrip = (x, z) => x > 220 && x < 380 && Math.abs(z - 300) < 5;
  road.left.forEach(([x, z], i) => { if (inStrip(x, z)) assert.equal(fit.show.left[i], false, `road edge at ${x},${z}`); });
  road.right.forEach(([x, z], i) => { if (inStrip(x, z)) assert.equal(fit.show.right[i], false, `road edge at ${x},${z}`); });
  const hidden = patch.left.filter((_, i) => !patch.show.left[i]).length + patch.right.filter((_, i) => !patch.show.right[i]).length;
  assert.ok(hidden > 0 && hidden < patch.left.length);
});

test("a road that is not this circuit at all is dropped", () => {
  const far = loop().map(([x, z]) => [x + 5000, z]);
  assert.equal(fitRoad(roadAround(far), loop()).useless, true);
});

test("a lap of few samples still visits the road between them", () => {
  const sparse = loop().filter((_, i) => i % 30 === 0); // ~90 m apart
  const fit = fitRoad(roadAround(loop()), sparse);
  assert.equal(fit.keep, null);
  assert.deepEqual(fit.patches, []);
});
