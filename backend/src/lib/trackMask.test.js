import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { buildTrackMask, decodePngAlpha } from "./trackMask.js";

// A tiny RGBA png: a vertical road 4 px wide in the middle of 20 x 10.
function png(w, h, isRoad) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) if (isRoad(x, y)) row.writeUInt32BE(0x202020ff, 1 + x * 4);
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("trackMask", () => {
  const img = png(20, 10, (x) => x >= 8 && x < 12);

  it("reads the alpha back", () => {
    const { width, alpha } = decodePngAlpha(img);
    expect(width).toBe(20);
    expect(alpha[5 * 20 + 9]).toBe(255);
    expect(alpha[5 * 20 + 2]).toBe(0);
  });

  it("gives zero on the road and metres beside it", () => {
    const m = buildTrackMask(img, { scaleFactor: 1, xOffset: 0, zOffset: 0, padding: 0 });
    expect(m(9, 5)).toBe(0);
    expect(m(2, 5)).toBeGreaterThanOrEqual(4);
    expect(m(2, 5)).toBeLessThanOrEqual(8);
    expect(m(500, 5)).toBeNull();
  });
});
