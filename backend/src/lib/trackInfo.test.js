import { describe, it, expect } from "vitest";
import { sanitizeTrackInfo, mapImageFor, mapImageSizeFor, imageKeyOf, imageSizeOf } from "./trackInfo.js";

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
    expect(sanitizeTrackInfo(null)).toEqual({ facts: [], mapImageUrl: null, mapImages: {}, mapImageSizes: {}, mapRotation: 0, videos: [], types: null, corners: [] });
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
