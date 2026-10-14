import { describe, expect, it } from "vitest";
import {
  bestResult,
  biggestClimb,
  classificationsOfPerRace,
  driverType,
  headToHead,
  honoursFor,
  journeyTables,
  pickRival,
  winsOf,
} from "./seasonWrappedService.js";

// A profile's race-by-race rows (driverProfileService perRace).
const perRace = [
  { raceId: "r1", number: 1, track: "Spa", status: "FINISHED", position: 4, grid: 11, points: 22 },
  { raceId: "r2", number: 2, track: "Monza", status: "DNF", position: null, grid: 3, points: 0 },
  {
    raceId: "r3",
    number: 3,
    track: "Imola",
    status: "FINISHED",
    position: 2,
    grid: 2,
    // The weekend's points: 30 for the feature, 35 for the sprint win.
    points: 65,
    sprint: { raceId: "r3s", status: "FINISHED", position: 1, grid: 10, points: 35 },
  },
  { raceId: "r4", number: 4, track: "Suzuka", status: "FINISHED", position: 2, grid: 1, points: 30 },
];

describe("the season's highlights", () => {
  it("splits a sprint weekend into its two races with their own points", () => {
    const c = classificationsOfPerRace(perRace);
    expect(c).toHaveLength(5);
    expect(c.find((x) => x.raceId === "r3")).toMatchObject({ sprint: false, position: 2, points: 30 });
    expect(c.find((x) => x.raceId === "r3s")).toMatchObject({ sprint: true, position: 1, points: 35, round: 3 });
  });

  it("finds the best night, and calls a sprint win a win", () => {
    expect(bestResult(perRace)).toMatchObject({ raceId: "r3s", position: 1, sprint: true, track: "Imola" });
    expect(winsOf(perRace)).toEqual([{ round: 3, track: "Imola", sprint: true, raceId: "r3s" }]);
    // Equal places: more points first, then the earlier round.
    const twoSeconds = perRace.filter((r) => r.number !== 3).concat({ raceId: "r5", number: 5, track: "Baku", status: "FINISHED", position: 4, grid: 4, points: 22 });
    expect(bestResult(twoSeconds)).toMatchObject({ raceId: "r4", position: 2 });
    expect(bestResult([{ raceId: "x", number: 1, track: "Spa", status: "DNF", position: null }])).toBeNull();
  });

  it("counts the biggest climb on feature races only", () => {
    // 11th to 4th at Spa beats the 10th-to-1st sprint, which does not count.
    expect(biggestClimb(perRace)).toMatchObject({ raceId: "r1", grid: 11, position: 4, gained: 7 });
    expect(biggestClimb(perRace, 8)).toBeNull();
  });
});

// Standings rows (getDriverStandings), perRace keyed by round number.
const cell = (position, grid, extra = {}) => ({ status: position == null ? "DNF" : "FINISHED", position, grid, ...extra });
const me = {
  driverId: "me",
  total: 90,
  perRace: {
    1: cell(4, 6),
    2: cell(null, 3),
    3: cell(2, 2, { sprint: cell(1, 10) }),
    4: cell(5, 1),
  },
};
const mate = {
  driverId: "mate",
  total: 70,
  perRace: {
    1: cell(7, 5),
    2: cell(3, 4),
    3: cell(6, 8, { sprint: cell(4, 6) }),
    // Round 4 not driven.
  },
};

describe("side by side", () => {
  it("compares only the races both of them finished", () => {
    expect(headToHead(me, mate)).toEqual({ races: 3, ahead: 3, behind: 0, qualiAhead: 2, qualiBehind: 1 });
    expect(headToHead(mate, me)).toEqual({ races: 3, ahead: 0, behind: 3, qualiAhead: 1, qualiBehind: 2 });
  });

  it("picks the driver just ahead as the rival, and the runner-up for the champion", () => {
    const rows = [{ driverId: "p1" }, { driverId: "p2" }, { driverId: "p3" }];
    expect(pickRival(rows, "p3").driverId).toBe("p2");
    expect(pickRival(rows, "p1").driverId).toBe("p2");
    expect(pickRival(rows, "nobody")).toBeNull();
    expect(pickRival([{ driverId: "p1" }], "p1")).toBeNull();
  });
});

