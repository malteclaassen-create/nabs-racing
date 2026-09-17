import { describe, it, expect } from "vitest";
import { hasRaced, isIdleReserve, classificationsOf, finishesOf, startsOf, roundsOf } from "./standingsRow.js";

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

// A sprint weekend is one round with two races. Wins, podiums and top-N
// counters read BOTH — a sprint win is a win — while starts and averages stay
// per round. These two helpers are where that rule lives site-wide.
describe("classificationsOf / finishesOf", () => {
  const round = (position, status = "FINISHED") => ({ points: 0, status, position, grid: null });
  const weekend = (feature, sprint) => ({ ...round(...[].concat(feature)), sprint: sprint ? { points: 0, ...sprint } : undefined });

  it("gives a plain round one classification and a sprint weekend two", () => {
    expect(classificationsOf([round(4)])).toEqual([{ status: "FINISHED", position: 4, sprint: false }]);
    expect(classificationsOf([weekend(2, { status: "FINISHED", position: 1 })])).toEqual([
      { status: "FINISHED", position: 2, sprint: false },
      { status: "FINISHED", position: 1, sprint: true },
    ]);
  });

  it("counts a sprint win even when the feature race ended in a DNF", () => {
    const cells = [weekend([null, "DNF"], { status: "FINISHED", position: 1 })];
    expect(finishesOf(cells).map((f) => f.position)).toEqual([1]);
  });

  it("leaves out everything that is not a classified finish", () => {
    const cells = [round(null, "DNS"), round(null, "DNF"), weekend(1, { status: "DNF", position: null })];
    expect(finishesOf(cells).map((f) => f.position)).toEqual([1]);
  });

  it("reads a standings row's rounds, empty row and all", () => {
    expect(roundsOf({ perRace: { 1: round(1), 2: round(2) } })).toHaveLength(2);
    expect(finishesOf(roundsOf({}))).toEqual([]);
    expect(finishesOf(roundsOf(null))).toEqual([]);
  });
});

// A start is a race started, not a race night attended. This is the counter
// that used to disagree with the wins beside it.
describe("startsOf", () => {
  const round = (position, status = "FINISHED") => ({ points: 0, status, position, grid: null });
  const weekend = (feature, sprint) => ({ ...round(...[].concat(feature)), sprint: sprint ? { points: 0, ...sprint } : undefined });

  it("counts a sprint weekend as two starts and a plain round as one", () => {
    expect(startsOf([round(4)])).toHaveLength(1);
    expect(startsOf([weekend(2, { status: "FINISHED", position: 1 })])).toHaveLength(2);
  });

  it("counts the driver who made ONLY the sprint", () => {
    // The round cell carries the feature race's status, and theirs is empty —
    // which used to leave them with no start at all for a race they drove.
    const cells = [{ points: 30, status: null, position: null, grid: null, sprint: { points: 30, status: "FINISHED", position: 2 } }];
    expect(startsOf(cells)).toHaveLength(1);
  });

  it("counts a retirement, because they started it", () => {
    expect(startsOf([round(null, "DNF"), round(null, "DSQ")])).toHaveLength(2);
  });

  it("does not count a DNS on either half", () => {
    expect(startsOf([round(null, "DNS")])).toEqual([]);
    expect(startsOf([weekend([null, "DNS"], { status: "DNS", position: null })])).toEqual([]);
  });

  it("never reports fewer starts than finishes", () => {
    const cells = [weekend(1, { status: "FINISHED", position: 1 }), round(null, "DNF")];
    expect(startsOf(cells).length).toBeGreaterThanOrEqual(finishesOf(cells).length);
    expect(classificationsOf(cells)).toHaveLength(3);
  });
});
