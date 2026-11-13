import { describe, it, expect, vi } from "vitest";

// The standings posts in their Division 2 version (lib/divisions.js): its own
// drivers' table and its own teams, posted on their own. The tables are
// stubbed; what is under test is which table each post asks for and how the
// message names it.
const calls = [];
vi.mock("./standingsService.js", () => ({
  getDriverStandings: vi.fn(async (_p, _s, opts) => {
    calls.push(["drivers", opts?.division]);
    const rows =
      opts?.division === 2
        ? [
            { driverId: "x", name: "Rookie", tier: 3, total: 43, perRace: { 1: {} } },
            { driverId: "y", name: "Newbie", tier: 3, total: 30, perRace: { 1: {} } },
            { driverId: "z", name: "Spare", tier: 0, total: 0, perRace: {} },
          ]
        : [
            { driverId: "a", name: "13bot", tier: 1, total: 100, perRace: { 1: {} } },
            { driverId: "b", name: "Takoda", tier: 2, total: 80, perRace: { 1: {} } },
          ];
    return { standings: rows };
  }),
  getT1ConstructorStandings: vi.fn(async () => ({ standings: [{ teamId: "t1", name: "Ferrari", total: 200, position: 1 }] })),
  getT2ConstructorStandings: vi.fn(async () => ({ standings: [{ teamId: "t2", name: "Minardi", total: 50, position: 1 }] })),
  getDiv2ConstructorStandings: vi.fn(async () => ({
    standings: [
      { teamId: "d1", name: "Red Bull", total: 65, position: 1 },
      { teamId: "d2", name: "Ferrari", total: 47, position: 2 },
    ],
  })),
}));
vi.mock("../lib/persons.js", () => ({ discordIdsForDrivers: async () => new Map([["x", "999"]]) }));
vi.mock("../lib/telemetryRead.js", () => ({ telemetryForRace: async () => new Map() }));

const { buildStandingsPost, buildConstructorsPost } = await import("./resultsPostService.js");

const prisma = {
  season: { findUnique: async () => ({ id: "s8", number: 8, isActive: true, series: { slug: "friday-f1" } }) },
};

describe("the Division 2 standings post", () => {
  it("is Division 2's own table, named for it, and leaves idle reserves off", async () => {
    calls.length = 0;
    const { full } = await buildStandingsPost(prisma, "s8", { division: 2, upToRound: 6 });
    expect(calls).toContainEqual(["drivers", 2]);
    expect(full).toContain("**DIVISION 2 STANDINGS AFTER ROUND 6**");
    expect(full).toContain("🥇 <@999> - 43");
    expect(full).toContain("🥈 **Newbie** - 30");
    expect(full).not.toContain("Spare");
    expect(full).not.toContain("13bot");
  });

  it("ignores a tier picked for Division 1: Division 2 has one tier", async () => {
    const { full } = await buildStandingsPost(prisma, "s8", { division: 2, tier: "1" });
    expect(full).toContain("🥇 <@999>");
    expect(full).toContain("**Newbie**");
  });

  it("links the standings page open on Division 2", async () => {
    const { short } = await buildStandingsPost(prisma, "s8", { division: 2, origin: "https://league.example" });
    expect(short).toContain("https://league.example/s/friday-f1/drivers?division=2");
  });

  it("leaves Division 1's post as it was", async () => {
    const { full } = await buildStandingsPost(prisma, "s8", {});
    expect(full).toContain("**DRIVER STANDINGS**");
    expect(full).toContain("**13bot** - 100");
  });
});

describe("the Division 2 constructors post", () => {
  it("is Division 2's teams as one table", async () => {
    const { full, short } = await buildConstructorsPost(prisma, "s8", { division: 2, origin: "https://league.example" });
    expect(full).toContain("**DIVISION 2 CONSTRUCTORS**");
    expect(full).toContain("**DIVISION 2**");
    expect(full).toContain("🥇 **Red Bull** - 65");
    expect(full).not.toContain("TIER");
    expect(full).not.toContain("Minardi");
    expect(short).toContain("Division 2: **Red Bull** 65");
    expect(short).toContain("/constructors#division-2");
  });

  it("leaves Division 1's both tiers as they were", async () => {
    const { full } = await buildConstructorsPost(prisma, "s8", {});
    expect(full).toContain("**TIER 1**");
    expect(full).toContain("**TIER 2**");
    expect(full).not.toContain("Red Bull");
  });
});
