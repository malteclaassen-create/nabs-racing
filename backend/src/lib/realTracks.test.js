import { describe, it, expect } from "vitest";
import { loadRealTracks, parseRealTrack, realRoad } from "./realTracks.js";

const tracks = loadRealTracks();
const sakhir = tracks.find((t) => t.name === "Sakhir");

// The real centre line as a game would have it: mirrored on z, turned,
// moved and scaled, a point every ~1.5 m, with `lateral(i)` metres to the
// right of the centre added (a racing line is not on the centre).
function gameLine(real, { angle = 1.1, tx = 350, ty = -220, s = 1, mirror = true, lateral = () => 0 } = {}) {
  const out = [];
  const n = real.centre.length;
  for (let i = 0; i < n; i++) {
    const a = real.centre[i], b = real.centre[(i + 1) % n];
    const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5));
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    for (let j = 0; j < k; j++) {
      const t = j / k, off = lateral(out.length);
      const x = a[0] + dx * t + (dy / len) * off, y = a[1] + dy * t - (dx / len) * off;
      const c = Math.cos(angle), sn = Math.sin(angle);
      const gx = s * (c * x - sn * y) + tx, gz = s * (sn * x + c * y) + ty;
      out.push([gx, mirror ? -gz : gz, 5, 5]);
    }
  }
  return out;
}

const distToLine = (p, line) => Math.min(...line.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])));

describe("real tracks", () => {
  it("reads the circuits shipped with the site", () => {
    expect(tracks.length).toBeGreaterThanOrEqual(20);
    expect(sakhir.length).toBeGreaterThan(5000);
    expect(sakhir.length).toBeLessThan(5700);
    expect(parseRealTrack("x", "# nothing\n1,2,3\n")).toBeNull();
  });

  it("lays the real circuit under a line that is that circuit, however the game turns it", () => {
    const line = gameLine(sakhir, { lateral: (i) => 3 * Math.sin(i / 60) });
    const road = realRoad(line, tracks);
    expect(road?.source).toBe("Sakhir");
    expect(road.closed).toBe(true);
    expect(road.left).toHaveLength(road.right.length);
    // Every edge point is about a half-width (the real ones are ~6 m) from
    // the centre line, which sits within ~3 m of the game line.
    const probe = line.filter((_, i) => i % 3 === 0);
    for (const edge of [road.left, road.right]) {
      for (const p of edge.filter((_, i) => i % 50 === 0)) {
        const d = distToLine(p, probe);
        expect(d).toBeGreaterThan(1);
        expect(d).toBeLessThan(15);
      }
    }
  });

  it("keeps the game line on the road where the two disagree by a few metres", () => {
    // 6 m off to the right for ~60 m, as a mod's survey and the map can part.
    const line = gameLine(sakhir, { lateral: (i) => (i > 1000 && i < 1040 ? 6 + 6 : 0) });
    const road = realRoad(line, tracks);
    expect(road?.source).toBe("Sakhir");
    const centre = road.left.map((l, i) => [(l[0] + road.right[i][0]) / 2, (l[1] + road.right[i][1]) / 2]);
    const half = road.left.map((l, i) => Math.hypot(l[0] - road.right[i][0], l[1] - road.right[i][1]) / 2);
    for (const p of line.slice(1000, 1040)) {
      let best = 0, bd = Infinity;
      centre.forEach((c, i) => {
        const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
        if (d < bd) { bd = d; best = i; }
      });
      expect(bd).toBeLessThan(half[best] + 0.8);
    }
  });

  it("leaves a line alone that is not a real circuit, or not to scale", () => {
    const circle = Array.from({ length: 3000 }, (_, i) => {
      const a = (i / 3000) * 2 * Math.PI;
      return [850 * Math.cos(a), 850 * Math.sin(a), 5, 5];
    });
    expect(realRoad(circle, tracks)).toBeNull();
    expect(realRoad(gameLine(sakhir, { s: 1.06 }), tracks)).toBeNull();
    expect(realRoad(null, tracks)).toBeNull();
    expect(realRoad(gameLine(sakhir), [])).toBeNull();
  });
});
