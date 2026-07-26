// Titles and descriptions for the listing pages and for a single round.
//
// These are what a search result says about the ~100 rounds and 7 seasons of
// tables that only became addresses of their own with this change, so the tests
// hold two lines: a page must say which season it is showing (otherwise the
// archive looks like seven copies of one page), and a round's podium must match
// the classification the site itself shows, penalties and all.
import { describe, it, expect, vi } from "vitest";
import { buildPageMeta, prettyTrack } from "./pageMeta.js";

const SERIES = { id: "series1", name: "F1 Friday", slug: "friday-f1", order: 0, isActive: 1, isPublic: 1 };
const SEASONS = [
  { id: "s7", number: 7, name: "Season 7", game: "F1 2007 · Assetto Corsa", isActive: true },
  { id: "s3", number: 3, name: "Season 3", game: "F1 2013 · Assetto Corsa", isActive: false },
];
const RACES = [
  { id: "r1", number: 1, track: "Melbourne", date: "2026-05-01T17:00:00.000Z", isCompleted: true, seasonId: "s7" },
  { id: "r12", number: 12, track: "interlagos", date: "2026-07-10T00:00:00.000Z", isCompleted: true, seasonId: "s7" },
  { id: "r13", number: 13, track: "Suzuka", date: "2026-08-07T17:00:00.000Z", isCompleted: false, seasonId: "s7" },
  { id: "sp", number: null, track: "Nordschleife", date: "2026-06-05T17:00:00.000Z", isCompleted: false, seasonId: "s7" },
];
// Round 12 with a time penalty that changes the order: Duck crosses the line
// first but takes +5s, so the site classifies Pizd ahead. The snippet has to
// agree with that, not with the raw finishing order.
const RESULTS = {
  r1: [
    { driverId: "bot", position: 1, status: "FINISHED", driver: { id: "bot", name: "13bot" } },
    { driverId: "tball", position: 2, status: "FINISHED", driver: { id: "tball", name: "Tball" } },
    { driverId: "sig", position: 3, status: "FINISHED", driver: { id: "sig", name: "Siggsta" } },
    { driverId: "out", position: 4, status: "DNF", driver: { id: "out", name: "Duck" } },
  ],
  r12: [
    { driverId: "duck", position: 1, status: "FINISHED", totalTimeMs: 3_600_000, penaltySeconds: 5, driver: { id: "duck", name: "Duck" } },
    { driverId: "pizd", position: 2, status: "FINISHED", totalTimeMs: 3_602_000, penaltySeconds: 0, driver: { id: "pizd", name: "Pizd" } },
    { driverId: "tak", position: 3, status: "FINISHED", totalTimeMs: 3_610_000, penaltySeconds: 0, driver: { id: "tak", name: "Takoda" } },
  ],
};

function fakePrisma() {
  return {
    $queryRawUnsafe: vi.fn(async (sql, ...args) => {
      if (/FROM "Series"/.test(sql)) return [SERIES];
      if (/FROM "Season"/.test(sql) && /"number" = \?/.test(sql)) {
        const s = SEASONS.find((x) => x.number === Number(args[0]));
        return s ? [{ id: s.id }] : [];
      }
      if (/FROM "Season"/.test(sql) && /"seriesId" = \?/.test(sql)) return SEASONS.map((s) => ({ id: s.id }));
      return [];
    }),
    season: {
      findFirst: vi.fn(async ({ where } = {}) =>
        where?.isActive ? SEASONS.find((s) => s.isActive) : SEASONS[0]
      ),
      findMany: vi.fn(async () => SEASONS),
      findUnique: vi.fn(async ({ where }) => SEASONS.find((s) => s.id === where.id) || null),
    },
    race: {
      findFirst: vi.fn(async ({ where }) =>
        RACES.find((r) => r.id === where.id && r.seasonId === where.seasonId) || null
      ),
      findMany: vi.fn(async () => RACES.filter((r) => r.number != null)),
    },
    raceResult: {
      findMany: vi.fn(async ({ where }) => RESULTS[where.raceId] || []),
    },
    driver: { findUnique: vi.fn(async () => null) },
    team: { findUnique: vi.fn(async () => null) },
  };
}

const meta = (path, query) => buildPageMeta(fakePrisma(), path, query);

