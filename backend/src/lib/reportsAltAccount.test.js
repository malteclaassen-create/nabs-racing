import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./stewards.js", () => ({ isSteward: async () => false }));
vi.mock("./persons.js", () => ({
  discordIdsForDrivers: async () => new Map(),
  getPersonGroups: async () => ({ byDriver: new Map(), byPerson: new Map() }),
}));

const { dbRolesFor, roleOn, canRead } = await import("./reports.js");
const { invalidateAltCache } = await import("./members.js");

// A report filed from a driver's NEW Discord account, after an admin marked the
// new one as the second account of the old one. Signing in through either now
// arrives here as the OLD (main) account.
let altRows = [];
const prisma = {
  $queryRaw: async () => altRows,
  $queryRawUnsafe: async () => [],
};
const REPORT = { id: "r1", reporterDiscordId: "D_NEW", accusedDriverId: null };

beforeEach(() => {
  altRows = [];
  invalidateAltCache();
});

describe("a report filed from a second account", () => {
  it("belongs to the main account once the two are linked", async () => {
    altRows = [{ discordId: "D_NEW", mainDiscordId: "D_OLD" }];
    expect((await dbRolesFor(prisma, [REPORT], "D_OLD")).get("r1")).toBe("REPORTER");
    expect(await roleOn(prisma, REPORT, "D_OLD")).toBe("REPORTER");
    expect(await canRead(prisma, REPORT, "D_OLD", false)).toBe(true);
  });

  it("stays with its own account while they are not linked", async () => {
    expect((await dbRolesFor(prisma, [REPORT], "D_OLD")).has("r1")).toBe(false);
    expect(await canRead(prisma, REPORT, "D_OLD", false)).toBe(false);
    expect(await roleOn(prisma, REPORT, "D_NEW")).toBe("REPORTER");
  });
});
