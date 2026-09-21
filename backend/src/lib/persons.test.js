import { describe, it, expect } from "vitest";
import { selectOwnCurrentRows, ownCurrentRowIds, currentRowPerSeries, selectOwnRows } from "./persons.js";

// A member's own profile edits land on their row in EVERY league they race
// in, not just the one row their login points at. Archive rows and rows that
// belong to somebody else's Discord account stay untouched.
describe("selectOwnCurrentRows", () => {
  // f7 = the Friday league's active season (7); s1 = the Sunday league's
  // active season (1); f8 is a Friday draft; f6 is a Friday archive row.
  const active = new Map([["friday", 7], ["sunday", 1]]);
  const rows = [
    { id: "f7", discordUserId: "me", seasonNumber: 7, seriesId: "friday" },
    { id: "f6", discordUserId: null, seasonNumber: 6, seriesId: "friday" },
    { id: "f8", discordUserId: null, seasonNumber: 8, seriesId: "friday" },
    { id: "s1", discordUserId: null, seasonNumber: 1, seriesId: "sunday" },
  ];

  it("takes the acting row, the other league's current row and the draft, not the archive", () => {
    expect(selectOwnCurrentRows(rows, active, 7, "f7", "me").sort()).toEqual(["f7", "f8", "s1"]);
  });

  it("never touches a row claimed by another Discord account", () => {
    const withOther = rows.map((r) => (r.id === "s1" ? { ...r, discordUserId: "someone-else" } : r));
    expect(selectOwnCurrentRows(withOther, active, 7, "f7", "me").sort()).toEqual(["f7", "f8"]);
  });

  it("a row of a series whose active season is unknown is left alone", () => {
    expect(selectOwnCurrentRows(rows, new Map([["friday", 7]]), null, "f7", "me").sort()).toEqual(["f7", "f8"]);
  });

  it("rows without a series use the global cap", () => {
    const legacy = [{ id: "x", discordUserId: null, seasonNumber: 7, seriesId: null }];
    expect(selectOwnCurrentRows(legacy, new Map(), 7, "f7", "me").sort()).toEqual(["f7", "x"]);
    expect(selectOwnCurrentRows(legacy, new Map(), 8, "f7", "me")).toEqual(["f7"]);
  });

  it("always includes the acting row, even alone", () => {
    expect(selectOwnCurrentRows([], active, 7, "f7", "me")).toEqual(["f7"]);
  });
});

// For "edit this league on its own": one row per series, the active season's
// row rather than a later draft.
describe("currentRowPerSeries", () => {
  const active = new Map([["friday", 7], ["sunday", 1]]);
  it("picks the active-season row of each series, not the draft", () => {
    const rows = [
      { id: "f7", seasonNumber: 7, seriesId: "friday" },
      { id: "f8", seasonNumber: 8, seriesId: "friday" },
      { id: "s1", seasonNumber: 1, seriesId: "sunday" },
    ];
    expect(currentRowPerSeries(rows, active, 7).map((r) => r.id).sort()).toEqual(["f7", "s1"]);
  });
  it("lets a draft stand in when the series has no active-season row", () => {
    const rows = [{ id: "f8", seasonNumber: 8, seriesId: "friday" }];
    expect(currentRowPerSeries(rows, active, 7).map((r) => r.id)).toEqual(["f8"]);
  });
  it("skips archive rows", () => {
    const rows = [{ id: "f6", seasonNumber: 6, seriesId: "friday" }];
    expect(currentRowPerSeries(rows, active, 7)).toEqual([]);
  });
});

describe("ownCurrentRowIds", () => {
  it("falls back to the acting row when the person tables are missing", async () => {
    const prisma = {
      $queryRaw: async () => { throw new Error("no such table"); },
      $queryRawUnsafe: async () => { throw new Error("no such table"); },
    };
    expect(await ownCurrentRowIds(prisma, "f7", "me")).toEqual(["f7"]);
  });

  it("reads the linked rows and their seasons", async () => {
    const prisma = {
      $queryRaw: async () => [
        { driverId: "f7", personId: "p" },
        { driverId: "s1", personId: "p" },
        { driverId: "f6", personId: "p" },
      ],
      $queryRawUnsafe: async (sql) => {
        if (sql.includes('"isActive" = 1')) return [{ seriesId: "friday", number: 7 }, { seriesId: "sunday", number: 1 }];
        if (sql.includes('FROM "Driver" d')) {
          return [
            { id: "f7", discordUserId: "me", seasonNumber: 7, seriesId: "friday" },
            { id: "s1", discordUserId: null, seasonNumber: 1, seriesId: "sunday" },
            { id: "f6", discordUserId: null, seasonNumber: 6, seriesId: "friday" },
          ];
        }
        throw new Error(`unexpected: ${sql}`);
      },
      season: { findFirst: async () => ({ id: "season-7", number: 7 }) },
    };
    expect((await ownCurrentRowIds(prisma, "f7", "me")).sort()).toEqual(["f7", "s1"]);
  });
});

// A preference with nothing seasonal about it — the card animation switch —
// reaches every card of the person, archive rows included. Only somebody
// else's claim keeps a row out.
describe("selectOwnRows", () => {
  const rows = [
    { id: "f8", discordUserId: "me" },
    { id: "f5", discordUserId: null },
    { id: "s1", discordUserId: null },
    { id: "old", discordUserId: null },
  ];

  it("takes every linked row, however old", () => {
    expect(selectOwnRows(rows, "f8", "me").sort()).toEqual(["f5", "f8", "old", "s1"]);
  });

  it("leaves out a row claimed by another Discord account", () => {
    const taken = rows.map((r) => (r.id === "s1" ? { ...r, discordUserId: "someone-else" } : r));
    expect(selectOwnRows(taken, "f8", "me").sort()).toEqual(["f5", "f8", "old"]);
  });

  it("always includes the acting row, even alone or unknown", () => {
    expect(selectOwnRows([], "f8", "me")).toEqual(["f8"]);
    expect(selectOwnRows(null, "f8", "me")).toEqual(["f8"]);
  });

  it("does not drop the acting row when somebody else's id sits on it", () => {
    // The acting row is where the login already is; the filter is about the
    // OTHER rows a change would reach.
    expect(selectOwnRows([{ id: "f8", discordUserId: "someone-else" }], "f8", "me")).toEqual(["f8"]);
  });
});
