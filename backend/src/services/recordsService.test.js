import { describe, it, expect } from "vitest";
import { seasonPointsBeforeDrop, raceWinnerSequence, longestStreak } from "./recordsService.js";

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

// ---------------------------------------------------------------------------
// The longest win streak walks RACES, not race nights. On a league that runs a
// sprint every round, the old per-round walk could neither extend a streak
// with a sprint win nor break one with a sprint lost.
// ---------------------------------------------------------------------------
const race = (number) => ({ number, isCompleted: true });
const win = (position) => ({ status: "FINISHED", position });

describe("raceWinnerSequence", () => {
  it("puts the sprint before the feature race of the same round", () => {
    // Round 1: A wins the sprint, B the feature.
    const rows = [
      { driverId: "A", perRace: { 1: { ...win(2), sprint: win(1) } } },
      { driverId: "B", perRace: { 1: { ...win(1), sprint: win(2) } } },
    ];
    expect(raceWinnerSequence([race(1)], rows)).toEqual(["A", "B"]);
  });

  it("gives a plain round one place in the sequence", () => {
    const rows = [{ driverId: "A", perRace: { 1: win(1) } }];
    expect(raceWinnerSequence([race(1)], rows)).toEqual(["A"]);
  });

  it("reports a race nobody was classified first in as null", () => {
    const rows = [{ driverId: "A", perRace: { 1: { status: "DNF", position: null } } }];
    expect(raceWinnerSequence([race(1)], rows)).toEqual([null]);
  });

  it("skips a round flagged complete with nothing on record", () => {
    // A gap in the data is not a race somebody else won.
    expect(raceWinnerSequence([race(1), race(2)], [{ driverId: "A", perRace: { 2: win(1) } }])).toEqual(["A"]);
  });

  it("counts a weekend where only the sprint was driven", () => {
    const rows = [{ driverId: "A", perRace: { 1: { status: null, position: null, sprint: win(1) } } }];
    expect(raceWinnerSequence([race(1)], rows)).toEqual(["A"]);
  });
});

describe("longestStreak", () => {
  it("counts a sprint win between two feature wins", () => {
    // A wins R1 feature, R2 sprint, R2 feature: three in a row, not two.
    expect(longestStreak(["A", "A", "A"])).toEqual({ person: "A", length: 3 });
  });

  it("lets a sprint lost break the run", () => {
    expect(longestStreak(["A", "B", "A"])).toEqual({ person: "A", length: 1 });
  });

  it("breaks on a race with no winner on record", () => {
    expect(longestStreak(["A", null, "A"])).toEqual({ person: "A", length: 1 });
  });

  it("keeps the longest run, not the last", () => {
    expect(longestStreak(["A", "A", "A", "B", "B"])).toEqual({ person: "A", length: 3 });
  });

  it("is null when nobody ever won", () => {
    expect(longestStreak([null, null])).toBeNull();
    expect(longestStreak([])).toBeNull();
  });
});
