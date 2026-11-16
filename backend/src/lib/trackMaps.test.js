import { describe, it, expect } from "vitest";
import { parseFastLane, roadFromAi, cleanSides, parseMapIni, lapLine } from "./trackMaps.js";

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

  it("caps an edge distance that runs off into a paddock", () => {
    const road = roadFromAi(parseFastLane(circleAi(100, 400, 90, 4)), { step: 3 });
    const widths = road.left.map(([x, z], i) => Math.hypot(x - road.right[i][0], z - road.right[i][1]));
    expect(Math.max(...widths)).toBeLessThan(24.5);
  });

  it("gives up on nothing", () => {
    expect(roadFromAi(null)).toBeNull();
    expect(roadFromAi([[0, 0, 1, 1]])).toBeNull();
  });
});

describe("cleanSides", () => {
  // A circle of radius 300 m (~1.9 km), a point every ~1.5 m, 4 m left and
  // 8 m right, with `edit(i, point)` changing some of them.
  const lap = (edit = () => {}) => {
    const pts = parseFastLane(circleAi(300, 1250, 4, 8));
    pts.forEach((p, i) => edit(i, p));
    return pts;
  };

  it("leaves a road with steady edges as it is", () => {
    const { left, right } = cleanSides(lap());
    expect(left.every((v) => Math.abs(v - 4) < 0.01)).toBe(true);
    expect(right.every((v) => Math.abs(v - 8) < 0.01)).toBe(true);
  });

  it("takes out a spike either way", () => {
    const { left, right } = cleanSides(lap((i, p) => {
      if (i >= 100 && i < 103) p[2] = 19;
      if (i >= 500 && i < 503) p[3] = 0;
    }));
    expect(Math.max(...left)).toBeLessThan(4.1);
    expect(Math.min(...right)).toBeGreaterThan(7.9);
  });

  it("brings a stretch measured into a run-off back to the road (Bahrain T10)", () => {
    // ~75 m where the left reads 25 m and the right grows to 15 m.
    const { left, right } = cleanSides(lap((i, p) => {
      if (i >= 600 && i < 650) {
        p[2] = 25;
        p[3] = 8 + 7 * Math.sin(((i - 600) / 50) * Math.PI);
      }
    }));
    for (let i = 590; i < 660; i++) {
      expect(left[i]).toBeGreaterThan(3.5);
      expect(left[i]).toBeLessThan(4.5);
      expect(right[i]).toBeGreaterThan(7.5);
      expect(right[i]).toBeLessThan(8.5);
    }
  });

  it("keeps the side the file still has right and trims the other", () => {
    // The line moves across the road (left 2 -> 10 m) while the right side
    // runs out 12 m too far for 90 m: the left is kept as it is.
    const { left, right } = cleanSides(lap((i, p) => {
      const t = Math.min(1, Math.max(0, (i - 400) / 300));
      p[2] = 2 + 8 * t;
      p[3] = 10 - 8 * t + (i >= 520 && i < 580 ? 12 : 0);
    }));
    for (let i = 520; i < 580; i++) {
      expect(Math.abs(left[i] - (2 + 8 * ((i - 400) / 300)))).toBeLessThan(0.3);
      expect(Math.abs(left[i] + right[i] - 12)).toBeLessThan(0.8);
    }
  });

  it("keeps the road its real width through bursts of run-off on either side", () => {
    // The real sides wander gently (and meet up again at the start of the
    // lap); now and then one reads 10-15 m too far.
    const turn = (i, k) => (2 * Math.PI * k * i) / 1250;
    const realLeft = (i) => 4 + 2 * Math.sin(turn(i, 5)), realRight = (i) => 7 - 2 * Math.sin(turn(i, 5)) + Math.cos(turn(i, 3));
    const { left, right } = cleanSides(lap((i, p) => {
      p[2] = realLeft(i) + (i % 297 < 40 ? 15 : 0);
      p[3] = realRight(i) + ((i + 150) % 331 < 50 ? 10 : 0);
    }));
    left.forEach((l, i) => {
      expect(Math.abs(l - realLeft(i))).toBeLessThan(1.2);
      expect(Math.abs(right[i] - realRight(i))).toBeLessThan(1.2);
    });
  });
});