describe("listing page meta", () => {
  it("names the section and the season it is showing", async () => {
    const m = await meta("/s/friday-f1/drivers");
    expect(m.title).toBe("Season 7 driver standings · NABS Racing League");
    expect(m.description).toContain("Season 7");
  });

  it("distinguishes an archived season from the current one", async () => {
    const current = await meta("/s/friday-f1/drivers");
    const archive = await meta("/s/friday-f1/drivers", { season: 3 });
    expect(archive.title).toBe("Season 3 driver standings · NABS Racing League");
    expect(archive.title).not.toBe(current.title);
    expect(archive.description).not.toBe(current.description);
  });

  it("gives each section a title of its own", async () => {
    const titles = await Promise.all(
      ["drivers", "constructors", "races", "records", "live"].map((s) => meta(`/s/friday-f1/${s}`))
    );
    const set = new Set(titles.map((t) => t.title));
    expect(set.size).toBe(5);
  });

  it("says the same thing for a page's second name as for its first", async () => {
    // /results and /calendar are /races; the canonical folds them together, so
    // two different titles would undo that.
    const races = await meta("/s/friday-f1/races");
    for (const alias of ["results", "calendar"]) {
      expect((await meta(`/s/friday-f1/${alias}`)).title).toBe(races.title);
    }
    const teams = await meta("/s/friday-f1/teams");
    expect(teams.title).toBe((await meta("/s/friday-f1/constructors")).title);
  });

  it("leaves the Hall of Fame out of the season wording", async () => {
    // It is all-time, so a season in its title would be a claim about the page
    // that is not true.
    const m = await meta("/s/friday-f1/records", { season: 3 });
    expect(m.title).not.toContain("Season 3");
  });

  it("refuses a season that does not exist rather than inventing a page", async () => {
    expect(await meta("/s/friday-f1/drivers", { season: 99 })).toBe(null);
  });

  it("has nothing to say about the member-only areas", async () => {
    expect(await meta("/s/friday-f1/nonsense")).toBe(null);
    expect(await meta("/downloads")).toBe(null);
    expect(await meta("/profile")).toBe(null);
  });

  it("describes /join exactly as it describes the root", async () => {
    // The two render one page and the canonical folds them together, so a
    // different title on /join would have the page contradict its own canonical.
    const root = await meta("/");
    const join = await meta("/join");
    expect(join).toEqual(root);
    expect(join.title).toContain("Assetto Corsa");
  });
});

describe("single round meta", () => {
  it("names the winner, the round and the circuit", async () => {
    const m = await meta("/s/friday-f1/races", { race: "r1" });
    expect(m.title).toBe("Melbourne results · Round 1, Season 7 · NABS Racing League");
    expect(m.description).toContain("13bot won Round 1 of Season 7 at Melbourne");
    expect(m.description).toContain("ahead of Tball and Siggsta");
  });

  it("classifies the podium the way the site does, penalties applied", async () => {
    const m = await meta("/s/friday-f1/races", { race: "r12" });
    // Duck crossed the line first but carries +5s: Pizd is the winner.
    expect(m.description).toContain("Pizd won Round 12");
    expect(m.description).not.toContain("Duck won");
  });

  it("leaves a non-finisher off the podium", async () => {
    const m = await meta("/s/friday-f1/races", { race: "r1" });
    expect(m.description).not.toContain("Duck");
  });

  it("tidies a track name typed in lowercase", async () => {
    const m = await meta("/s/friday-f1/races", { race: "r12" });
    expect(m.title).toContain("Interlagos");
    expect(m.title).not.toContain("interlagos");
  });

  // Every one of these is a real name out of the league's own archive.
  it.each([
    ["interlagos", "Interlagos"],
    ["KYALAMI", "Kyalami"],
    ["ROAD AMERICA", "Road America"],
    ["ISTANBUL PARK", "Istanbul Park"],
    ["RED BULL RING", "Red Bull Ring"],
    ["MAGNY-COURS", "Magny-Cours"],
    ["LE MANS", "Le Mans"],
    ["SPA", "Spa"],
    ["COTA", "COTA"], // an abbreviation, not a shouted word
    ["Monza", "Monza"],
    ["Autodromo di Monza", "Autodromo di Monza"],
    ["Hermanos Rodríguez", "Hermanos Rodríguez"],
    ["Test GP (Feature-Test)", "Test GP (Feature-Test)"],
    ["", ""],
  ])("writes %s as %s", (raw, expected) => {
    expect(prettyTrack(raw)).toBe(expected);
  });

  it("invites sign-ups for a round that has not run", async () => {
    const m = await meta("/s/friday-f1/races", { race: "r13" });
    expect(m.title).toBe("Suzuka · Round 13, Season 7 · NABS Racing League");
    expect(m.description).toContain("Round 13 of Season 7 at Suzuka on 7 August");
    expect(m.description).toContain("sign-up");
    expect(m.description).not.toContain("won");
  });

  it("names a special event for what it is, having no round number", async () => {
    const m = await meta("/s/friday-f1/races", { race: "sp" });
    expect(m.title).toContain("Special event, Season 7");
    expect(m.description).toContain("A special event in Season 7 at Nordschleife");
  });

  it("falls back to the calendar page for a round that is not there", async () => {
    const m = await meta("/s/friday-f1/races", { race: "nope" });
    expect(m.title).toBe("Season 7 results and race calendar · NABS Racing League");
  });

  it("keeps titles and descriptions inside what a search result shows", async () => {
    for (const race of ["r1", "r12", "r13", "sp"]) {
      const m = await meta("/s/friday-f1/races", { race });
      expect(m.description.length).toBeLessThanOrEqual(160);
      expect(m.description.endsWith(".")).toBe(true);
    }
  });
});
