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

// --- utils/zipReader.js and utils/dxtDecode.js ------------------------------
import { deflateRawSync } from "node:zlib";
import { readerFromZip, zipEntries } from "./zipReader.js";
import { decodeDxt } from "./dxtDecode.js";

// A real ZIP, built by hand: one stored file, one deflated, in a mod folder.
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text, deflate] of files) {
    const raw = Buffer.from(text), body = deflate ? deflateRawSync(raw) : raw, nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new File([Buffer.concat([...locals, cd, end])], "My Track Mod v2.zip");
}

test("a mod's ZIP reads like a folder, unpacking only what is asked for", async () => {
  const zip = makeZip([
    ["My Mod/content/tracks/ks_test/data/surfaces.ini", "[SURFACE_0]\nKEY=ROAD\n", true],
    ["My Mod/content/tracks/ks_test/ks_test.kn5", "model bytes", false],
    ["My Mod/readme.txt", "hello", true],
  ]);
  assert.equal((await zipEntries(zip)).length, 3);
  const reader = await readerFromZip(zip);
  assert.equal(reader.name, "My Track Mod v2");
  assert.equal(reader.findDir("KS_TEST"), "my mod/content/tracks/ks_test");
  assert.equal(await reader.hasDir("my mod/content/tracks/ks_test/data"), true);
  assert.deepEqual((await reader.list("My Mod/content/tracks/ks_test")).map((e) => [e.name, e.kind]).sort(),
    [["data", "directory"], ["ks_test.kn5", "file"]]);
  assert.equal(await (await reader.getFile("my mod/content/tracks/ks_test/DATA/surfaces.ini")).text(), "[SURFACE_0]\nKEY=ROAD\n");
  assert.equal(await (await reader.getFile("My Mod/content/tracks/ks_test/ks_test.kn5")).text(), "model bytes");
  assert.equal(await reader.getFile("My Mod/nothing.ini"), null);
});

test("a ZIP holding one track under another name is still found by its model", async () => {
  const reader = await readerFromZip(makeZip([["rt_track_v3/rt_track.kn5", "x", false]]));
  assert.equal(reader.findDir("rt_track"), "rt_track_v3");
  await assert.rejects(readerFromZip(new File(["not a zip"], "a.zip")), /not a ZIP/);
});

test("DXT1 and DXT5 blocks unpack to the colours and alpha they encode", () => {
  // DXT1: colour0 pure red (0xF800), colour1 pure blue (0x001F), every pixel index 0
  // except the first row, index 1.
  const dxt1 = new Uint8Array([0x00, 0xf8, 0x1f, 0x00, 0x55, 0x00, 0x00, 0x00]);
  const a = decodeDxt(dxt1, 4, 4, 1);
  assert.deepEqual([...a.subarray(0, 4)], [0, 0, 255, 255], "first row blue");
  assert.deepEqual([...a.subarray(16, 20)], [255, 0, 0, 255], "second row red");
  // DXT5: alpha 255 / 0, every alpha index 1 (= 0) except pixel 0 (index 0 = 255).
  let bits = 0n;
  for (let i = 15; i >= 1; i--) bits = (bits << 3n) | 1n; // pixels 1..15: index 1
  bits <<= 3n; // pixel 0: index 0
  const packed = [0, 1, 2, 3, 4, 5].map((k) => Number((bits >> BigInt(k * 8)) & 0xffn));
  const dxt5 = new Uint8Array([255, 0, ...packed, 0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0]);
  const b = decodeDxt(dxt5, 4, 4, 5);
  assert.equal(b[3], 255);
  assert.equal(b[7], 0);
  assert.deepEqual([...b.subarray(0, 3)], [255, 0, 0]);
  // A texture smaller than a block still fills its own pixels.
  assert.equal(decodeDxt(dxt1, 2, 2, 1).length, 16);
});
