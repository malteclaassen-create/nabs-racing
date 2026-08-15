// What a page ABOUT ONE THING hands a crawler, and the line it must not cross.
//
// The listing pages have had a link block since indexing was first fixed; the
// pages behind those links had nothing, so Google described every driver on the
// site with the same footer sentence. These build the missing half.
//
// The tests that matter most are the ones about the boundary: a driver's page
// gets that driver's facts and that driver's links, and must NOT get the four
// hundred links the driver LIST page gets. Showing a crawler more than a reader
// is cloaking, and it is the one mistake here that is worse than doing nothing.
import { describe, it, expect, vi } from "vitest";

vi.mock("../services/standingsService.js", () => ({
  // (prisma, seasonId) — the season is the SECOND argument.
  getDriverStandings: vi.fn(async (_prisma, seasonId) =>
    seasonId === "s8"
      ? {
          // `team` is on every row: the head-to-head panel reads it to find
          // who shares a garage, and so does the block under test.
          standings: [
            { driverId: "d1", name: "Takoda", position: 1, total: 210, team: { id: "mclaren" } },
            { driverId: "d2", name: "Neesh", position: 2, total: 180, team: { id: "ferrari" } },
            { driverId: "d3", name: "DRAS", position: 3, total: 150, team: { id: "mclaren" } },
            { driverId: "d4", name: "Flo", position: 9, total: 24, team: { id: "ferrari" } },
          ],
        }
      : { standings: [] }
  ),
}));
vi.mock("../services/seasonService.js", () => ({
  getPrivateSeasonIds: vi.fn(async () => new Set(["secret"])),
}));
vi.mock("../services/pointsCalculator.js", () => ({
  applyPenalties: (rows) => rows,
}));
vi.mock("./persons.js", () => ({ getNameOverrides: vi.fn(async () => new Map()) }));

import { buildEntityBlock } from "./crawlEntities.js";

const BASE = "/s/friday-f1";

const prisma = {
  driver: {
    findUnique: vi.fn(async ({ where }) =>
      where.id === "d4"
        ? {
            id: "d4",
            name: "Flo",
            seasonId: "s8",
            team: { id: "ferrari", name: "Ferrari" },
            season: { id: "s8", number: 8 },
          }
        : where.id === "hidden"
          ? { id: "hidden", name: "Ghost", seasonId: "secret", team: null, season: { id: "secret", number: 9 } }
          : null
    ),
    findMany: vi.fn(async ({ where }) =>
      where.teamId === "ferrari" ? [{ id: "d2", name: "Neesh" }] : []
    ),
  },
  team: {
    findUnique: vi.fn(async ({ where }) =>
      where.id === "ferrari" ? { id: "ferrari", name: "Ferrari", seasonId: "s8" } : null
    ),
  },
  race: {
    findUnique: vi.fn(async ({ where }) =>
      where.id === "r2"
        ? { id: "r2", number: 2, track: "Watkins Glen", seasonId: "s8", season: { number: 8, isPublic: true } }
        : null
    ),
  },
  raceResult: {
    findMany: vi.fn(async () => [
      { driverId: "d2", position: 2, status: "FINISHED", driver: { id: "d2", name: "Neesh" } },
      { driverId: "d1", position: 1, status: "FINISHED", driver: { id: "d1", name: "Takoda" } },
      { driverId: "d3", position: null, status: "DNF", driver: { id: "d3", name: "DRAS" } },
    ]),
  },
};

const linkHrefs = (block) => (block?.groups || []).flatMap((g) => g.links.map((l) => l.href));