describe("roadFromAi at the apexes", () => {
  // A 300 m straight, a left-hand semicircle of radius 40 m, another
  // straight and another semicircle: a stadium. The AI line is `inside` m
  // from the inside edge through the bends and the road is 12 m wide.
  const stadium = (inside) => {
    const pts = [];
    const add = (x, z) => pts.push([x, z]);
    for (let x = 0; x < 300; x += 1.5) add(x, 0);
    for (let a = -Math.PI / 2; a < Math.PI / 2; a += 1.5 / 40) add(300 + 40 * Math.cos(a), 40 + 40 * Math.sin(a));
    for (let x = 300; x > 0; x -= 1.5) add(x, 80);
    for (let a = Math.PI / 2; a < (3 * Math.PI) / 2; a += 1.5 / 40) add(40 * Math.cos(a), 40 + 40 * Math.sin(a));
    return pts.map(([x, z], i) => {
      const bend = (x > 300 || x < 0) && i > 0;
      return [x, z, bend ? 12 - inside : 6, bend ? inside : 6];
    });
  };
  // Distance from the circle centre of each edge point in the right-hand bend.
  const insideGap = (road) => {
    const gaps = [];
    for (const edge of [road.left, road.right]) {
      for (const [x, z] of edge) if (x > 320) gaps.push(40 - Math.hypot(x - 300, z - 40));
    }
    return gaps;
  };

  it("leaves a line that takes the apex where it is", () => {
    const road = roadFromAi(stadium(1.5));
    const g = insideGap(road).filter((v) => v > 0);
    expect(Math.min(...g)).toBeGreaterThan(1.2);
    expect(Math.min(...g)).toBeLessThan(1.8);
  });

  it("slides the road over when the file has the line far from the apex, keeping its width", () => {
    const pts = stadium(10);
    const road = roadFromAi(pts);
    const g = insideGap(road).filter((v) => v > 0);
    expect(Math.min(...g)).toBeLessThan(2);
    const widths = road.left.map(([x, z], i) => Math.hypot(x - road.right[i][0], z - road.right[i][1]));
    expect(Math.min(...widths)).toBeGreaterThan(11);
    expect(Math.max(...widths)).toBeLessThan(13);
  });
});

describe("lapLine", () => {
  it("follows the AI line itself, not the middle of the road, from the start of the lap", () => {
    // 4 m of road one side, 6 m the other: the middle of the tarmac is 1 m off
    // the AI line, and the map.png band is drawn around the AI line.
    const line = lapLine(parseFastLane(circleAi(100, 400)), 8);
    expect(line.every(([x, z]) => Math.abs(Math.hypot(x, z) - 100) < 0.1)).toBe(true);
    // The first point is the AI line's first point, which is where the lap starts.
    expect(Math.atan2(line[0][1], line[0][0])).toBeCloseTo(0, 1);
    // A point every few metres: 628 m of lap at ~8 m.
    expect(line.length).toBeGreaterThan(60);
    expect(line.length).toBeLessThan(90);
  });

  it("has nothing to say about a missing or broken line", () => {
    expect(lapLine(null)).toBeNull();
    expect(lapLine([[0, 0, 1, 1]])).toBeNull();
  });
});

describe("parseMapIni", () => {
  it("still reads the map calibration", () => {
    expect(parseMapIni("[PARAMETERS]\nWIDTH=100\nHEIGHT=200\nSCALE_FACTOR=0.5\nX_OFFSET=-3\nZ_OFFSET=4\n")).toEqual({ width: 100, height: 200, scaleFactor: 0.5, xOffset: -3, zOffset: 4, padding: 0 });
  });
});
