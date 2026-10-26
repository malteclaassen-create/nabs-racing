import { describe, it, expect } from "vitest";
import { seasonNumbers } from "../src/lib/seasonNumbers.js";

const res = (driverId, name, position, extra = {}) => ({ driverId, driver: { name }, position, status: "FIN", laps: 10, session: "R1", ...extra });

describe("a season in numbers", () => {
  const races = [
    {
      id: 1, round: 1, name: "Opener", qualifying: [{ driverId: 1, position: 1, driver: { name: "Ann" } }],
      results: [res(1, "Ann", 1, { totalTimeMs: 600000 }), res(2, "Bob", 2, { totalTimeMs: 600900 }), res(3, "Cid", 3, { status: "DNF", laps: 4 })],
    },
    {
      id: 2, round: 2, name: "Double", qualifying: [{ driverId: 2, position: 1, driver: { name: "Bob" } }],
      results: [
        res(2, "Bob", 1, { totalTimeMs: 500000 }), res(1, "Ann", 2, { totalTimeMs: 500300 }),
        res(1, "Ann", 1, { session: "R2", totalTimeMs: 400000 }), res(2, "Bob", 2, { session: "R2", totalTimeMs: 405000 }),
      ],
    },
    { id: 3, round: 3, name: "Not raced", qualifying: [], results: [] },
  ];
  const n = seasonNumbers(races, { drivers: [{ id: 1, name: "Ann", points: 80, wins: 2 }] });

  it("counts rounds, races, drivers and winners", () => {
    expect(n).toMatchObject({ rounds: 2, races: 3, drivers: 3, winners: 2 });
  });
  it("names who won most and who took most poles, ties included", () => {
    expect(n.mostWins).toEqual({ count: 2, drivers: [{ id: 1, name: "Ann" }] });
    expect(n.mostPoles.count).toBe(1);
    expect(n.mostPoles.drivers.map((d) => d.name)).toEqual(["Ann", "Bob"]);
  });
  it("finds the closest finish between the first two", () => {
    expect(n.closest).toMatchObject({ gapMs: 300, round: 2, race: 1, winner: "Bob", second: "Ann" });
  });
  it("is nothing for a season without results", () => {
    expect(seasonNumbers([{ id: 9, results: [] }], null)).toBe(null);
  });
});
