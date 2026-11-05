import { describe, it, expect } from "vitest";
import { seasonPracticeTotals, practiceSeasonBoard } from "./practiceTokens.js";
import { lapsOfSession } from "./practiceFromServer.js";

const A = "76561100000000001";
const B = "76561100000000002";
const C = "76561100000000003"; // not a driver this season

const DAY = 86400000;
const T0 = Date.UTC(2026, 8, 4, 17, 30); // a round's start
const sec = (ms) => Math.round(ms / 1000);

// Last season's final round, then two rounds of this one.
const ROUNDS = new Map([
  [
    "nabs",
    [
      { id: "old", track: "Monza", start: T0 - 14 * DAY, active: false },
      { id: "r1", track: "Spa", start: T0, active: true },
      { id: "r2", track: "Monza", start: T0 + 7 * DAY, active: true },
    ],
  ],
]);

describe("lapsOfSession", () => {
  it("keeps every lap's Steam id and time, cut or not", () => {
    const out = lapsOfSession({
      TrackName: "spa",
      Laps: [
        { DriverGuid: A, Timestamp: 100, Cuts: 2 },
        { DriverGuid: A, Timestamp: 200 },
        { DriverGuid: "", Timestamp: 300 },
        { DriverGuid: B, Timestamp: 0 },
      ],
    });
    expect(out).toEqual({ track: "spa", laps: { [A]: [100, 200] } });
  });
});

describe("season practice totals", () => {
  it("files each lap under the round it was driven before, on that round's circuit only", () => {
    const totals = seasonPracticeTotals({
      rounds: ROUNDS,
      sessions: [
        // before round 1, on Spa: practice for round 1
        { track: "spa", laps: { [A]: [sec(T0 - 3 * DAY), sec(T0 - 2 * DAY)] } },
        // after round 1, still on Spa: not practice for Monza
        { track: "spa", laps: { [A]: [sec(T0 + DAY)] } },
        // before round 2 on Monza
        { track: "monza", laps: { [A]: [sec(T0 + 3 * DAY)], [B]: [sec(T0 + 3 * DAY)] } },
        // last season
        { track: "monza", laps: { [A]: [sec(T0 - 20 * DAY)] } },
      ],
    });
    expect(totals.sort((x, y) => x.steamId.localeCompare(y.steamId))).toEqual([
      { series: "nabs", steamId: A, laps: 3 },
      { series: "nabs", steamId: B, laps: 1 },
    ]);
  });

  it("starts the count one week before the first round", () => {
    const totals = seasonPracticeTotals({
      rounds: ROUNDS,
      since: T0 - 7 * DAY,
      sessions: [{ track: "spa", laps: { [A]: [sec(T0 - 10 * DAY), sec(T0 - 6 * DAY)] } }],
    });
    expect(totals).toEqual([{ series: "nabs", steamId: A, laps: 1 }]);
  });

  it("takes the bigger of the files and the live count per week, never both", () => {
    const totals = seasonPracticeTotals({
      rounds: ROUNDS,
      sessions: [{ track: "spa", laps: { [A]: [1, 2, 3].map((h) => sec(T0 - h * 3600000)) } }],
      relay: [
        { steamId: A, series: "nabs", period: "race:r1", laps: 2, trackKey: "spa" },
        // a session still running in round 2's week: only the relay has it
        { steamId: A, series: "nabs", period: "race:r2", laps: 4, trackKey: "monza" },
        { steamId: A, series: "nabs", period: "race:r2", laps: 1, trackKey: "monza" }, // other server
      ],
    });
    expect(totals).toEqual([{ series: "nabs", steamId: A, laps: 3 + 5 }]);
  });
});

describe("season practice board", () => {
  function fakePrisma({ races, relay = [], drivers, mySteam = [] }) {
    return {
      async $queryRawUnsafe(sql, ...args) {
        if (/FROM "Race" ra/.test(sql)) return races;
        if (/FROM "TokenPractice"/.test(sql)) return relay;
        if (/FROM "Driver" WHERE "steamId" IN/.test(sql)) return drivers.filter((d) => args.includes(d.steamId));
        if (/FROM "Driver" WHERE "discordUserId"/.test(sql)) return mySteam.length ? [{ id: "me" }] : [];
        if (/FROM "PersonLink"/.test(sql)) return [];
        if (/SELECT DISTINCT "steamId" FROM "Driver"/.test(sql)) return mySteam.map((steamId) => ({ steamId }));
        return [];
      },
    };
  }

  it("lists this season's drivers per series and marks your own line", async () => {
    const prisma = fakePrisma({
      races: [
        { id: "old", track: "Monza", date: T0 - 14 * DAY, seasonId: "s6", isActive: 0, slug: "nabs", name: "NABS" },
        { id: "r1", track: "Spa", date: T0, seasonId: "s7", isActive: 1, slug: "nabs", name: "NABS" },
      ],
      drivers: [
        { id: "d1", name: "Old name", photoUrl: null, steamId: A, seasonId: "s6" },
        { id: "d2", name: "Alice", photoUrl: null, steamId: A, seasonId: "s7" },
        { id: "d3", name: "Bob", photoUrl: "b.png", steamId: B, seasonId: "s7" },
        { id: "d4", name: "Carl", photoUrl: null, steamId: C, seasonId: "s6" },
      ],
      mySteam: [A],
    });
    let askedSince = null;
    const sessionsSince = async (since) => {
      askedSince = since;
      return [
        {
          track: "spa",
          laps: {
            [A]: [sec(T0 - DAY)],
            [B]: [sec(T0 - DAY), sec(T0 - DAY + 100)],
            [C]: Array.from({ length: 9 }, (_, i) => sec(T0 - DAY + i)),
          },
        },
      ];
    };
    const board = await practiceSeasonBoard(prisma, 10, "disc-a", { sessionsSince });
    // the count starts one week before the season's first round
    expect(askedSince).toBe(T0 - 7 * DAY);
    expect(board).toHaveLength(1);
    expect(board[0].rows.map((r) => [r.name, r.laps, r.mine])).toEqual([
      ["Bob", 2, false],
      ["Alice", 1, true],
    ]);
  });

  it("answers with the live count when the server's files cannot be read", async () => {
    const prisma = fakePrisma({
      races: [{ id: "r1", track: "Spa", date: T0, seasonId: "s7", isActive: 1, slug: "nabs", name: "NABS" }],
      relay: [{ steamId: A, series: "nabs", period: "race:r1", laps: 12, trackKey: "spa" }],
      drivers: [{ id: "d2", name: "Alice", photoUrl: null, steamId: A, seasonId: "s7" }],
    });
    const sessionsSince = () => Promise.reject(new Error("server down"));
    const board = await practiceSeasonBoard(prisma, 10, null, { sessionsSince });
    expect(board[0].rows.map((r) => [r.name, r.laps])).toEqual([["Alice", 12]]);
  });

  it("is empty when there is no running season", async () => {
    const prisma = fakePrisma({ races: [], drivers: [] });
    expect(await practiceSeasonBoard(prisma)).toEqual([]);
  });
});
