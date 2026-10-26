import { describe, it, expect } from "vitest";
import {
  seasonPointsBeforeDrop,
  raceWinnerSequence,
  longestStreak,
  constructorPointsBeforeDrop,
  addSeasonToTeamCareers,
} from "./recordsService.js";

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

// The team side of the Hall of Fame's top list.
describe("constructorPointsBeforeDrop", () => {
  it("adds every dropped round back onto the table's total", () => {
    expect(constructorPointsBeforeDrop({ total: 120, droppedPerRace: { 3: 8, 7: 4 } })).toBe(132);
  });

  it("leaves a table without drops alone", () => {
    expect(constructorPointsBeforeDrop({ total: 90, droppedPerRace: {} })).toBe(90);
    expect(constructorPointsBeforeDrop({ total: 90 })).toBe(90);
  });
});

describe("addSeasonToTeamCareers", () => {
  const fin = (position) => ({ status: "FINISHED", position });
  const run = (rows, stamps = new Map(), constructors = new Set(["ferrari", "mclaren"])) => {
    const buckets = new Map();
    addSeasonToTeamCareers({
      rows,
      teamOf: (d, n, sprint) => stamps.get(`${d}|${n}|${sprint ? 1 : 0}`) ?? null,
      keyOf: (id) => (constructors.has(id) ? id : null),
      bucketFor: (key) => {
        if (!buckets.has(key)) buckets.set(key, { wins: 0, podiums: 0, starts: 0 });
        return buckets.get(key);
      },
    });
    return Object.fromEntries(buckets);
  };

  it("counts every classification for the driver's season team", () => {
    const rows = [
      { driverId: "duck", team: { id: "ferrari" }, perRace: { 1: fin(1), 2: { ...fin(4), sprint: fin(2) }, 3: { status: "DNF", position: null } } },
      { driverId: "goose", team: { id: "ferrari" }, perRace: { 1: fin(3), 2: { status: "DNS", position: null } } },
    ];
    expect(run(rows)).toEqual({ ferrari: { wins: 1, podiums: 3, starts: 5 } });
  });

  it("credits a reserve's drive to the team it was stamped for, and nobody when it was for the reserve pool", () => {
    const rows = [
      { driverId: "swan", team: { id: "reserve" }, perRace: { 1: fin(1), 2: fin(2) } },
      { driverId: "heron", team: { id: "ferrari" }, perRace: { 1: fin(2), 2: { ...fin(5), sprint: fin(1) } } },
    ];
    const stamps = new Map([
      ["swan|1|0", "mclaren"],
      // Moved mid-weekend: the sprint was still for McLaren.
      ["heron|2|1", "mclaren"],
    ]);
    expect(run(rows, stamps)).toEqual({
      mclaren: { wins: 2, podiums: 2, starts: 2 },
      ferrari: { wins: 0, podiums: 1, starts: 2 },
    });
  });
});
