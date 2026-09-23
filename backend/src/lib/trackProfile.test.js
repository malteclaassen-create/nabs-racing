import { describe, it, expect } from "vitest";
import {
  sanitizeTypes, effectiveTypes, sanitizeCorners, effectiveCorners, layoutHasDefaults,
  DEFAULT_TYPES, DEFAULT_CORNERS, TRACK_TYPES, MAX_TYPES,
} from "./trackProfile.js";
import { trackKeyFor } from "./trackKeys.js";
import { sanitizeTrackInfo } from "./trackInfo.js";

describe("track types", () => {
  it("keeps known types once each, in the fixed order, at most three", () => {
    expect(sanitizeTypes(["street", "nope", "highspeed", "street", "power", "braking"])).toEqual(["highspeed", "braking", "power"]);
    expect(sanitizeTypes(["street", "nope", "highspeed", "street", "power", "braking"]).length).toBeLessThanOrEqual(MAX_TYPES);
  });

  it("tells 'never picked' (null) apart from 'picked none' (empty list)", () => {
    expect(sanitizeTypes(undefined)).toBeNull();
    expect(sanitizeTypes("street")).toBeNull();
    expect(sanitizeTypes([])).toEqual([]);
  });

  it("uses the admin's pick, else the circuit's default, else nothing", () => {
    expect(effectiveTypes({ types: ["street"] }, "Monza")).toEqual({ types: ["street"], source: "admin" });
    expect(effectiveTypes({ types: [] }, "Monza")).toEqual({ types: [], source: "admin" });
    expect(effectiveTypes({ types: null }, "Monza")).toEqual({ types: DEFAULT_TYPES.Monza, source: "default" });
    expect(effectiveTypes(null, "somewhere-unknown")).toEqual({ types: [], source: null });
  });

  it("every default is a list of known types", () => {
    const known = new Set(TRACK_TYPES.map((t) => t.key));
    for (const [key, types] of Object.entries(DEFAULT_TYPES)) {
      expect(types.length, key).toBeGreaterThan(0);
      expect(types.length, key).toBeLessThanOrEqual(MAX_TYPES);
      for (const t of types) expect(known.has(t), `${key}: ${t}`).toBe(true);
    }
  });
});

describe("corner names", () => {
  it("keeps corners with a position and a name or number, sorted round the lap", () => {
    expect(
      sanitizeCorners([
        { at: 31.46, turn: 4, name: "  Roggia " },
        { at: 11, turn: "1", name: "Rettifilo" },
        { at: 86, name: "Parabolica" },
        { at: 50, name: "" },
        { at: 120, name: "Off the lap" },
        { at: "x", name: "No position" },
      ])
    ).toEqual([
      { at: 11, turn: 1, name: "Rettifilo" },
      { at: 31.5, turn: 4, name: "Roggia" },
      { at: 86, turn: null, name: "Parabolica" },
    ]);
  });

  it("drops a second corner at the same spot and anything that is not a list", () => {
    expect(sanitizeCorners([{ at: 10, name: "A" }, { at: 10, name: "B" }])).toEqual([{ at: 10, turn: null, name: "A" }]);
    expect(sanitizeCorners(null)).toBeNull();
  });

  it("rides along in the track info blob", () => {
    const out = sanitizeTrackInfo({ types: ["power"], corners: [{ at: 5, turn: 1, name: "T1" }] });
    expect(out.types).toEqual(["power"]);
    expect(out.corners).toEqual([{ at: 5, turn: 1, name: "T1" }]);
  });
});

describe("default corner names", () => {
  it("every list is already clean: in lap order, inside the lap, one per spot", () => {
    for (const [key, list] of Object.entries(DEFAULT_CORNERS)) {
      expect(trackKeyFor(key), key).toBe(key);
      expect(sanitizeCorners(list), key).toEqual(list);
    }
  });

  it("uses the admin's list, else the default on the main layout, else none", () => {
    expect(effectiveCorners({ corners: [{ at: 5, turn: 1, name: "X" }] }, "Monza").source).toBe("admin");
    expect(effectiveCorners({ corners: [] }, "Monza")).toEqual({ corners: [], source: "admin" });
    expect(effectiveCorners({ corners: null }, "Monza")).toEqual({ corners: DEFAULT_CORNERS.Monza, source: "default" });
    expect(effectiveCorners(null, "Monza", "junior")).toEqual({ corners: [], source: null });
    expect(effectiveCorners(null, "Monaco")).toEqual({ corners: [], source: null });
  });

  it("only the Grand Prix layouts take the defaults", () => {
    for (const l of ["", "gp", "layout_gp", "layout_gp_a", "full", "f1_2023"]) expect(layoutHasDefaults(l), l).toBe(true);
    for (const l of ["national", "layout_national", "moto", "short", "junior", "international", "oval", "1966"]) expect(layoutHasDefaults(l), l).toBe(false);
  });
});
