import { describe, expect, it } from "vitest";
import { aggregateNumbers, winningGap } from "./leagueNumbersService.js";

// A small season by hand: two rounds, the second a sprint weekend.
const races = [
  { id: "r1", roundId: "r1", season: 8, round: 1, track: "Spa", sprint: false },
  { id: "r2", roundId: "r2", season: 8, round: 2, track: "Monza", sprint: false },
  { id: "r2s", roundId: "r2", season: 8, round: 2, track: "Monza", sprint: true },
  // Entered on the calendar, never filled in: no race as far as numbers go.
  { id: "r3", roundId: "r3", season: 8, round: 3, track: "Imola", sprint: false },
];

const row = (raceId, driverId, position, extra = {}) => ({
  raceId,
  driverId,
  position,
  status: "FINISHED",
  grid: null,
  laps: null,
  overtakes: null,
  contacts: null,
  gamePenalties: null,
  penaltySeconds: 0,
  totalTimeMs: null,
  teamId: null,
  ...extra,
});

const results = [
  // Spa: A wins by 0.4 s on the road, but a 5 s penalty drops A behind B.
  row("r1", "a", 1, { totalTimeMs: 3_600_000, penaltySeconds: 5, laps: 20, grid: 2, overtakes: 3, teamId: "t1" }),
  row("r1", "b", 2, { totalTimeMs: 3_600_400, laps: 20, grid: 9, overtakes: 6, teamId: "t2" }),
  row("r1", "c", 3, { totalTimeMs: 3_640_000, laps: 20, grid: 1, overtakes: 0, teamId: "t1" }),
  row("r1", "d", null, { status: "DNF", laps: 4, grid: 3 }),
  row("r1", "e", null, { status: "DNS" }),
  // Monza feature: C wins by 12 s from the back of the grid.
  row("r2", "c", 1, { totalTimeMs: 3_500_000, laps: 22, grid: 14, teamId: "t1" }),
  row("r2", "b-old", 2, { totalTimeMs: 3_512_000, laps: 22, grid: 4, teamId: "t2" }),
  row("r2", "a", 3, { totalTimeMs: 3_530_000, laps: 21, grid: 1, teamId: "t1" }),
  // Monza sprint: no times on file (typed in by hand).
  row("r2s", "a", 1, { grid: 12, teamId: "t1" }),
  row("r2s", "c", 2, { grid: 1 }),
  row("r2s", "d", 3, { grid: 2 }),
];

// b and b-old are the same person on two rows.
const people = {
  keyOf: (id) => (id === "b-old" ? "b" : id),
  who: (key) => ({ name: key.toUpperCase(), driverId: key, country: null, photoUrl: null }),
};

const teams = new Map([
  ["t1", { name: "Ferrari", color: "#f00" }],
  ["t2", { name: "Williams", color: "#00f" }],
]);

const out = aggregateNumbers({ races, results, people, poles: new Map([["r1", "c"], ["r2", "a"]]), teams });

describe("league numbers", () => {
  it("counts races, rounds and starts the way the standings do", () => {
    expect(out.totals.rounds).toBe(2);
    expect(out.totals.races).toBe(3); // the empty round 3 is not a race
    expect(out.totals.sprints).toBe(1);
    // DNS is not a start; a DNF is.
    expect(out.totals.starts).toBe(10);
    expect(out.totals.finishes).toBe(9);
    expect(out.totals.dnfs).toBe(1);
    // One person on two rows counts once.
    expect(out.totals.drivers).toBe(4);
  });

  it("takes the winner from the classification, penalties applied", () => {
    // Spa went to B after A's penalty; Monza to C; the sprint to A.
    expect(out.winners.count).toBe(3);
    expect(out.winners.list.map((w) => [w.key, w.wins])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ]);
    expect(out.winsByTeam.map((t) => [t.name, t.wins])).toEqual([
      ["Ferrari", 2],
      ["Williams", 1],
    ]);
  });

  it("says how many races a total was taken from", () => {
    expect(out.totals.laps).toEqual({ value: 20 + 20 + 20 + 4 + 22 + 22 + 21, races: 2 });
    expect(out.totals.overtakes).toEqual({ value: 9, races: 1 });
    expect(out.totals.contacts).toEqual({ value: null, races: 0 });
  });

  it("finds the closest finish and the biggest margin on penalised times", () => {
    // Spa after the penalty: B wins, A is 4.6 s back.
    expect(out.closestFinish).toMatchObject({ gapMs: 4600, race: { track: "Spa" } });
    expect(out.closestFinish.winner.key).toBe("b");
    expect(out.biggestMargin).toMatchObject({ gapMs: 12_000, race: { track: "Monza", sprint: false } });
  });

  it("measures the climb on feature races only", () => {
    // C from 14th to the win at Monza; A's 12th-to-1st sprint does not count.
    expect(out.biggestComeback).toMatchObject({ gained: 13, grid: 14, position: 1, race: { track: "Monza" } });
  });

  it("knows the field, the poles and the busiest race", () => {
    expect(out.field.biggest).toMatchObject({ value: 4, race: { track: "Spa" } });
    expect(out.field.smallest).toMatchObject({ value: 3 });
    expect(out.polesitters).toEqual({ count: 2, rounds: 2 });
    expect(out.podiumFinishers).toBe(4);
    expect(out.busiestRace).toMatchObject({ overtakes: 9, race: { track: "Spa" } });
    expect(out.tracks).toEqual({ count: 2, mostRaced: { track: "Monza", rounds: 1 } });
  });

  it("folds a sprint weekend into one round per chart bar", () => {
    expect(out.perRound).toEqual([
      { season: 8, round: 1, track: "Spa", starters: 4, overtakes: 9, dnfs: 1 },
      { season: 8, round: 2, track: "Monza", starters: 3, overtakes: null, dnfs: 0 },
    ]);
  });
});

describe("the winning gap", () => {
  it("needs both cars on the lead lap with a time", () => {
    expect(winningGap([row("x", "a", 1, { totalTimeMs: 100, laps: 10 }), row("x", "b", 2, { totalTimeMs: 50, laps: 9 })])).toBeNull();
    expect(winningGap([row("x", "a", 1, { totalTimeMs: 100 }), row("x", "b", 2)])).toBeNull();
    expect(winningGap([row("x", "a", 1, { totalTimeMs: 100 })])).toBeNull();
    expect(winningGap([row("x", "a", 1, { totalTimeMs: 100 }), row("x", "b", 2, { totalTimeMs: 350 })]).gapMs).toBe(250);
  });
});
