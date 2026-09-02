import { describe, it, expect } from "vitest";
import { seasonPointsBeforeDrop } from "./recordsService.js";

// The all-time "Most points ever" list is the season totals with the drop rule
// undone again. These pin down what "undone" means for the shapes a standings
// row actually comes in.
describe("seasonPointsBeforeDrop", () => {
  const row = (perRace, droppedRounds, total) => ({ perRace, droppedRounds, total });

  it("adds the dropped rounds back onto the total", () => {
    expect(
      seasonPointsBeforeDrop(
        row({ 1: { points: 35 }, 2: { points: 10 }, 3: { points: 4 } }, [2, 3], 35)
      )
    ).toBe(49);
  });

  it("leaves a season without a drop rule alone", () => {
    expect(seasonPointsBeforeDrop(row({ 1: { points: 25 }, 2: { points: 18 } }, [], 43))).toBe(43);
  });

  it("adds nothing for a dropped round the driver did not race", () => {
    // Rounds nobody scored in are dropped first and have no perRace entry.
    expect(seasonPointsBeforeDrop(row({ 1: { points: 30 } }, [2, 3], 30))).toBe(30);
  });

  it("adds back a dropped zero-point finish as zero", () => {
    expect(
      seasonPointsBeforeDrop(row({ 1: { points: 30 }, 2: { points: 0 } }, [2], 30))
    ).toBe(30);
  });

  it("keeps the official total as the floor when the sheet and the grid disagree", () => {
    // Archived seasons take their total from the league's published sheet, so
    // the per-race cells need not add up to it. Starting from the total means
    // the gross figure still cannot come out below the official one.
    expect(
      seasonPointsBeforeDrop(row({ 1: { points: 10 }, 2: { points: 8 } }, [2], 214))
    ).toBe(222);
  });

  it("survives a row with no results at all", () => {
    expect(seasonPointsBeforeDrop({ total: 0 })).toBe(0);
    expect(seasonPointsBeforeDrop({})).toBe(0);
  });
});
