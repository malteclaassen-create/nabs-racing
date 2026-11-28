// A Division 2 evening is two races at once. Every report of it arrives on the
// round; the result files say who drove in which race, and the report follows
// its filer to that race's row, where its contacts and its clock are.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const A = "76561198000000001"; // Alpha, Division 1
const B = "76561198000000002"; // Bravo, Division 1
const C = "76561198000000003"; // Charlie, Division 2 (on Division 1's entry list too)
const D = "76561198000000004"; // Delta, Division 2, not on the roster
const T1 = 1788545000; // Division 1's session clock
const T2 = T1 + 240; // Division 2 went green four minutes later
const WAIT = 60;

const lap = (guid, name, at) => ({ DriverGuid: guid, DriverName: name, LapTime: 60000, Timestamp: at, Cuts: 0 });
const car = (guid, name) => ({ Driver: { Guid: guid, Name: name }, Model: "f1", Skin: "x" });
const hit = (g1, n1, g2, n2, at) => ({
  Type: "COLLISION_WITH_CAR",
  Timestamp: at,
  ImpactSpeed: 42,
  Driver: { Guid: g1, Name: n1 },
  OtherDriver: { Guid: g2, Name: n2 },
});

// Division 1: Alpha and Bravo drive. Charlie is on the entry list and never
// turns a wheel.
const fileOne = {
  Type: "RACE",
  SessionConfig: { wait_time: WAIT },
  Cars: [car(A, "Alpha"), car(B, "Bravo"), car(C, "Charlie")],
  Result: [{ DriverGuid: A, DriverName: "Alpha" }, { DriverGuid: B, DriverName: "Bravo" }, { DriverGuid: C, DriverName: "Charlie" }],
  Laps: [lap(A, "Alpha", T1 + WAIT + 60), lap(B, "Bravo", T1 + WAIT + 61), lap(A, "Alpha", T1 + WAIT + 120)],
  Events: [hit(A, "Alpha", B, "Bravo", T1 + WAIT + 100)],
};
// Division 2: Charlie and Delta drive, and touch 150 seconds into the session.
const fileTwo = {
  Type: "RACE",
  SessionConfig: { wait_time: WAIT },
  Cars: [car(C, "Charlie"), car(D, "NABS | Delta")],
  Result: [{ DriverGuid: C, DriverName: "Charlie" }, { DriverGuid: D, DriverName: "NABS | Delta" }],
  Laps: [lap(C, "Charlie", T2 + WAIT + 60), lap(D, "NABS | Delta", T2 + WAIT + 62), lap(C, "Charlie", T2 + WAIT + 120)],
  Events: [hit(C, "Charlie", D, "NABS | Delta", T2 + 150)],
};

const SEASON = { id: "s8", number: 8 };
const ROSTER = [
  { id: "dA", name: "Alpha", discordName: "alpha", discordUserId: "111", steamId: A, seasonId: "s8" },
  { id: "dC", name: "Charlie", discordName: "charlie", discordUserId: "333", steamId: C, seasonId: "s8" },
];

// The few reads these functions make, answered from plain lists. `division2`
// is whether the season runs two fields; `child` whether round "parent" has
// its Division 2 row yet.
function fakePrisma({ reports = [], division2 = true, child = true, results = [] } = {}) {
  return {
    reports,
    driver: {
      findMany: async ({ where } = {}) =>
        ROSTER.filter(
          (d) =>
            (!where?.discordUserId || d.discordUserId === where.discordUserId) &&
            (typeof where?.steamId !== "string" || d.steamId === where.steamId)
        ),
    },
    race: {
      findUnique: async ({ where }) =>
        where.id === "parent" ? { id: "parent", number: 5, seasonId: "s8", season: SEASON } : null,
    },
    raceResult: { findMany: async ({ where }) => results.filter((r) => where.raceId.in.includes(r.raceId) && where.driverId.in.includes(r.driverId)) },
    setting: { findUnique: async () => null, upsert: async () => null },
    $queryRawUnsafe: async (sql, ...args) => {
      if (/FROM "Report"/.test(sql)) return reports.filter((r) => args.includes(r.raceId));
      if (/FROM "MemberAccount"/.test(sql)) return [];
      if (/"division2" FROM "Season"/.test(sql)) return [{ division2: division2 ? 1 : 0 }];
      if (/"division" = 2 AND "parentRaceId" IN/.test(sql)) return child && args.includes("parent") ? [{ id: "child", parentRaceId: "parent" }] : [];
      if (/"division" = 2 AND "parentRaceId" IS NOT NULL AND "id" IN/.test(sql)) return child && args.includes("child") ? [{ id: "child", parentRaceId: "parent" }] : [];
      if (/"division" = 2 AND "parentRaceId" IS NOT NULL/.test(sql)) return child ? [{ id: "child", parentRaceId: "parent" }] : [];
      if (/FROM "PersonLink"/.test(sql)) return [];
      return [];
    },
    $executeRawUnsafe: async (sql, raceId, id) => {
      const r = reports.find((x) => x.id === id);
      if (r) r.raceId = raceId;
      return 1;
    },
  };
}

