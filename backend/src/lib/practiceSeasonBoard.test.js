import { describe, it, expect } from "vitest";
import { sumSeasonPractice, practiceSeasonBoard } from "./practiceTokens.js";

const A = "76561100000000001";
const B = "76561100000000002";
const C = "76561100000000003"; // not a league driver

function fakePrisma({ races, practice, drivers, mySteam = [] }) {
  return {
    async $queryRawUnsafe(sql, ...args) {
      if (/FROM "Race" ra/.test(sql)) return races;
      if (/FROM "TokenPractice"/.test(sql)) return practice.filter((r) => args.includes(r.period));
      if (/FROM "Driver" WHERE "steamId" IN/.test(sql)) return drivers.filter((d) => args.includes(d.steamId));
      if (/FROM "Driver" WHERE "discordUserId"/.test(sql)) return mySteam.length ? [{ id: "me" }] : [];
      if (/FROM "PersonLink"/.test(sql)) return [];
      if (/SELECT DISTINCT "steamId" FROM "Driver"/.test(sql)) return mySteam.map((steamId) => ({ steamId }));
      return [];
    },
  };
}

describe("season practice board", () => {
  it("adds up every week and both servers, leaving out laps on the wrong circuit", () => {
    const races = new Map([
      ["race:r1", { series: "nabs", track: "Spa" }],
      ["race:r2", { series: "nabs", track: "Monza" }],
    ]);
    const out = sumSeasonPractice(
      [
        { steamId: A, series: "nabs", period: "race:r1", laps: 30, trackKey: "spa" },
        { steamId: A, series: "nabs", period: "race:r2", laps: 12, trackKey: "monza" },
        { steamId: A, series: "nabs", period: "race:r2", laps: 5, trackKey: "monza" }, // other server
        { steamId: A, series: "nabs", period: "race:r2", laps: 40, trackKey: "spa" }, // old circuit
        { steamId: A, series: "nabs", period: "week:2026-10-05", laps: 99, trackKey: "spa" }, // no round
      ],
      races
    );
    expect(out).toEqual([{ series: "nabs", steamId: A, laps: 47 }]);
  });

  it("ranks per series, names the driver and marks your own line", async () => {
    const prisma = fakePrisma({
      races: [
        { id: "r1", track: "Spa", seasonId: "s7", slug: "nabs", name: "NABS" },
        { id: "r9", track: "Spa", seasonId: "x1", slug: "sunday", name: "Sunday League" },
      ],
      practice: [
        { steamId: A, series: "nabs", period: "race:r1", laps: 20, trackKey: "spa" },
        { steamId: B, series: "nabs", period: "race:r1", laps: 55, trackKey: "spa" },
        { steamId: C, series: "nabs", period: "race:r1", laps: 80, trackKey: "spa" },
        { steamId: A, series: "sunday", period: "race:r9", laps: 7, trackKey: "spa" },
      ],
      drivers: [
        { id: "d1", name: "Old name", photoUrl: null, steamId: A, seasonId: "s6" },
        { id: "d2", name: "Alice", photoUrl: null, steamId: A, seasonId: "s7" },
        { id: "d3", name: "Bob", photoUrl: "b.png", steamId: B, seasonId: "s7" },
      ],
      mySteam: [A],
    });
    const board = await practiceSeasonBoard(prisma, 10, "disc-a");
    expect(board.map((b) => b.series)).toEqual(["nabs", "sunday"]);
    expect(board[0].rows.map((r) => [r.name, r.laps, r.mine])).toEqual([
      ["Bob", 55, false],
      ["Alice", 20, true],
    ]);
    expect(board[1].seriesName).toBe("Sunday League");
    expect(board[1].rows.map((r) => r.laps)).toEqual([7]);
  });

  it("is empty when there is no running season", async () => {
    const prisma = fakePrisma({ races: [], practice: [], drivers: [] });
    expect(await practiceSeasonBoard(prisma)).toEqual([]);
  });
});
