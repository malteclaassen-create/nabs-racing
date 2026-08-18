// The championship tables, as the delivered HTML carries them.
//
// The link block fixed "found, never fetched"; this is about what the fetched
// document then SAYS. A crawler that reads /drivers should come away knowing
// that Takoda leads on 210 points for McLaren, not with a list of forty names
// separated by dots — every number on this site is assembled by JavaScript in
// the browser, and a young domain gets little rendering budget.
//
// lib/crawlTables.js (which does the counting) is stubbed here on purpose: what
// is under test is the block that goes out — its shape, its links, and the two
// rules it must not break, which are that a table falls back to the plain list
// when the scoring is unavailable, and that nothing reaches the HTML unescaped.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./siteIndex.js", () => ({
  getSiteIndex: vi.fn(async () => INDEX),
  invalidateSiteIndex: vi.fn(),
}));
vi.mock("./crawlTables.js", () => ({
  driverTable: vi.fn(async () => TABLES.drivers),
  constructorTables: vi.fn(async () => TABLES.teams),
  seasonStandings: vi.fn(async () => null),
  seasonRounds: vi.fn(async () => null),
  constructorStandings: vi.fn(async () => null),
}));

import { buildCrawlLinks } from "./crawlLinks.js";

const BASE = "/s/friday-f1";
const D = (id, label) => ({ href: `${BASE}/drivers/${id}`, label });

let INDEX;
let TABLES;
beforeEach(() => {
  TABLES = {
    drivers: {
      columns: ["Pos", "Driver", "Team", "Pts"],
      rows: [
        ["P1", D("takoda_s8", "Takoda"), { href: `${BASE}/constructors/brawn_s8`, label: "Brawn GP" }, "210"],
        ["P2", D("m1c_s8", "M1C"), { href: `${BASE}/constructors/ferrari_s8`, label: "Ferrari" }, "180"],
      ],
    },
    teams: [
      {
        title: "Season 8 teams",
        columns: ["Pos", "Team", "Pts"],
        rows: [["P1", { href: `${BASE}/constructors/brawn_s8`, label: "Brawn GP" }, "340"]],
      },
    ],
  };
  INDEX = {
    primary: "friday-f1",
    series: [
      {
        slug: "friday-f1",
        base: BASE,
        isPrimary: true,
        seasons: [
          {
            id: "s8",
            number: 8,
            name: "Season 8",
            isActive: true,
            listing: {
              drivers: `${BASE}/drivers`,
              constructors: `${BASE}/constructors`,
              races: `${BASE}/races`,
            },
            drivers: [
              { label: "Takoda", href: `${BASE}/drivers/takoda_s8`, strong: true },
              { label: "M1C", href: `${BASE}/drivers/m1c_s8`, strong: true },
              // Signed up, never drove: below the table, still linked.
              { label: "Tball", href: `${BASE}/drivers/tball_s8`, strong: false },
            ],
            teams: [{ label: "Brawn GP", href: `${BASE}/constructors/brawn_s8`, strong: true }],
            races: [
              {
                label: "Hockenheim",
                href: `${BASE}/races?race=r1`,
                strong: true,
                number: 1,
                date: "2026-08-07T19:00:00.000Z",
              },
              { label: "Watkins Glen", href: `${BASE}/races?race=r2`, strong: true, number: 2, date: null },
            ],
          },
        ],
      },
    ],
  };
});

const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const cells = (html) => [...html.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1]);

describe("the standings a crawler is handed", () => {
  it("writes the championship as a table, with the points on it", async () => {
    const html = await buildCrawlLinks({}, `${BASE}/drivers`, {});
    expect(html).toContain("<table");
    expect(html).toContain("Season 8 drivers");
    // The three facts the page's row carries, in its order.
    expect(cells(html).slice(0, 4).map((c) => c.replace(/<[^>]*>/g, ""))).toEqual([
      "P1",
      "Takoda",
      "Brawn GP",
      "210",
    ]);
  });

  it("links the driver and their team out of the same row", async () => {
    const out = hrefs(await buildCrawlLinks({}, `${BASE}/drivers`, {}));
    expect(out).toContain(`${BASE}/drivers/takoda_s8`);
    expect(out).toContain(`${BASE}/constructors/brawn_s8`);
  });

  it("keeps the reserves linked below the table", async () => {
    // They are not in the championship the table shows (the page hides them
    // behind a click), and the sitemap skips them on purpose — so this block is
    // the only way into their pages, and it must not drop them.
    const html = await buildCrawlLinks({}, `${BASE}/drivers`, {});
    expect(hrefs(html)).toContain(`${BASE}/drivers/tball_s8`);
    expect(html).toContain("Season 8 reserves");
  });

  it("gives the constructors page its own table", async () => {
    const html = await buildCrawlLinks({}, `${BASE}/constructors`, {});
    expect(html).toContain("Season 8 teams");
    expect(cells(html).map((c) => c.replace(/<[^>]*>/g, ""))).toEqual(["P1", "Brawn GP", "340"]);
  });

  it("falls back to the plain list when the scoring cannot be reached", async () => {
    // A standings table that fails to build must cost the page nothing: the
    // links it used to carry are still the links it carries.
    TABLES.drivers = null;
    TABLES.teams = null;
    const html = await buildCrawlLinks({}, `${BASE}/drivers`, {});
    expect(html).not.toContain("<table");
    expect(hrefs(html)).toContain(`${BASE}/drivers/takoda_s8`);
    expect(hrefs(html)).toContain(`${BASE}/drivers/tball_s8`);
  });
});

describe("the calendar a crawler is handed", () => {
  it("names each round by number, circuit and date", async () => {
    const html = await buildCrawlLinks({}, `${BASE}/races`, {});
    const text = cells(html).map((c) => c.replace(/<[^>]*>/g, ""));
    expect(text.slice(0, 3)).toEqual(["1", "Hockenheim", "Fri 07 Aug 2026"]);
    // A round whose date is not fixed yet simply has no date, rather than the
    // string "Invalid Date" the page guards against too.
    expect(text.slice(3)).toEqual(["2", "Watkins Glen", ""]);
    expect(hrefs(html)).toContain(`${BASE}/races?race=r1`);
  });

  it("reads the same for /calendar, the address the app folds onto it", async () => {
    const html = await buildCrawlLinks({}, `${BASE}/calendar`, {});
    expect(html).toContain("Hockenheim");
    expect(html).toContain("<table");
  });
});

describe("what goes into the HTML", () => {
  it("escapes a name and an address the same as everywhere else", async () => {
    TABLES.drivers.rows = [["P1", D('x?a=1&b=2"', 'Bobby <script>"&'), "", "0"]];
    const html = await buildCrawlLinks({}, `${BASE}/drivers`, {});
    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp;b=2");
  });
});