const press = (id, over = {}) => ({
  id,
  raceId: "parent",
  source: "INGAME",
  reporterDiscordId: null,
  reporterName: "Alpha",
  contactIndex: null,
  contactSecond: null,
  incidentAt: null,
  ...over,
});

let dataDir;
let lib;
let anchor;
let contacts;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "report-division-"));
  process.env.DATA_DIR = dataDir;
  const dir = join(dataDir, "results-archive", "season8");
  mkdirSync(join(dir, "division2"), { recursive: true });
  writeFileSync(join(dir, "r05-spa.json"), JSON.stringify(fileOne));
  writeFileSync(join(dir, "division2", "r05-spa.json"), JSON.stringify(fileTwo));
  // Round 6: Division 1's file is in, Division 2's is not yet.
  writeFileSync(join(dir, "r06-monza.json"), JSON.stringify(fileOne));
  lib = await import("./reportDivision.js");
  anchor = await import("./reportAnchor.js");
  contacts = await import("./raceContacts.js");
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("which field a driver was in", () => {
  it("goes by who drove, not by who was on the entry list", () => {
    expect(lib.fieldOfGuid(SEASON, 5, A)).toBe(1);
    expect(lib.fieldOfGuid(SEASON, 5, C)).toBe(2); // listed in both, drove in Division 2
    expect(lib.fieldOfGuid(SEASON, 5, D)).toBe(2);
    expect(lib.fieldOfGuid(SEASON, 5, "76561198000000099")).toBe(null);
    expect(lib.fieldOfGuid(SEASON, 7, A)).toBe(null); // no file at all
  });

  it("places a name off the game server, clan tag or not", () => {
    expect(lib.fieldOfName(SEASON, 5, "NABS | Delta")).toBe(2);
    expect(lib.fieldOfName(SEASON, 5, "Delta")).toBe(2);
    expect(lib.fieldOfName(SEASON, 5, "Bravo")).toBe(1);
    expect(lib.fieldOfName(SEASON, 5, "Charlie")).toBe(2);
    expect(lib.fieldOfName(SEASON, 5, "Nobody")).toBe(null);
  });
});

describe("rehomeDivisionReports", () => {
  it("moves each report to the race its filer drove in", async () => {
    const reports = [
      press("a"), // Alpha, Division 1: stays
      press("b", { reporterName: "Charlie" }), // roster knows the GUID
      press("c", { reporterName: "NABS | Delta" }), // only the file knows the name
      press("d", { source: "SITE", reporterDiscordId: "333", reporterName: "charlie" }), // filed by hand, unpinned
      press("e", { source: "SITE", reporterDiscordId: "333", reporterName: "charlie", contactIndex: 4 }), // pinned: stays
      press("f", { reporterName: "A steward" }), // nobody the files know
      press("g", { raceId: "child" }), // Alpha, filed under the wrong race
    ];
    const moved = await lib.rehomeDivisionReports(fakePrisma({ reports }), {
      season: SEASON,
      parent: { id: "parent", number: 5 },
      childId: "child",
    });
    expect(moved).toBe(4);
    expect(reports.map((r) => [r.id, r.raceId])).toEqual([
      ["a", "parent"],
      ["b", "child"],
      ["c", "child"],
      ["d", "child"],
      ["e", "parent"],
      ["f", "parent"],
      ["g", "parent"],
    ]);
  });

  it("leaves everything alone while only one file is in", async () => {
    // Charlie is on Division 1's entry list in that file, and that is all
    // there is to go by: no move away from the round on that.
    const reports = [press("a", { reporterName: "Charlie" }), press("b", { reporterName: "NABS | Delta" })];
    const moved = await lib.rehomeDivisionReports(fakePrisma({ reports }), {
      season: SEASON,
      parent: { id: "parent", number: 6 },
      childId: "child",
    });
    expect(moved).toBe(0);
  });
});

