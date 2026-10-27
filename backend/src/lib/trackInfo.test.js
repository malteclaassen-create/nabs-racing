import { describe, it, expect } from "vitest";
import { sanitizeTrackInfo, mapImageFor, mapImageSizeFor, imageKeyOf, imageSizeOf, shrinkTrackOutline, TRACK_OUTLINE_MAX } from "./trackInfo.js";

// The track map comes in two layers: the shared image every series shows, and
// one per series for a league that wants its own picture of the circuit.
describe("per-series track map images", () => {
  it("keeps one image per series slug beside the shared one, and drops what is not a series", () => {
    const out = sanitizeTrackInfo({
      mapImageUrl: " /api/uploads/tracks/baku.png ",
      mapImages: {
        "sunday-championship": "/api/uploads/tracks/baku--sunday-championship.png",
        "Bad Slug!": "/x.png",
        "friday-f1": "",
        "": "/y.png",
        nope: 42,
      },
    });
    expect(out.mapImageUrl).toBe("/api/uploads/tracks/baku.png");
    expect(out.mapImages).toEqual({ "sunday-championship": "/api/uploads/tracks/baku--sunday-championship.png" });
  });

  it("an unsaved track has no images at all", () => {
    expect(sanitizeTrackInfo(null)).toEqual({ facts: [], mapImageUrl: null, mapImages: {}, mapImageSizes: {}, mapRotation: 0, outlineUrl: null, outlineLine: null, outlineSize: null, videos: [], types: null, corners: null });
  });

  it("a series sees its own image first, then the shared one, then nothing", () => {
    const info = { mapImageUrl: "/shared.png", mapImages: { "sunday-championship": "/sunday.png" } };
    expect(mapImageFor(info, "sunday-championship")).toBe("/sunday.png");
    expect(mapImageFor(info, "friday-f1")).toBe("/shared.png");
    expect(mapImageFor(info, null)).toBe("/shared.png");
    expect(mapImageFor({ mapImages: { "friday-f1": "/f.png" } }, "sunday-championship")).toBeNull();
    expect(mapImageFor(null, "friday-f1")).toBeNull();
  });
});

// The pixel size of each picture, kept so the page can hold its height open
// before it has loaded — keyed by path, so a re-upload (new ?v=) replaces it.
describe("track map image sizes", () => {
  it("keeps whole positive sizes by path and drops the rest", () => {
    const out = sanitizeTrackInfo({
      mapImageSizes: {
        "/api/uploads/tracks/baku.png?v=123": { w: 1600, h: 1000 },
        "/api/uploads/tracks/bad.png": { w: 0, h: 10 },
        "/api/uploads/tracks/worse.png": { w: "x", h: 10 },
        "": { w: 1, h: 1 },
      },
    });
    expect(out.mapImageSizes).toEqual({ "/api/uploads/tracks/baku.png": { w: 1600, h: 1000 } });
    expect(imageKeyOf("/api/uploads/tracks/baku.png?v=9")).toBe("/api/uploads/tracks/baku.png");
  });

  it("answers the size of the picture a URL names, whatever its cache tag", () => {
    const info = sanitizeTrackInfo({ mapImageSizes: { "/api/uploads/tracks/baku.png": { w: 1600, h: 1000 } } });
    expect(mapImageSizeFor(info, "/api/uploads/tracks/baku.png?v=42")).toEqual({ w: 1600, h: 1000 });
    expect(mapImageSizeFor(info, "/api/uploads/tracks/other.png")).toBeNull();
    expect(mapImageSizeFor(info, null)).toBeNull();
  });

  it("measures a PNG from its header and an SVG from its viewBox or width/height", () => {
    const png = Buffer.alloc(40);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(1200, 16);
    png.writeUInt32BE(800, 20);
    expect(imageSizeOf(png)).toEqual({ w: 1200, h: 800 });
    expect(imageSizeOf(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"></svg>'))).toEqual({ w: 640, h: 400 });
    expect(imageSizeOf(Buffer.from('<svg width="300px" height="150"></svg>'))).toEqual({ w: 300, h: 150 });
    expect(imageSizeOf(Buffer.from("<svg></svg>"))).toBeNull();
    expect(imageSizeOf(Buffer.from("not an image at all, just text"))).toBeNull();
  });
});

describe("the uploaded outline", () => {
  it("measures how thick its line is", async () => {
    const { createCanvas } = await import("@napi-rs/canvas");
    for (const width of [3, 8, 16]) {
      const c = createCanvas(900, 600);
      const g = c.getContext("2d");
      g.lineWidth = width;
      g.strokeRect(100, 100, 700, 400);
      const { line } = await shrinkTrackOutline(await c.encode("png"));
      expect(line).toBeGreaterThan(width * 0.75);
      expect(line).toBeLessThan(width * 1.35);
    }
  });

  it("keeps the measured line and size only together with the picture", () => {
    const info = sanitizeTrackInfo({ outlineUrl: "/x.webp", outlineLine: 2.345, outlineSize: { w: 400, h: 300 } });
    expect([info.outlineLine, info.outlineSize]).toEqual([2.35, { w: 400, h: 300 }]);
    expect(sanitizeTrackInfo({ outlineLine: 3, outlineSize: { w: 4, h: 3 } }).outlineLine).toBe(null);
    expect(sanitizeTrackInfo({ outlineUrl: "/x.webp", outlineLine: 3 }).outlineLine).toBe(null);
  });

  it("is kept apart from the map image, and reads the first version's name too", () => {
    const info = sanitizeTrackInfo({ mapImageUrl: "/api/uploads/tracks/spa.png", outlineUrl: " /api/uploads/tracks/spa__outline.webp?v=1 " });
    expect(info.mapImageUrl).toBe("/api/uploads/tracks/spa.png");
    expect(info.outlineUrl).toBe("/api/uploads/tracks/spa__outline.webp?v=1");
    expect(sanitizeTrackInfo({ photoUrl: "/api/uploads/tracks/adelaide__photo.webp" }).outlineUrl).toBe(
      "/api/uploads/tracks/adelaide__photo.webp"
    );
    expect(sanitizeTrackInfo({}).outlineUrl).toBe(null);
  });

  it("is shrunk to a small WebP on upload and says whether its background is see-through", async () => {
    const { createCanvas } = await import("@napi-rs/canvas");
    const drawing = createCanvas(3000, 2000);
    const g = drawing.getContext("2d");
    g.lineWidth = 20;
    g.strokeRect(300, 300, 2400, 1400);
    const out = await shrinkTrackOutline(await drawing.encode("png"));
    // Shrunk to 960 x 640, then cropped to the drawing (a 768 x 448 frame at
    // that size) with a margin of 3% of its longest side plus two pixels.
    expect(out.width).toBeLessThan(TRACK_OUTLINE_MAX);
    expect([out.width, out.height]).toEqual([768 + 2 * 28 + 6, 448 + 2 * 28 + 6].map((n) => expect.closeTo(n, -1)));
    expect(out.buffer.subarray(8, 12).toString()).toBe("WEBP");
    expect(out.transparent).toBe(true);

    const photo = createCanvas(800, 600);
    photo.getContext("2d").fillRect(0, 0, 800, 600);
    expect((await shrinkTrackOutline(await photo.encode("jpeg"))).transparent).toBe(false);
    await expect(shrinkTrackOutline(Buffer.from("not a picture"))).rejects.toThrow();
  });
});
