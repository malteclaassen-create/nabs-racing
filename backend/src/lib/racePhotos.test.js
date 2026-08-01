import { describe, it, expect } from "vitest";
import { sanitizeRacePhotos, withUrls, MAX_PHOTOS } from "./racePhotos.js";

const photo = (file, extra = {}) => ({ id: file.split(".")[0], file, caption: "", ...extra });

describe("sanitizeRacePhotos — what may end up in a gallery", () => {
  it("keeps a normal row and its order", () => {
    const out = sanitizeRacePhotos([photo("r1-a.jpg"), photo("r1-b.png")]);
    expect(out.map((p) => p.file)).toEqual(["r1-a.jpg", "r1-b.png"]);
  });

  it("accepts both the array and the { photos } shape", () => {
    expect(sanitizeRacePhotos({ photos: [photo("r1-a.jpg")] })).toHaveLength(1);
    expect(sanitizeRacePhotos(null)).toEqual([]);
    expect(sanitizeRacePhotos({})).toEqual([]);
  });

  // The stored blob is the only thing standing between a hand-edited Setting
  // row and the file the gallery links to, so the read path validates too.
  it("drops anything that could climb out of the uploads folder", () => {
    const out = sanitizeRacePhotos([
      photo("../../prisma/dev.db"),
      photo("..\\dev.db"),
      photo("/etc/passwd"),
      photo("ok.jpg"),
    ]);
    expect(out.map((p) => p.file)).toEqual(["ok.jpg"]);
  });

  it("only allows image extensions a browser renders inline", () => {
    const out = sanitizeRacePhotos([
      photo("a.svg"), // can carry script — not in a photo gallery
      photo("b.html"),
      photo("c"), // no extension at all
      photo("d.JPG"), // case doesn't matter
      photo("e.webp"),
      photo("f.gif"),
    ]);
    expect(out.map((p) => p.file)).toEqual(["d.JPG", "e.webp", "f.gif"]);
  });

  it("keeps one row per file", () => {
    const out = sanitizeRacePhotos([photo("same.jpg"), photo("same.jpg", { id: "other" })]);
    expect(out).toHaveLength(1);
  });

  it("trims captions to a sane length", () => {
    const [p] = sanitizeRacePhotos([photo("a.jpg", { caption: "  " + "x".repeat(400) + "  " })]);
    expect(p.caption.length).toBeLessThanOrEqual(140);
    expect(p.caption.startsWith("x")).toBe(true);
  });

  it("caps a gallery so one round can't fill the disk", () => {
    const many = Array.from({ length: MAX_PHOTOS + 15 }, (_, i) => photo(`p${i}.jpg`));
    expect(sanitizeRacePhotos(many)).toHaveLength(MAX_PHOTOS);
  });

  it("falls back to the file name when a row has no id", () => {
    const [p] = sanitizeRacePhotos([{ file: "a.jpg" }]);
    expect(p.id).toBe("a.jpg");
  });
});

describe("withUrls", () => {
  it("builds the served URL and hands out no file names", () => {
    const out = withUrls(sanitizeRacePhotos([photo("r1-a.jpg", { caption: "Podium" })]));
    expect(out).toEqual([{ id: "r1-a", url: "/api/uploads/races/r1-a.jpg", caption: "Podium" }]);
  });
});
