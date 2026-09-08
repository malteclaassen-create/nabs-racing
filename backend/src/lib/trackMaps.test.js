import { describe, it, expect } from "vitest";
import { parseFastLane, roadFromAi, parseMapIni } from "./trackMaps.js";

// An AI file for a circle of radius r: `count` points anticlockwise in x/z,
// 4 m of road to the left of the line and 6 m to the right.
function circleAi(r, count, left = 4, right = 6) {
  const buf = Buffer.alloc(16 + count * 20 + 4 + count * 72);
  buf.writeInt32LE(7, 0);
  buf.writeInt32LE(count, 4);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const p = 16 + i * 20;
    buf.writeFloatLE(r * Math.cos(a), p);
    buf.writeFloatLE(0, p + 4);
    buf.writeFloatLE(r * Math.sin(a), p + 8);
    buf.writeFloatLE((i / count) * 2 * Math.PI * r, p + 12);
    buf.writeInt32LE(i, p + 16);
  }
  const extraAt = 16 + count * 20;
  buf.writeInt32LE(count, extraAt);
  for (let i = 0; i < count; i++) {
    const e = extraAt + 4 + i * 72;
    buf.writeFloatLE(left, e + 20);
    buf.writeFloatLE(right, e + 24);
  }
  return buf;
}

describe("parseFastLane", () => {
  it("reads the points and both edge distances", () => {
    const pts = parseFastLane(circleAi(100, 50));
    expect(pts).toHaveLength(50);
    expect(pts[0][0]).toBeCloseTo(100);
    expect(pts[0][1]).toBeCloseTo(0);
    expect(pts[0][2]).toBe(4);
    expect(pts[0][3]).toBe(6);
  });

  it("refuses bytes that are not a version-7 AI file", () => {
    expect(parseFastLane(null)).toBeNull();
    expect(parseFastLane(Buffer.from("<html>not found</html>"))).toBeNull();
    const wrong = circleAi(100, 50);
    wrong.writeInt32LE(6, 0);
    expect(parseFastLane(wrong)).toBeNull();
    expect(parseFastLane(circleAi(100, 50).subarray(0, 500))).toBeNull();
  });
});

describe("roadFromAi", () => {
  it("offsets each edge by its own distance, keeping the loop closed", () => {
    const road = roadFromAi(parseFastLane(circleAi(100, 400)), { step: 3 });
    expect(road.closed).toBe(true);
    expect(road.left.length).toBeGreaterThan(150);
    expect(road.left).toHaveLength(road.right.length);
    // Every edge point sits at r±side from the centre; which side is which is
    // fixed by the (x, z) handedness the laps are recorded in.
    const radii = (edge) => edge.map(([x, z]) => Math.hypot(x, z));
    const rl = radii(road.left), rr = radii(road.right);
    const one = (arr, v) => arr.every((r) => Math.abs(r - v) < 0.2);
    expect(one(rl, 96) || one(rl, 104)).toBe(true);
    expect(one(rr, 106) || one(rr, 94)).toBe(true);
    expect(Math.abs(rl[0] - rr[0])).toBeCloseTo(10, 0);
  });

  it("thins the line to the asked spacing and keeps the ends of an open lane", () => {
    const pts = parseFastLane(circleAi(100, 400)).slice(0, 100); // an arc, ~155 m
    const road = roadFromAi(pts, { closed: false, step: 10 });
    expect(road.closed).toBe(false);
    expect(road.left.length).toBeGreaterThanOrEqual(15);
    expect(road.left.length).toBeLessThanOrEqual(18);
    const [lx, lz] = road.left[road.left.length - 1];
    expect(Math.hypot(lx - pts[99][0], lz - pts[99][1])).toBeCloseTo(4, 0);
  });

  it("draws a lane with no edge distances at the fallback width, or not at all", () => {
    const pts = parseFastLane(circleAi(100, 400, 0, 0));
    expect(roadFromAi(pts)).toBeNull();
    const road = roadFromAi(pts, { closed: false, fallbackHalfWidth: 3 });
    const [lx, lz] = road.left[5], [rx, rz] = road.right[5];
    expect(Math.hypot(lx - rx, lz - rz)).toBeCloseTo(6, 0);
  });

  it("gives up on nothing", () => {
    expect(roadFromAi(null)).toBeNull();
    expect(roadFromAi([[0, 0, 1, 1]])).toBeNull();
  });
});

describe("parseMapIni", () => {
  it("still reads the map calibration", () => {
    expect(parseMapIni("[PARAMETERS]\nWIDTH=100\nHEIGHT=200\nSCALE_FACTOR=0.5\nX_OFFSET=-3\nZ_OFFSET=4\n")).toEqual({ width: 100, height: 200, scaleFactor: 0.5, xOffset: -3, zOffset: 4, padding: 0 });
  });
});
