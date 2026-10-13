import { test } from "node:test";
import assert from "node:assert/strict";
import { describeLayouts, layoutProbes, pickLayout, trackBases, tvCameraAt } from "./acTrackLayout.js";
import { fillGaps, groundGrid, lapHeights } from "./groundHeight.js";

test("a single layout track is one layout with an empty id", () => {
  const names = ["ks_brands_hatch.kn5", "models.ini", "map.png"];
  const found = new Set(["data/surfaces.ini", "ai/fast_lane.ai"]);
  const [only, ...rest] = describeLayouts(names, (p) => found.has(p));
  assert.equal(rest.length, 0);
  assert.deepEqual(only, { id: "", modelsIni: "models.ini", dataDir: "data", aiDir: "ai", uiFile: null });
});

test("a multi layout track is read off its models_<layout>.ini files", () => {
  const names = ["models_gp.ini", "models_indy.ini", "vhe.kn5"];
  const found = new Set(["gp/data/surfaces.ini", "gp/ai/fast_lane.ai", "ui/gp/ui_track.json", "indy/ai/fast_lane.ai"]);
  const layouts = describeLayouts(names, (p) => found.has(p));
  assert.deepEqual(layouts.map((l) => l.id), ["gp", "indy"]);
  assert.equal(layouts[0].dataDir, "gp/data");
  assert.equal(layouts[1].dataDir, null);
  assert.deepEqual(layoutProbes(names), [
    "gp/data/surfaces.ini", "gp/ai/fast_lane.ai", "ui/gp/ui_track.json",
    "indy/data/surfaces.ini", "indy/ai/fast_lane.ai", "ui/indy/ui_track.json",
  ]);
});

test("the lap's layout is matched without case, and a missing one falls back to the first", () => {
  const layouts = [{ id: "GP" }, { id: "national" }];
  assert.equal(pickLayout(layouts, "national").id, "national");
  assert.equal(pickLayout(layouts, "gp").id, "GP");
  assert.equal(pickLayout(layouts, "club").id, "GP");
  assert.equal(pickLayout([], "gp"), null);
});

test("the track is looked for under the install, content, tracks, then on its own", () => {
  assert.deepEqual(trackBases("ks_monza"), ["content/tracks/ks_monza", "tracks/ks_monza", "ks_monza"]);
});

test("the TV camera is the one whose stretch holds the position, across the line too", () => {
  const cams = [{ id: 1, inPoint: 0.1, outPoint: 0.5 }, { id: 2, inPoint: 0.5, outPoint: 0.9 }, { id: 3, inPoint: 0.9, outPoint: 0.1 }];
  assert.equal(tvCameraAt(cams, 0.2).id, 1);
  assert.equal(tvCameraAt(cams, 0.5).id, 2);
  assert.equal(tvCameraAt(cams, 0.95).id, 3);
  assert.equal(tvCameraAt(cams, 0.02).id, 3);
  assert.equal(tvCameraAt([cams[0]], 0.7), null);
});

// A 20 m square ramp, rising 2 m from x = 0 to x = 20, as two triangles.
const ramp = [0, 0, 0, 20, 2, 0, 20, 2, 20, 0, 0, 0, 20, 2, 20, 0, 0, 20];

test("the ground height is read off the triangle under the point", () => {
  const grid = groundGrid(ramp);
  assert.ok(Math.abs(grid.heightAt(10, 5) - 1) < 1e-9);
  assert.ok(Math.abs(grid.heightAt(15, 15) - 1.5) < 1e-9);
  assert.equal(grid.heightAt(30, 5), null);
  assert.equal(grid.heightAt(-50, 5), null);
});

test("where the road crosses itself, the height nearest the last one wins", () => {
  const bridge = ramp.map((v, i) => (i % 3 === 1 ? v + 8 : v));
  const grid = groundGrid([...ramp, ...bridge]);
  assert.ok(Math.abs(grid.heightAt(10, 5) - 9) < 1e-9, "highest without a hint");
  assert.ok(Math.abs(grid.heightAt(10, 5, 0.5) - 1) < 1e-9, "the lower road when coming from below");
  assert.ok(Math.abs(grid.heightAt(10, 5, 8.6) - 9) < 1e-9, "the bridge when coming from it");
});

test("a lap's heights fill the points with no ground under them from either side", () => {
  const grid = groundGrid(ramp);
  // Decimetres, as the laps store them: x = 5, 10, 40 (off the ramp), 15 m.
  const h = lapHeights(grid, [50, 100, 400, 150], [50, 50, 50, 50], 4);
  assert.deepEqual(h.map((v) => Math.round(v * 100) / 100), [0.5, 1, 1.25, 1.5]);
  assert.deepEqual(fillGaps([null, 2, null]), [2, 2, 2]);
  assert.deepEqual(fillGaps([null, null]), [0, 0]);
});