describe("what kind of driver", () => {
  const base = { starts: 10, finishes: 9, wins: 0, podiums: 0, top10: 4, polePositions: 0, positionsGained: 4, dnf: 1 };

  it("goes through the rules in order and always says why", () => {
    expect(driverType({ stats: { ...base, wins: 2 }, champion: true, complete: true })).toMatchObject({ key: "champion" });
    // A champion of a season still running is not The Champion yet.
    expect(driverType({ stats: { ...base, wins: 3 }, champion: true, complete: false })).toMatchObject({ key: "winner", line: "3 wins from 10 starts." });
    expect(driverType({ stats: { ...base, polePositions: 2 } })).toMatchObject({ key: "qualifier" });
    expect(driverType({ stats: { ...base, podiums: 4 } })).toMatchObject({ key: "podium" });
    expect(driverType({ stats: { ...base, positionsGained: 30 } })).toMatchObject({ key: "charger", line: "30 places made up from the grid." });
    expect(driverType({ stats: { ...base, finishes: 10, dnf: 0 } })).toMatchObject({ key: "finisher" });
    expect(driverType({ stats: { ...base, top10: 8 } })).toMatchObject({ key: "regular" });
    expect(driverType({ stats: { ...base, starts: 6, finishes: 5 }, roundsRun: 6 })).toMatchObject({ key: "ever-present" });
    expect(driverType({ stats: base, roundsRun: 12 })).toMatchObject({ key: "racer" });
    expect(driverType({ stats: { starts: 0 } })).toBeNull();
  });
});

describe("the honours that were theirs", () => {
  const honours = {
    seasonName: "Season 8",
    teamChampions: [{ tier: 1, teamId: "ferrari", name: "Ferrari" }],
    bestNewcomer: { driverId: "rookie" },
    fastestLap: { driverId: "me", ms: 81234, track: "Spa" },
    mostOvertakes: { driverId: "other", count: 40 },
    mostLapsLed: null,
    cleanest: { driverId: "me", contacts: 2, starts: 12 },
  };

  it("lists the season's awards they won, once the season is over", () => {
    const got = honoursFor(honours, { driverId: "me", teamId: "ferrari", position: 2, complete: true, dotd: 2 });
    expect(got.map((h) => h.key)).toEqual(["vice", "team", "fastest-lap", "cleanest", "dotd"]);
    expect(got.find((h) => h.key === "dotd").title).toBe("Driver of the Day ×2");
  });

  it("awards nothing before the finale except the Driver of the Day picks", () => {
    expect(honoursFor(honours, { driverId: "me", position: 1, complete: false, dotd: 1 }).map((h) => h.key)).toEqual(["dotd"]);
    expect(honoursFor(null, { driverId: "me", complete: true })).toEqual([]);
  });
});

describe("the championship round by round", () => {
  // Four rounds on the calendar, three run, one result dropped at the end.
  const rows = [
    { driverId: "a", name: "A", total: 0, perRace: { 1: { points: 35, status: "FINISHED", position: 1 }, 2: { points: 0, status: "DNF", position: null }, 3: { points: 30, status: "FINISHED", position: 2 } } },
    { driverId: "b", name: "B", total: 0, perRace: { 1: { points: 30, status: "FINISHED", position: 2 }, 2: { points: 35, status: "FINISHED", position: 1 }, 3: { points: 35, status: "FINISHED", position: 1 } } },
    // Joins in round 2.
    { driverId: "c", name: "C", total: 0, perRace: { 2: { points: 30, status: "FINISHED", position: 2 } } },
  ];

  it("keeps real results while empty rounds are left to drop, the way the table looked then", () => {
    const t = journeyTables({ rows, raceNumbers: [1, 2, 3, 4], dropWorst: 1 }, [1, 2, 3]);
    // After round 1: rounds 2-4 are empty and soak up the drop.
    expect(t.get("a")[0]).toEqual({ round: 1, position: 1, points: 35 });
    expect(t.get("b")[0]).toEqual({ round: 1, position: 2, points: 30 });
    // C had not raced yet: no place after round 1.
    expect(t.get("c").map((j) => j.round)).toEqual([2, 3]);
    // After round 3 only round 4 is empty, so the zero it drops is that one.
    expect(t.get("a")[2]).toEqual({ round: 3, position: 2, points: 65 });
    expect(t.get("b")[2]).toEqual({ round: 3, position: 1, points: 100 });
  });

  it("ends a finished season on the final table itself", () => {
    const final = [{ driverId: "a", total: 99 }, { driverId: "b", total: 98 }];
    const t = journeyTables({ rows, raceNumbers: [1, 2, 3], dropWorst: 1 }, [1, 2, 3], final);
    expect(t.get("a")[2]).toEqual({ round: 3, position: 1, points: 99 });
    expect(t.get("b")[2]).toEqual({ round: 3, position: 2, points: 98 });
  });

  it("splits a tie on points by countback", () => {
    const tied = [
      { driverId: "x", name: "X", perRace: { 1: { points: 30, status: "FINISHED", position: 2 } } },
      { driverId: "y", name: "Y", perRace: { 1: { points: 30, status: "FINISHED", position: 1 } } },
    ];
    const t = journeyTables({ rows: tied, raceNumbers: [1, 2], dropWorst: 0 }, [1]);
    expect(t.get("y")[0].position).toBe(1);
    expect(t.get("x")[0].position).toBe(2);
  });
});
