import { describe, it, expect } from "vitest";
import { parseProgress, progressLabel, PROGRESS_KEYS, PROGRESS_STATES } from "./driverProgress.js";

// What reaches the column is the whole risk here: a typo stored once is a pill
// with no name on it for the rest of the season.

describe("parseProgress", () => {
  it("accepts every label the page offers", () => {
    for (const key of PROGRESS_KEYS) expect(parseProgress(key)).toEqual({ ok: true, value: key });
  });

  it("treats blank, null and undefined as clearing it", () => {
    for (const blank of ["", null, undefined]) expect(parseProgress(blank)).toEqual({ ok: true, value: null });
  });

  it("is forgiving about case and stray spaces", () => {
    expect(parseProgress(" full_time ")).toEqual({ ok: true, value: "FULL_TIME" });
  });

  it("refuses a label nobody defined, and says which ones exist", () => {
    const res = parseProgress("PROMOTED");
    expect(res.ok).toBeUndefined();
    expect(res.error).toContain("FULL_TIME");
  });

  it("refuses the DISPLAY text — the key is what gets stored", () => {
    // "Full time" is what the dropdown shows; sending it back would store a
    // string no reader knows.
    expect(parseProgress("Full time").error).toBeTruthy();
  });
});

describe("PROGRESS_STATES", () => {
  it("names every key exactly once", () => {
    expect(new Set(PROGRESS_KEYS).size).toBe(PROGRESS_STATES.length);
  });

  it("gives a label for each key and nothing for an unknown one", () => {
    for (const key of PROGRESS_KEYS) expect(progressLabel(key)).toBeTruthy();
    expect(progressLabel("NOPE")).toBe(null);
    expect(progressLabel(null)).toBe(null);
  });
});
