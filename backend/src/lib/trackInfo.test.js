import { describe, it, expect } from "vitest";
import { sanitizeTrackInfo, mapImageFor } from "./trackInfo.js";

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
    expect(sanitizeTrackInfo(null)).toEqual({ facts: [], mapImageUrl: null, mapImages: {}, mapRotation: 0, videos: [] });
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
