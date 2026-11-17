import { describe, it, expect } from "vitest";
import { bestResult, biggestClimb, headToHead, journeyTables, rankAmong, honoursFor, tableWindow, classificationsOfPerRace } from "./seasonReviewService.js";

const perRace = [
  { number: 1, track: "Melbourne", raceId: "r1", status: "DNS", position: null, grid: null, points: 0 },
  { number: 2, track: "Mugello", raceId: "r2", status: "FINISHED", position: 2, grid: 14, points: 34, sprint: { raceId: "s2", status: "FINISHED", position: 3, grid: 8, points: 4 } },
  { number: 3, track: "Most", raceId: "r3", status: "FINISHED", position: 2, grid: 2, points: 30 },
  { number: 4, track: "Spa", raceId: "r4", status: "DNF", position: null, grid: 5, points: 0 },
];

describe("classifications", () => {
  it("splits a sprint weekend's points into its two races", () => {
    const c = classificationsOfPerRace(perRace).filter((x) => x.round === 2);
    expect(c.map((x) => [x.sprint, x.position, x.points])).toEqual([
      [false, 2, 30],
      [true, 3, 4],
    ]);
  });
});

describe("bestResult / biggestClimb", () => {
  it("takes the best place, then the most points, then the earlier round", () => {
    const b = bestResult(perRace);
    expect([b.round, b.position, b.points]).toEqual([2, 2, 30]);
  });

  it("climbs only in feature races, from three places up", () => {
    const c = biggestClimb(perRace);
    expect([c.round, c.gained]).toEqual([2, 12]);
    expect(biggestClimb([{ number: 1, raceId: "a", status: "FINISHED", position: 5, grid: 7, points: 20 }])).toBeNull();
  });

  it("nothing for a season without a finish", () => {
    expect(bestResult([perRace[0], perRace[3]])).toBeNull();
  });
});

describe("headToHead", () => {
  const me = { perRace: { 1: { status: "FINISHED", position: 3, grid: 2, sprint: { status: "FINISHED", position: 1 } }, 2: { status: "DNF", position: null, grid: 4 }, 3: { status: "FINISHED", position: 8, grid: 9 } } };
  const them = { perRace: { 1: { status: "FINISHED", position: 5, grid: 1, sprint: { status: "FINISHED", position: 2 } }, 2: { status: "FINISHED", position: 1, grid: 3 }, 3: { status: "FINISHED", position: 4, grid: 9 } } };
  it("counts races both finished (sprints included) and starts on different slots", () => {
    expect(headToHead(me, them)).toEqual({ races: 3, ahead: 2, behind: 1, starts: 2, qualiAhead: 0, qualiBehind: 2 });
  });
});

describe("journeyTables", () => {
  const rows = [
    { driverId: "a", name: "A", perRace: { 1: { points: 25, status: "FINISHED", position: 1 }, 2: { points: 0, status: "DNF" } } },
    { driverId: "b", name: "B", perRace: { 1: { points: 18, status: "FINISHED", position: 2 }, 2: { points: 25, status: "FINISHED", position: 1 } } },
  ];
  it("ranks the table as it stood after each round", () => {
    const j = journeyTables({ rows, raceNumbers: [1, 2, 3], dropWorst: 0 }, [1, 2]);
    expect(j.get("a").map((x) => x.position)).toEqual([1, 2]);
    expect(j.get("b").map((x) => [x.position, x.points])).toEqual([
      [2, 18],
      [1, 43],
    ]);
  });

  it("ends on the real table when one is given (hand-set points, the champion rule)", () => {
    const final = [{ driverId: "a", total: 50 }, { driverId: "b", total: 43 }];
    const j = journeyTables({ rows, raceNumbers: [1, 2], dropWorst: 0 }, [1, 2], final);
    expect(j.get("a").at(-1)).toEqual({ round: 2, position: 1, points: 50 });
  });
});

