import { describe, it, expect } from "vitest";
import { gridSizeFor, setGridSize, parseGridSize, DEFAULT_GRID_SIZE } from "./gridSize.js";

// A Setting table small enough to hold in a variable: the lib only ever reads
// and upserts one row.
function fakePrisma(initial = null) {
  let row = initial === null ? null : { key: "attendance_grid_size", value: JSON.stringify(initial) };
  return {
    setting: {
      findUnique: async () => row,
      upsert: async ({ create, update }) => {
        row = row ? { ...row, ...update } : create;
        return row;
      },
    },
    get stored() {
      return row?.value ? JSON.parse(row.value) : null;
    },
  };
}

describe("parseGridSize", () => {
  it("takes a whole number in range", () => {
    expect(parseGridSize(50)).toEqual({ value: 50 });
    expect(parseGridSize("42")).toEqual({ value: 42 });
  });

  it("turns down a typo, a fraction and a negative", () => {
    expect(parseGridSize(400).error).toBeTruthy();
    expect(parseGridSize(0).error).toBeTruthy();
    expect(parseGridSize(40.5).error).toBeTruthy();
    expect(parseGridSize("lots").error).toBeTruthy();
  });
});

describe("gridSizeFor", () => {
  it("is 40 for a league nobody has touched", async () => {
    expect(await gridSizeFor(fakePrisma(), "friday-f1")).toBe(DEFAULT_GRID_SIZE);
  });

  it("reads back what was set", async () => {
    const p = fakePrisma();
    await setGridSize(p, "friday-f1", 50);
    expect(await gridSizeFor(p, "friday-f1")).toBe(50);
  });

  it("is per series: setting one leaves the other on the default", async () => {
    const p = fakePrisma();
    await setGridSize(p, "friday-f1", 50);
    expect(await gridSizeFor(p, "gt-sunday")).toBe(DEFAULT_GRID_SIZE);
    expect(p.stored).toEqual({ "friday-f1": 50 });
  });

  it("ignores a stored value that is out of range or junk", async () => {
    expect(await gridSizeFor(fakePrisma({ "friday-f1": 9999 }), "friday-f1")).toBe(DEFAULT_GRID_SIZE);
    expect(await gridSizeFor(fakePrisma({ "friday-f1": "big" }), "friday-f1")).toBe(DEFAULT_GRID_SIZE);
  });
});
