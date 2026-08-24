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

vi.mock("../services/seasonService.js", () => ({
  getPrivateSeasonIds: vi.fn(async () => new Set(["secret"])),
  getSeasonScoring: vi.fn(async () => ({ pointsTable: null })),
}));
vi.mock("../services/pointsCalculator.js", () => ({
  applyPenalties: (rows) => rows,
  // Podium points, enough for the tables to have a Pts column with numbers in
  // it. The real one reads the season's table (services/pointsCalculator).
  getDriverResultPoints: (r) => [25, 18, 15][(r.position ?? 99) - 1] ?? 0,
}));
// The championship tables the blocks read (lib/crawlTables.js talks to these).
vi.mock("./crawlTables.js", () => ({
  seasonStandings: vi.fn(async (_p, seasonId) =>
    seasonId === "s8"
      ? {
          standings: [
            { driverId: "d1", name: "Takoda", position: 1, total: 210, team: { id: "mclaren" }, perRace: { 1: { points: 25, status: "FINISHED", position: 1 } } },
            { driverId: "d2", name: "Neesh", position: 2, total: 180, team: { id: "ferrari" }, perRace: {} },
            { driverId: "d3", name: "DRAS", position: 3, total: 150, team: { id: "mclaren" }, perRace: {} },
            { driverId: "d4", name: "Flo", position: 9, total: 24, team: { id: "ferrari" }, perRace: { 1: { points: 15, status: "FINISHED", position: 3 }, 2: { points: 0, status: "DNF", position: null } } },
          ],
        }
      : null
  ),
  seasonRounds: vi.fn(async (_p, seasonId) =>
    seasonId === "s8" ? new Map([[1, "Hockenheim"], [2, "Watkins Glen"]]) : null
  ),
  constructorStandings: vi.fn(async (_p, seasonId, tier) =>
    seasonId === "s8" && tier === 1
      ? { standings: [{ teamId: "ferrari", name: "Ferrari", position: 3, total: 240 }] }
      : null
  ),
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
      where.id === "ferrari" ? { id: "ferrari", name: "Ferrari", tier: 1, seasonId: "s8" } : null
    ),
  },
  season: {
    findUnique: vi.fn(async ({ where }) =>
      where.id === "s8" ? { number: 8, game: "F1 2010 \u00b7 Assetto Corsa" } : null
    ),
  },
  race: {
    findUnique: vi.fn(async ({ where }) =>
      where.id === "r2"
        ? {
            id: "r2",
            number: 2,
            track: "Watkins Glen",
            seasonId: "s8",
            isSpecialEvent: false,
            season: { number: 8, isPublic: true },
          }
        : null
    ),
    // The home page asks for two different rounds through the same method, so
    // the fake has to tell them apart the way the real query does: the hero
    // card wants the last COMPLETED round, the count-down the next one still to
    // come. Two `findFirst` keys in one object would silently keep the second.
    findFirst: vi.fn(async ({ where }) => {
      if (where.seasonId !== "s8") return null;
      return where.isCompleted
        ? { id: "r2", number: 2, track: "Watkins Glen", seasonId: "s8", isSpecialEvent: false }
        : { id: "r3", number: 3, track: "Spielberg", date: new Date("2026-08-21T17:00:00Z") };
    }),
  },
  raceResult: {
    findMany: vi.fn(async () => [
      { driverId: "d2", position: 2, status: "FINISHED", driver: { id: "d2", name: "Neesh", team: { id: "ferrari", name: "Ferrari" } } },
      { driverId: "d1", position: 1, status: "FINISHED", driver: { id: "d1", name: "Takoda", team: { id: "mclaren", name: "McLaren" } } },
      { driverId: "d3", position: null, status: "DNF", driver: { id: "d3", name: "DRAS", team: null } },
    ]),
  },
};

