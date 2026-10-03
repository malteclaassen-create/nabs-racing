import { describe, it, expect, vi, beforeEach } from "vitest";

// The round's result file, stubbed down to its name -> GUID map (normalized
// keys), which is all the link needs from it.
let fileNames = new Map();
vi.mock("./raceContacts.js", () => ({
  sessionStartForRound: () => null,
  contactsForDriver: () => [],
  guidsByNameForRound: () => fileNames,
}));
// Driver row -> Discord account, without the person groups behind it.
let driverDiscord = new Map();
vi.mock("./persons.js", () => ({
  discordIdsForDrivers: async (_p, ids) => new Map(ids.filter((id) => driverDiscord.has(id)).map((id) => [id, driverDiscord.get(id)])),
}));

const { discordIdsForGuids, linkInGameReporters } = await import("./reportReporter.js");
const { invalidateAltCache } = await import("./members.js");

const RACE = { id: "race1", number: 9, season: { id: "s8", number: 8 } };

let driverRows = []; // { id, steamId }
let accountRows = []; // { discordId, steamId }
let updates = [];
let altRows = []; // { discordId, mainDiscordId }
const prisma = {
  $queryRaw: async () => altRows,
  driver: { findMany: async () => [] },
  $queryRawUnsafe: async (sql) => {
    if (sql.includes('FROM "Driver"')) return driverRows;
    if (sql.includes('FROM "MemberAccount"')) return accountRows;
    return [];
  },
  $executeRawUnsafe: async (_sql, discord, id) => {
    updates.push([id, discord]);
    return 1;
  },
};

const press = (over = {}) => ({
  id: "r1",
  source: "INGAME",
  raceId: "race1",
  reporterName: "Urmaggedon",
  reporterDiscordId: null,
  ...over,
});

beforeEach(() => {
  fileNames = new Map();
  driverDiscord = new Map();
  driverRows = [];
  accountRows = [];
  updates = [];
  altRows = [];
  invalidateAltCache();
});

describe("in-game reports reach the driver who pressed the button", () => {
  it("links a press whose name the roster does not know, through the result file's Steam id", async () => {
    fileNames = new Map([["urmaggedon", "STEAM_U"]]);
    driverRows = [{ id: "urma", steamId: "STEAM_U" }];
    driverDiscord = new Map([["urma", "D_NEW"]]);
    const [r] = await linkInGameReporters(prisma, [press()], [RACE]);
    expect(r.reporterDiscordId).toBe("D_NEW");
    expect(updates).toEqual([["r1", "D_NEW"]]);
  });

  it("leaves a report alone that already has an account, and site reports too", async () => {
    fileNames = new Map([["urmaggedon", "STEAM_U"]]);
    driverRows = [{ id: "urma", steamId: "STEAM_U" }];
    driverDiscord = new Map([["urma", "D_NEW"]]);
    const out = await linkInGameReporters(
      prisma,
      [press({ reporterDiscordId: "D_OTHER" }), press({ id: "r2", source: "SITE" })],
      [RACE]
    );
    expect(out.map((r) => r.reporterDiscordId)).toEqual(["D_OTHER", null]);
    expect(updates).toEqual([]);
  });

  it("stays unlinked while the round has no result file yet", async () => {
    driverRows = [{ id: "urma", steamId: "STEAM_U" }];
    driverDiscord = new Map([["urma", "D_NEW"]]);
    const [r] = await linkInGameReporters(prisma, [press()], [RACE]);
    expect(r.reporterDiscordId).toBeNull();
    expect(updates).toEqual([]);
  });
});

describe("Steam id to Discord account", () => {
  it("prefers the roster over a Steam login that names someone else", async () => {
    driverRows = [{ id: "urma", steamId: "G" }];
    driverDiscord = new Map([["urma", "D_ROSTER"]]);
    accountRows = [{ discordId: "D_LOGIN", steamId: "G" }];
    expect((await discordIdsForGuids(prisma, ["G"])).get("G")).toBe("D_ROSTER");
  });

  it("falls back to the login when the roster has no account for that Steam id", async () => {
    driverRows = [{ id: "rookie", steamId: "G" }];
    accountRows = [{ discordId: "D_LOGIN", steamId: "G" }];
    expect((await discordIdsForGuids(prisma, ["G"])).get("G")).toBe("D_LOGIN");
  });

  it("refuses to pick when the roster names two different accounts", async () => {
    driverRows = [
      { id: "a_s7", steamId: "G" },
      { id: "a_s8", steamId: "G" },
    ];
    driverDiscord = new Map([
      ["a_s7", "D_OLD"],
      ["a_s8", "D_NEW"],
    ]);
    expect((await discordIdsForGuids(prisma, ["G"])).has("G")).toBe(false);
  });

  it("treats a second account as its main one", async () => {
    driverRows = [
      { id: "a_s7", steamId: "G" },
      { id: "a_s8", steamId: "G" },
    ];
    driverDiscord = new Map([
      ["a_s7", "D_OLD"],
      ["a_s8", "D_NEW"],
    ]);
    altRows = [{ discordId: "D_NEW", mainDiscordId: "D_OLD" }];
    expect((await discordIdsForGuids(prisma, ["G"])).get("G")).toBe("D_OLD");
  });
});
