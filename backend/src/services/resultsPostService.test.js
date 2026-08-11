import { describe, it, expect, vi } from "vitest";

// The two halves of the message this cannot know by itself.
vi.mock("../lib/telemetryRead.js", () => ({ telemetryForRace: async () => new Map() }));
vi.mock("../lib/persons.js", () => ({
  // d1 and d2 have logged in via Discord; d3 never has.
  discordIdsForDrivers: async () => new Map([["d1", "111"], ["d2", "222"]]),
}));

const { buildResultsPost } = await import("./resultsPostService.js");

// The short version is the one that gets posted most weeks, and it is the only
// message on the site that carries a LINK. Both of those are easy to break
// somewhere else: the podium comes out of the same penalty-applied ordering as
// the long version, and the link is assembled from a series slug that lives two
// relations away from the race.

const RACE = { id: "r1", number: 1, track: "Hockenheim", seasonId: "s8" };

const driver = (id, name) => ({ driverId: id, driver: { name }, status: "FINISHED" });

function makePrisma({ race = RACE, results = null, series = { slug: "friday-f1" } } = {}) {
  return {
    race: { findUnique: async () => race },
    raceResult: {
      findMany: async () =>
        results || [
          { ...driver("d1", "13bot"), position: 1, points: 25 },
          { ...driver("d2", "mtimmis"), position: 2, points: 18 },
          { ...driver("d3", "Maltegoat"), position: 3, points: 15 },
          { ...driver("d4", "Takoda"), position: 4, points: 12 },
          { driverId: "d5", driver: { name: "Gone" }, status: "DNF", position: null },
        ],
    },
    season: { findUnique: async () => ({ id: "s8", series }) },
    $queryRawUnsafe: async () => [{ driverOfTheDayId: null, driverOfTheDayBy: null }],
  };
}

describe("buildResultsPost", () => {
  it("returns nothing for a race that does not exist", async () => {
    const prisma = makePrisma();
    prisma.race.findUnique = async () => null;
    expect(await buildResultsPost(prisma, "nope")).toBeNull();
  });

  it("returns nothing for a race with no results", async () => {
    const prisma = makePrisma({ results: [] });
    expect(await buildResultsPost(prisma, "r1")).toBeNull();
  });

  it("puts the whole field in the full version", async () => {
    const { full } = await buildResultsPost(makePrisma(), "r1");
    expect(full).toContain("**ROUND 1 - HOCKENHEIM**");
    expect(full).toContain("🥇 <@111>");
    expect(full).toContain("P4.");
    expect(full).toContain("DNF.");
  });

  it("puts only the podium in the short version, on one line", async () => {
    const { short } = await buildResultsPost(makePrisma(), "r1", { origin: "https://league.example" });
    const lines = short.split("\n");
    expect(lines[0]).toBe("**ROUND 1 - HOCKENHEIM**");
    expect(lines[2]).toBe("🥇 <@111>  🥈 <@222>  🥉 **Maltegoat**");
    expect(short).not.toContain("Takoda"); // fourth and back belong to the picture
    expect(short).not.toContain("DNF");
    expect(short).not.toContain("STATS");
  });

  it("links the short version at the round's own page on this site", async () => {
    const { short } = await buildResultsPost(makePrisma(), "r1", { origin: "https://league.example" });
    expect(short).toContain(
      "[Full classification, lap times and stats on the website](https://league.example/s/friday-f1/races?race=r1)"
    );
  });

  it("leaves the link out rather than guessing when there is no origin", async () => {
    const { short } = await buildResultsPost(makePrisma(), "r1");
    expect(short).not.toContain("http");
    expect(short).not.toContain("classification");
    expect(short.endsWith("🥉 **Maltegoat**")).toBe(true); // and no trailing blank line
  });

  it("still links a race whose series has no slug, without inventing one", async () => {
    const { short } = await buildResultsPost(makePrisma({ series: null }), "r1", {
      origin: "https://league.example",
    });
    expect(short).toContain("(https://league.example/races?race=r1)");
  });

  it("hands back the names behind every mention, so a preview can show them", async () => {
    const { mentions } = await buildResultsPost(makePrisma(), "r1");
    expect(mentions).toEqual({ 111: "13bot", 222: "mtimmis" });
  });

  it("names a podium driver in bold when Discord does not know them", async () => {
    const { short } = await buildResultsPost(makePrisma(), "r1");
    expect(short).toContain("🥉 **Maltegoat**");
  });

  it("follows the penalty-corrected order, not the raw finish", async () => {
    // d2 crosses the line first but takes 30 seconds, which drops them behind
    // d1. The podium has to be the classification, not the flag order.
    const results = [
      { ...driver("d2", "mtimmis"), position: 1, points: 25, penaltySeconds: 30, totalTimeMs: 3_000_000 },
      { ...driver("d1", "13bot"), position: 2, points: 18, totalTimeMs: 3_010_000 },
      { ...driver("d3", "Maltegoat"), position: 3, points: 15, totalTimeMs: 3_050_000 },
    ];
    const { short } = await buildResultsPost(makePrisma({ results }), "r1");
    expect(short).toContain("🥇 <@111>"); // d1
    expect(short).toContain("🥈 <@222>"); // d2, demoted
  });

  it("copes with a round that has no number", async () => {
    const prisma = makePrisma({ race: { ...RACE, number: null } });
    const { short } = await buildResultsPost(prisma, "r1");
    expect(short.startsWith("**ROUND ? - HOCKENHEIM**")).toBe(true);
  });
});
