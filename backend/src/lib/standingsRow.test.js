import { describe, it, expect } from "vitest";
import { hasRaced, isIdleReserve } from "./standingsRow.js";

// The rule that decides whether a driver gets a championship position at all.
// It is pure (one standings row in, a verdict out), so the cases worth pinning
// down are the ones that used to hand a P-number to somebody who never drove.

const row = (over = {}) => ({ tier: 1, total: 0, perRace: {}, ...over });

describe("hasRaced", () => {
  it("counts a start that scored nothing", () => {
    expect(hasRaced(row({ perRace: { 3: { points: 0, status: "DNF", position: null } } }))).toBe(true);
  });

  it("counts points with no per-race rows — a totals-only archived season", () => {
    expect(hasRaced(row({ total: 42 }))).toBe(true);
  });

  it("an empty row is nobody's season", () => {
    expect(hasRaced(row())).toBe(false);
    expect(hasRaced(null)).toBe(false);
  });
});

describe("isIdleReserve", () => {
  it("is the reserve who signed up and never got in a car", () => {
    expect(isIdleReserve(row({ tier: 0 }))).toBe(true);
  });

  it("lets go of a reserve the moment they start a round, points or not", () => {
    expect(isIdleReserve(row({ tier: 0, perRace: { 5: { points: 0, status: "DNF" } } }))).toBe(false);
  });

  it("never touches a seat holder, however empty the row", () => {
    // A Tier 1 or Tier 2 driver is in the championship whether they have
    // driven or not — the standings list them, so their position is real.
    expect(isIdleReserve(row({ tier: 1 }))).toBe(false);
    expect(isIdleReserve(row({ tier: 2 }))).toBe(false);
  });
});