describe("rankAmong", () => {
  it("counts who did better, and says when the place is shared", () => {
    expect(rankAmong([5, 3, 3, 1], 3)).toEqual({ rank: 2, of: 4, shared: true });
    expect(rankAmong([5, 3, 1], 5)).toEqual({ rank: 1, of: 3, shared: false });
  });
  it("lower is better where asked", () => {
    expect(rankAmong([2.5, 4.1, 7], 4.1, { more: false })).toEqual({ rank: 2, of: 3, shared: false });
  });
  it("gives no rank for nothing, and leaves out drivers without the figure", () => {
    expect(rankAmong([3, 1], 0)).toBeNull();
    expect(rankAmong([null, 4, 2], 2)).toEqual({ rank: 2, of: 2, shared: false });
  });
});

describe("tableWindow", () => {
  const rows = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => ({ driverId: id, name: id, total: 100 - i }));
  it("keeps five rows round the driver, more at the ends", () => {
    expect(tableWindow(rows, "d").map((r) => r.position)).toEqual([2, 3, 4, 5, 6]);
    expect(tableWindow(rows, "a").map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
    expect(tableWindow(rows, "g").map((r) => r.position)).toEqual([3, 4, 5, 6, 7]);
    expect(tableWindow(rows, "d").find((r) => r.you).driverId).toBe("d");
  });
});

describe("honoursFor", () => {
  const honours = { teamChampions: [{ teamId: "t", name: "Williams", tier: 1 }], fastestLap: { driverId: "x", ms: 90000, track: "Spa" }, mostOvertakes: { driverId: "x", count: 41 } };
  it("only once the season is over, and without repeating the title", () => {
    expect(honoursFor(honours, { driverId: "x", teamId: "t", position: 2, complete: false })).toEqual([]);
    const h = honoursFor(honours, { driverId: "x", teamId: "t", position: 2, complete: true });
    expect(h.map((x) => x.key)).toEqual(["vice", "team", "fastest-lap", "overtakes"]);
    expect(h[0].detail).toBeNull();
  });
});

import { trainingFor, tyreMix } from "./seasonReviewService.js";

describe("tyreMix", () => {
  it("adds up the laps per tyre over the season, most first, with shares", () => {
    const rounds = [{ stints: [{ tyre: "M", laps: 20 }, { tyre: "H", laps: 10 }] }, { stints: [{ tyre: "M", laps: 10 }] }, { stints: null }];
    expect(tyreMix(rounds)).toEqual([
      { tyre: "M", laps: 30, share: 75 },
      { tyre: "H", laps: 10, share: 25 },
    ]);
    expect(tyreMix([{ stints: [] }])).toBeNull();
  });
});

describe("trainingFor", () => {
  const prisma = {
    tokenPractice: {
      findMany: async () => [
        { steamId: "s1", period: "race:r1", laps: 40 },
        { steamId: "s1", period: "race:r2", laps: 60 },
        { steamId: "s2", period: "race:r1", laps: 150 },
        { steamId: "s3", period: "race:r1", laps: 10 },
        { steamId: "nobody", period: "race:r1", laps: 999 },
      ],
    },
    driver: { findMany: async () => [{ id: "a", steamId: "s1" }, { id: "b", steamId: "s2" }, { id: "c", steamId: "s3" }] },
  };
  const names = new Map([["a", "Alpha"], ["b", "Bravo"], ["c", "Charlie"]]);
  it("sums each driver's training laps over the season's race weeks and ranks them", async () => {
    const t = await trainingFor(prisma, { series: "f1", seasonId: "s", raceIds: ["r1", "r2"], driverId: "a", names });
    expect(t.laps).toBe(100);
    expect(t.weeks).toBe(2);
    expect(t.rank).toEqual({ rank: 2, of: 3, shared: false });
    expect(t.board.rows.map((r) => [r.name, r.value, r.you])).toEqual([
      ["Bravo", 150, false],
      ["Alpha", 100, true],
      ["Charlie", 10, false],
    ]);
  });
  it("nothing without a series or any laps", async () => {
    expect(await trainingFor(prisma, { series: null, seasonId: "s", raceIds: ["r1"], driverId: "a", names })).toBeNull();
  });
});
