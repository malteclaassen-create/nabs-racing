import { describe, expect, it } from "vitest";
import { boardSkins, carBox, liveryColor } from "./liveryPreview.js";

const W = 96;
const H = 54;

// A black showroom with a car-sized block in it, painted by `paint(x, y)`.
function picture(paint) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 12; y < 42; y++) {
    for (let x = 10; x < 86; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

const hue = (color) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return { r, g, b };
};

describe("carBox", () => {
  it("finds the car in the dark", () => {
    expect(carBox(picture(() => [200, 30, 30]), W, H)).toEqual({ left: 10, right: 85, top: 12, bottom: 41 });
  });

  it("has nothing to say about an empty showroom", () => {
    expect(carBox(new Uint8ClampedArray(W * H * 4), W, H)).toBeNull();
  });
});

describe("liveryColor", () => {
  it("takes the paint, not an average of everything on the car", () => {
    // Two thirds red, a third yellow: averaged, that is an orange nobody painted.
    const c = hue(liveryColor(picture((x) => (x < 60 ? [210, 20, 20] : [230, 210, 20])), W, H));
    expect(c.r).toBeGreaterThan(150);
    expect(c.g).toBeLessThan(80);
  });

  it("calls a white car white and a grey car grey", () => {
    expect(liveryColor(picture(() => [235, 235, 235]), W, H)).toBe("#d4d8de");
    expect(liveryColor(picture(() => [90, 90, 90]), W, H)).toBe("#7b8494");
  });

  it("does not let a sponsor sticker colour a white car", () => {
    const sticker = (x, y) => (x < 16 && y < 20 ? [20, 60, 220] : [235, 235, 235]);
    expect(liveryColor(picture(sticker), W, H)).toBe("#d4d8de");
  });

  it("keeps a dark paint job readable", () => {
    const { r, g, b } = hue(liveryColor(picture(() => [20, 30, 110]), W, H));
    expect(Math.max(r, g, b)).toBeGreaterThan(190);
  });
});

describe("boardSkins", () => {
  it("lists each skin once and leaves the pace car and blanks out", () => {
    const board = {
      entries: [
        { carModel: "rss_hyperion_2020", carSkin: "SHR-14_Rush" },
        { carModel: "rss_hyperion_2020", carSkin: "SHR-14_Rush" },
        { carModel: "rss_hyperion_2020", carSkin: "pace", isSafetyCar: true },
        { carModel: "", carSkin: "" },
      ],
    };
    expect(boardSkins(board)).toEqual([{ car: "rss_hyperion_2020", skin: "SHR-14_Rush" }]);
  });

  it("copes with no board", () => {
    expect(boardSkins(null)).toEqual([]);
  });
});
