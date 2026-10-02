import { describe, it, expect } from "vitest";
import { atLeagueClock } from "./tokens.js";

describe("the league's clock time on a day", () => {
  it("is 19:30 German time in summer and in winter", () => {
    expect(new Date(atLeagueClock(Date.parse("2026-09-25T00:00:00Z"), "19:30")).toISOString()).toBe(
      "2026-09-25T17:30:00.000Z"
    );
    expect(new Date(atLeagueClock(Date.parse("2026-10-30T00:00:00Z"), "19:30")).toISOString()).toBe(
      "2026-10-30T18:30:00.000Z"
    );
  });

  it("is 19:00 for a Sunday round", () => {
    expect(new Date(atLeagueClock(Date.parse("2026-09-27T00:00:00Z"), "19:00")).toISOString()).toBe(
      "2026-09-27T17:00:00.000Z"
    );
  });
});