describe("reportRaceFor", () => {
  it("files a Division 2 driver's report under the Division 2 race", async () => {
    const prisma = fakePrisma();
    expect(await lib.reportRaceFor(prisma, "parent", { guid: C })).toBe("child");
    expect(await lib.reportRaceFor(prisma, "parent", { guid: A })).toBe("parent");
    expect(await lib.reportRaceFor(prisma, "child", { guid: A })).toBe("parent");
    expect(await lib.reportRaceFor(prisma, "child", { guid: C })).toBe("child");
  });

  it("keeps the picked race when nothing places the driver", async () => {
    expect(await lib.reportRaceFor(fakePrisma(), "parent", { guid: null })).toBe("parent");
    expect(await lib.reportRaceFor(fakePrisma({ child: false }), "parent", { guid: C })).toBe("parent");
  });

  it("falls back to the stored classification when no file knows them", async () => {
    const prisma = fakePrisma({ results: [{ raceId: "child", driverId: "dC" }] });
    expect(await lib.reportRaceFor(prisma, "parent", { guid: null, discordId: "333" })).toBe("child");
  });
});

describe("a Division 2 driver's contacts", () => {
  it("come out of Division 2's file", () => {
    expect(contacts.contactsForDriver(SEASON, 5, C, false, 1)).toEqual([]);
    const mine = contacts.contactsForDriver(SEASON, 5, C, false, 2);
    expect(mine).toHaveLength(1);
    expect(mine[0].second).toBe(150);
    expect(mine[0].other.guid).toBe(D);
  });

  it("are 'not imported yet' until Division 2's file is in", async () => {
    const round5 = { season: SEASON, number: 5, sprint: false };
    const round6 = { season: SEASON, number: 6, sprint: false };
    // Round 6 has Division 1's file only.
    expect(await lib.emptyContactsReason(fakePrisma(), round6, D)).toBe("not-imported");
    expect(await lib.emptyContactsReason(fakePrisma(), round6, A)).toBe("none-recorded");
    // A season with one field: the file is the whole race.
    expect(await lib.emptyContactsReason(fakePrisma({ division2: false }), round6, D)).toBe("none-recorded");
    // Both files in.
    expect(await lib.emptyContactsReason(fakePrisma(), round5, "76561198000000099")).toBe("none-recorded");
    expect(await lib.emptyContactsReason(fakePrisma(), { ...round5, division: 2 }, C)).toBe("none-recorded");
  });
});

describe("the replay position of a Division 2 press", () => {
  const iso = (sec) => new Date(sec * 1000).toISOString();
  // Charlie pressed the button 12 seconds after the contact, 162 seconds into
  // Division 2's session. The live board had said 161.
  const charlie = (raceId) =>
    press("p", { raceId, reporterName: "Charlie", incidentAt: iso(T2 + 162), contactSecond: 161 });

  it("is read off Division 2's file once the report is on its race", async () => {
    const races = [{ id: "child", number: 5, sprint: false, division: 2, season: SEASON }];
    const [r] = await anchor.anchorReports(fakePrisma(), [charlie("child")], races);
    expect(r.contactMatched).toBe(true);
    expect(r.sessionSecond).toBe(150);
    expect(r.sessionSecondApprox).toBe(false);
  });

  it("keeps the live board's figure while it still sits on the round", async () => {
    // Against Division 1's clock the same press would read 402 and be called
    // exact. It is neither.
    const races = [{ id: "parent", number: 5, sprint: false, season: SEASON }];
    const [r] = await anchor.anchorReports(fakePrisma(), [charlie("parent")], races);
    expect(r.contactMatched).toBeUndefined();
    expect(r.sessionSecond).toBe(161);
    expect(r.sessionSecondApprox).toBe(true);
  });

  it("still measures a Division 1 press against Division 1's file", async () => {
    const races = [{ id: "parent", number: 5, sprint: false, season: SEASON }];
    const alpha = press("q", { incidentAt: iso(T1 + WAIT + 105), contactSecond: 160 });
    const [r] = await anchor.anchorReports(fakePrisma(), [alpha], races);
    expect(r.contactMatched).toBe(true);
    expect(r.sessionSecond).toBe(WAIT + 100);
  });
});