// Every address a block points at, whichever shape the group came in: a list of
// links, or a table whose cells may be links.
const linkHrefs = (block) =>
  (block?.groups || []).flatMap((g) =>
    g.rows
      ? g.rows.flatMap((row) => row.filter((c) => c?.href).map((c) => c.href))
      : g.links.map((l) => l.href)
  );

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

  it("prints the rounds the driver drove, and what each of them paid", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, section: "drivers", id: "d4" });
    const t = b.groups.find((g) => g.title === "Race by race");
    expect(t.columns).toEqual(["Rnd", "Circuit", "Race", "Pts"]);
    expect(t.rows).toEqual([
      ["1", "Hockenheim", "P3", "15"],
      // A retirement says so rather than inventing a finishing position.
      ["2", "Watkins Glen", "DNF", "0"],
    ]);
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

  it("states the team's own championship line and its drivers' places", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, section: "constructors", id: "ferrari" });
    // The constructor table's row, not the sum of the drivers' points: the drop
    // rule works per driver, so that sum is a number no page shows.
    expect(b.line).toBe("P3 · 240 pts");
    const t = b.groups[0];
    expect(t.columns).toEqual(["Driver", "Pos", "Pts"]);
    expect(t.rows).toEqual([[{ href: `${BASE}/drivers/d2`, label: "Neesh" }, "P2", "180"]]);
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
    // Winner first, and each finisher beside the team they scored for — the
    // page's Pos | Driver | Team | Pts, in its order.
    expect(linkHrefs(b)).toEqual([
      `${BASE}/drivers/d1`,
      `${BASE}/constructors/mclaren`,
      `${BASE}/drivers/d2`,
      `${BASE}/constructors/ferrari`,
    ]);
    const table = b.groups[0];
    expect(table.columns).toEqual(["Pos", "Driver", "Team", "Pts"]);
    expect(table.rows[0][0]).toBe("P1");
    expect(table.rows[0][3]).toBe("25");
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
    const standings = b.groups.find((g) => g.title === "Standings");
    expect(standings.links.map((l) => l.label)).toEqual(["P1 Takoda", "P2 Neesh", "P3 DRAS"]);
  });

  it("prints the podium of the round the hero card is about", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, isHome: true, seasonId: "s8" });
    const hero = b.groups[0];
    expect(hero.title).toBe("Round 2 · Watkins Glen");
    // Three, like the card. The round's own page carries the rest of the field.
    expect(hero.rows).toHaveLength(2); // this round classified two
    expect(hero.rows[0][1].label).toBe("Takoda");
    expect(hero.rows[0][3]).toBe("25");
  });

  // This page had an empty heading and an empty line, so a crawler that does
  // not run JavaScript was handed the front door with no prose on it at all.
  it("says which season is running and what it is driven in", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, isHome: true, seasonId: "s8" });
    expect(b.line).toContain("Season 8");
    expect(b.line).toContain("F1 2010 \u00b7 Assetto Corsa");
  });

  // The heading is the league's strapline, not its scoreboard: it has to answer
  // "what is this site" for somebody who has never heard the name, and it is
  // read off the season's game so a non-F1 season cannot advertise itself as an
  // F1 one. Same two strings the page itself renders (Home.jsx leagueStrapline).
  it("leads with what the league races, and says so in a sentence", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, isHome: true, seasonId: "s8" });
    expect(b.heading).toBe("Formula 1 sim racing on Assetto Corsa");
    expect(b.blurb).toContain("online sim racing league on Assetto Corsa");
    expect(b.blurb).toContain("Formula 1 championships");
  });

  // The count-down NAMES the round, so stating it is a mirror. It does not
  // link the round's own page \u2014 the calendar and the sign-up are what a
  // reader can click there \u2014 so neither does this. Checked in a browser.
  it("names the round it counts down to, and does not link it", async () => {
    const b = await buildEntityBlock(prisma, { base: BASE, isHome: true, seasonId: "s8" });
    expect(b.line).toContain("Round 3 \u00b7 Spielberg \u00b7 21 Aug");
    expect(linkHrefs(b)).not.toContain(`${BASE}/races?race=r3`);
  });

  it("says nothing when there are no standings yet", async () => {
    expect(await buildEntityBlock(prisma, { base: BASE, isHome: true, seasonId: "s7" })).toBeNull();
  });

  // The extras must never cost the block its real content.
  it("still lists the standings when the season and race lookups fail", async () => {
    const broken = {
      ...prisma,
      season: { findUnique: vi.fn(async () => { throw new Error("no season table"); }) },
      race: { ...prisma.race, findFirst: vi.fn(async () => { throw new Error("no race table"); }) },
    };
    const b = await buildEntityBlock(broken, { base: BASE, isHome: true, seasonId: "s8" });
    expect(b.groups[0].links.map((l) => l.label)).toEqual(["P1 Takoda", "P2 Neesh", "P3 DRAS"]);
    // No season row means no game either, so the strapline falls back to the
    // claim that holds without one: the sim, and no discipline.
    expect(b.heading).toBe("Online sim racing on Assetto Corsa");
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
    const { seasonStandings } = await import("./crawlTables.js");
    seasonStandings.mockImplementationOnce(async () => crowd);
    const b = await buildEntityBlock(big, { base: BASE, section: "drivers", id: "r0" });
    const mates = b.groups.find((g) => g.title === "Team-mates");
    expect(mates.links).toHaveLength(9);
    expect(mates.links[0].label).toBe("Reserve 1"); // the driver themselves is left out
  });
});