describe("driver page", () => {
  it("states the standings line the page itself shows", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, section: "drivers", id: "d4" });
    expect(b.heading).toBe("Flo · Season 8");
    expect(b.line).toBe("P9 · 24 pts · Ferrari");
  });

  it("links the team and the team-mates, which is what the page links", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, section: "drivers", id: "d4" });
    expect(linkHrefs(b)).toEqual([`${BASE}/constructors/ferrari`, `${BASE}/drivers/d2`]);
  });

  it("says nothing about a driver in an unpublished season", async () => {
    expect(await buildEntityBlock(prisma, { base: BASE, section: "drivers", id: "hidden" })).toBeNull();
  });

  it("is null for a driver that does not exist", async () => {
    expect(await buildEntityBlock(prisma, { base: BASE, section: "drivers", id: "nope" })).toBeNull();
  });
});

describe("team page", () => {
  it("lists the drivers it fielded", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, section: "constructors", id: "ferrari" });
    expect(b.heading).toBe("Ferrari");
    expect(linkHrefs(b)).toEqual([`${BASE}/drivers/d2`]);
  });

  it("answers to /teams/<id> as well, since both addresses render it", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, section: "teams", id: "ferrari" });
    expect(b.heading).toBe("Ferrari");
  });
});

describe("one round", () => {
  it("prints the classification in finishing order", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, section: "races", raceId: "r2" });
    expect(b.heading).toBe("Round 2 · Watkins Glen");
    expect(linkHrefs(b)).toEqual([`${BASE}/drivers/d1`, `${BASE}/drivers/d2`]);
  });

  it("leaves out a car that did not finish, the way the table does", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, section: "races", raceId: "r2" });
    expect(b.line).toBe("2 classified");
    expect(linkHrefs(b)).not.toContain(`${BASE}/drivers/d3`);
  });

  it("is null for a round that does not exist", async () => {
    expect(await buildEntityBlock(prisma, { base: BASE, section: "races", raceId: "nope" })).toBeNull();
  });
});

describe("home", () => {
  it("names the three the title card shows, and only three", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, isHome: true, seasonId: "s8" });
    expect(b.groups[0].links.map((l) => l.label)).toEqual(["P1 Takoda", "P2 Neesh", "P3 DRAS"]);
  });

  it("says nothing when there are no standings yet", async () => {
    expect(await buildEntityBlock(prisma, { base: BASE, isHome: true, seasonId: "s7" })).toBeNull();
  });
});

describe("addresses that are not one of these", () => {
  it("gets nothing rather than something borrowed", async () => {
    expect(await buildEntityBlock(prisma, { base: BASE, section: "drivers", id: null })).toBeNull();
    expect(await buildEntityBlock(prisma, { base: BASE, section: "attendance", id: "x" })).toBeNull();
    expect(await buildEntityBlock(prisma, { base: BASE, section: "races", raceId: null })).toBeNull();
  });
});

// The reserve bucket is not a team, and the page knows it: its head-to-head
// panel collapses at nine and hides the rest behind a button. A block that
// listed all hundred would be shipping links the reader does not get on load,
// on every one of the site's least interesting pages.
describe("a garage with a hundred drivers in it", () => {
  it("stops at the nine the page shows without being asked", async () => {
    const crowd = {
      standings: Array.from({ length: 40 }, (_, i) => ({
        driverId: `r${i}`,
        name: `Reserve ${i}`,
        position: i + 1,
        total: 0,
        team: { id: "reserve" },
      })),
    };
    const big = {
      ...prisma,
      driver: {
        ...prisma.driver,
        findUnique: async () => ({
          id: "r0",
          name: "Reserve 0",
          seasonId: "crowd",
          team: { id: "reserve", name: "Reserve" },
          season: { id: "crowd", number: 8 },
        }),
      },
    };
    const { getDriverStandings } = await import("../services/standingsService.js");
    getDriverStandings.mockImplementationOnce(async () => crowd);
    const b = await buildEntityBlock(big, { base: BASE, section: "drivers", id: "r0" });
    const mates = b.groups.find((g) => g.title === "Team-mates");
    expect(mates.links).toHaveLength(9);
    expect(mates.links[0].label).toBe("Reserve 1"); // the driver themselves is left out
  });
});
