// The two halves of the indexing fix, and the one rule that ties them together.
//
// sitemap.xml argues for a short list of pages that can win; the pre-rendered
// link block mirrors whatever the requested page actually shows. Those are
// different jobs on purpose, and the tests that matter most here are the ones
// where the two are supposed to DISAGREE: a reserve who never started belongs in
// the block (the page lists them, and showing a crawler less than a reader is
// cloaking) and not in the sitemap (it is a page with nothing on it).
import { describe, it, expect, vi, beforeEach } from "vitest";

// Both units read lib/siteIndex.js, which is the part that talks to the
// database. Fixing its answer here keeps these tests about the selection and
// the rendering, which is where the decisions live.
vi.mock("./siteIndex.js", () => ({
  getSiteIndex: vi.fn(async () => INDEX),
  invalidateSiteIndex: vi.fn(),
}));

import { buildSitemapXml, isCrawlable, buildRobotsTxt } from "./sitemap.js";
import { buildCrawlLinks, applyCrawlLinks } from "./crawlLinks.js";

const season8 = {
  number: 8,
  name: "Season 8",
  isActive: true,
  listing: {
    drivers: "/s/friday-f1/drivers",
    constructors: "/s/friday-f1/constructors",
    races: "/s/friday-f1/races",
  },
  drivers: [
    { label: "Tball", href: "/s/friday-f1/drivers/tball_s8", strong: false }, // reserve, never started
    { label: "M1C", href: "/s/friday-f1/drivers/m1c_s8", strong: true },
  ],
  teams: [
    { label: "Reserve", href: "/s/friday-f1/constructors/reserve_s8", strong: false },
    { label: "Ferrari", href: "/s/friday-f1/constructors/ferrari_s8", strong: true },
  ],
  races: [
    { label: "Monza", href: "/s/friday-f1/races?race=r1", strong: true },
    { label: "Spa", href: "/s/friday-f1/races?race=r2", strong: false }, // not run yet
  ],
};

const season7 = {
  number: 7,
  name: "Season 7",
  isActive: false,
  listing: {
    drivers: "/s/friday-f1/drivers?season=7",
    constructors: "/s/friday-f1/constructors?season=7",
    races: "/s/friday-f1/races?season=7",
  },
  drivers: [{ label: "Zer0n1k", href: "/s/friday-f1/drivers/zer0n1k", strong: true }],
  teams: [{ label: "McLaren", href: "/s/friday-f1/constructors/mclaren", strong: true }],
  races: [{ label: "Imola", href: "/s/friday-f1/races?season=7&race=r9", strong: true }],
};

let INDEX;
beforeEach(() => {
  INDEX = {
    primary: "friday-f1",
    series: [
      { slug: "friday-f1", base: "/s/friday-f1", isPrimary: true, seasons: [season8, season7] },
    ],
  };
});

const locs = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

describe("sitemap.xml", () => {
  it("offers the season being raced, down to the driver", async () => {
    const urls = locs(await buildSitemapXml({}, "https://x.test"));
    expect(urls).toContain("https://x.test/");
    expect(urls).toContain("https://x.test/s/friday-f1/drivers");
    expect(urls).toContain("https://x.test/s/friday-f1/drivers/m1c_s8");
    expect(urls).toContain("https://x.test/s/friday-f1/constructors/ferrari_s8");
    expect(urls).toContain("https://x.test/s/friday-f1/races?race=r1");
  });

  it("leaves out the pages with nothing on them", async () => {
    const urls = locs(await buildSitemapXml({}, "https://x.test"));
    // A reserve who has never started: the page renders "P90 · 0 pts" and stops.
    expect(urls).not.toContain("https://x.test/s/friday-f1/drivers/tball_s8");
    // Tier 0 is the reserve pool, not a constructor.
    expect(urls).not.toContain("https://x.test/s/friday-f1/constructors/reserve_s8");
    // A round that has not been driven yet has a date and nothing else.
    expect(urls).not.toContain("https://x.test/s/friday-f1/races?race=r2");
    // The live page is empty between race nights.
    expect(urls.some((u) => u.endsWith("/live"))).toBe(false);
  });

  it("offers the archive as three tables per season, not as hundreds of pages", async () => {
    const urls = locs(await buildSitemapXml({}, "https://x.test"));
    expect(urls).toContain("https://x.test/s/friday-f1/drivers?season=7");
    expect(urls).toContain("https://x.test/s/friday-f1/constructors?season=7");
    expect(urls).toContain("https://x.test/s/friday-f1/races?season=7");
    // The finished season's own driver, team and race pages stay out: reachable
    // from those tables and from the link block, just not argued for here.
    expect(urls).not.toContain("https://x.test/s/friday-f1/drivers/zer0n1k");
    expect(urls).not.toContain("https://x.test/s/friday-f1/constructors/mclaren");
    expect(urls.some((u) => u.includes("race=r9"))).toBe(false);
  });

  it("does not offer the primary series under its long address as well", async () => {
    const urls = locs(await buildSitemapXml({}, "https://x.test"));
    // The root already IS this page, and the canonical tag says the short one wins.
    expect(urls).not.toContain("https://x.test/s/friday-f1");
  });

  it("does offer a second series' home, which is a page of its own", async () => {
    INDEX.series.push({
      slug: "sunday-gt",
      base: "/s/sunday-gt",
      isPrimary: false,
      seasons: [{ ...season8, listing: { drivers: "/s/sunday-gt/drivers", constructors: "/s/sunday-gt/constructors", races: "/s/sunday-gt/races" }, drivers: [], teams: [], races: [] }],
    });
    const urls = locs(await buildSitemapXml({}, "https://x.test"));
    expect(urls).toContain("https://x.test/s/sunday-gt");
  });

  it("escapes the & in a round's address so the file still parses", async () => {
    const xml = await buildSitemapXml({}, "https://x.test");
    INDEX.series[0].seasons = [season7];
    const archive = await buildSitemapXml({}, "https://x.test");
    expect(xml).not.toContain("&race=");
    expect(archive).not.toMatch(/<loc>[^<]*[^p;]&[a-z]/);
  });

  it("falls back to the flat paths for a database from before the series model", async () => {
    INDEX = { primary: null, series: [] };
    const urls = locs(await buildSitemapXml({}, "https://x.test"));
    expect(urls).toContain("https://x.test/drivers");
    expect(urls).toContain("https://x.test/races");
  });
});

describe("the pre-rendered link block", () => {
  const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

  it("spends the primary series' Home link on the canonical address", async () => {
    // The footer builds this one as /s/<slug>; the canonical tag says the root
    // is what that page is called, so the block follows the canonical.
    expect(hrefs(await buildCrawlLinks({}, "/", {}))).toContain("/");
    expect(hrefs(await buildCrawlLinks({}, "/", {}))).not.toContain("/s/friday-f1");
    // A second series' home is a page in its own right and keeps its address.
    INDEX.series[0].isPrimary = false;
    expect(hrefs(await buildCrawlLinks({}, "/s/friday-f1/drivers", {}))).toContain("/s/friday-f1");
  });

  it("carries the footer's links on every page", async () => {
    const html = await buildCrawlLinks({}, "/", {});
    const out = hrefs(html);
    // The footer's links, minus the one address a crawler may not fetch.
    for (const h of [
      "/s/friday-f1/drivers",
      "/s/friday-f1/constructors",
      "/s/friday-f1/races",
      "/s/friday-f1/attendance",
      "/s/friday-f1/live",
      "/join",
    ]) {
      expect(out).toContain(h);
    }
  });

  it("does not link the one page robots.txt forbids", async () => {
    // Race Info is member-only and Disallow'd (lib/sitemap.js). A link to it on
    // every page of the site says only that this site links pages Google is not
    // allowed to have; the reader still reaches it from the footer.
    const out = hrefs(await buildCrawlLinks({}, "/", {}));
    expect(out).not.toContain("/downloads");
    expect(isCrawlable("/downloads")).toBe(false);
  });

  it("lists the drivers the drivers page lists — including the ones the sitemap skips", async () => {
    const html = await buildCrawlLinks({}, "/s/friday-f1/drivers", {});
    expect(hrefs(html)).toContain("/s/friday-f1/drivers/m1c_s8");
    // The page shows this reserve, so the block does too. Showing a crawler
    // less than a reader is the one thing this must never do.
    expect(hrefs(html)).toContain("/s/friday-f1/drivers/tball_s8");
    expect(html).toContain("Tball");
  });

  it("follows ?season= to the season the page is actually showing", async () => {
    const html = await buildCrawlLinks({}, "/s/friday-f1/drivers", { season: "7" });
    expect(hrefs(html)).toContain("/s/friday-f1/drivers/zer0n1k");
    expect(hrefs(html)).not.toContain("/s/friday-f1/drivers/m1c_s8");
    expect(html).toContain("Season 7 drivers");
  });

  it("gives the rounds on the races page and the teams on the constructors page", async () => {
    const races = await buildCrawlLinks({}, "/s/friday-f1/races", {});
    expect(hrefs(races)).toContain("/s/friday-f1/races?race=r1");
    expect(races).toContain("Monza");
    const teams = await buildCrawlLinks({}, "/s/friday-f1/constructors", {});
    expect(hrefs(teams)).toContain("/s/friday-f1/constructors/ferrari_s8");
  });

  it("reads the aliases the app folds onto one page", async () => {
    const calendar = await buildCrawlLinks({}, "/s/friday-f1/calendar", {});
    expect(hrefs(calendar)).toContain("/s/friday-f1/races?race=r1");
    const teams = await buildCrawlLinks({}, "/s/friday-f1/teams", {});
    expect(hrefs(teams)).toContain("/s/friday-f1/constructors/ferrari_s8");
  });

  it("offers the other seasons where the page has a season switcher", async () => {
    const listing = await buildCrawlLinks({}, "/s/friday-f1/drivers", {});
    expect(hrefs(listing)).toContain("/s/friday-f1/drivers?season=7");
    // A driver's own page has no switcher, so it gets no season links.
    const entity = await buildCrawlLinks({}, "/s/friday-f1/drivers/m1c_s8", {});
    expect(hrefs(entity)).not.toContain("/s/friday-f1/drivers?season=7");
  });

  it("does not put the whole driver list on a single driver's page", async () => {
    const html = await buildCrawlLinks({}, "/s/friday-f1/drivers/m1c_s8", {});
    // That page shows one driver; the block shows the footer links and stops.
    expect(hrefs(html)).not.toContain("/s/friday-f1/drivers/tball_s8");
    expect(hrefs(html)).toContain("/s/friday-f1/drivers");
  });

  it("stays out of the areas robots.txt turns away", async () => {
    expect(await buildCrawlLinks({}, "/admin", {})).toBe("");
    expect(await buildCrawlLinks({}, "/profile", {})).toBe("");
    expect(await buildCrawlLinks({}, "/downloads", {})).toBe("");
    expect(isCrawlable("/s/friday-f1/drivers")).toBe(true);
    expect(isCrawlable("/admin/seasons")).toBe(false);
  });

  it("escapes what it writes into the HTML", async () => {
    INDEX.series[0].seasons[0].drivers = [
      { label: 'Bobby <script>"&', href: "/s/friday-f1/drivers/x?a=1&b=2", strong: true },
    ];
    const html = await buildCrawlLinks({}, "/s/friday-f1/drivers", {});
    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp;b=2");
  });
});

// A blanket "Disallow: /api/" is what put the site at Soft 404: Googlebot obeys
// robots.txt for the requests a page MAKES, and every page here loads its content
// from that API. These tests answer the only question that matters about the
// file — would a crawler be allowed to fetch this? — by resolving it the way a
// robots parser does: longest matching rule wins.
function crawlerMayFetch(robots, path) {
  let best = { length: -1, allow: true };
  for (const line of robots.split("\n")) {
    const m = /^(Allow|Disallow):\s*(\S+)/.exec(line.trim());
    if (!m) continue;
    const [, kind, rule] = m;
    // Ties go to Allow, same as Google's parser.
    if (path.startsWith(rule) && rule.length >= best.length) {
      best = { length: rule.length, allow: kind === "Allow" || (rule.length === best.length && best.allow) };
    }
  }
  return best.allow;
}

describe("robots.txt", () => {
  const robots = buildRobotsTxt("https://x.test");

  it("lets a crawler fetch everything a public page needs to render", () => {
    // Observed on the live site: without these the page renders empty.
    for (const p of [
      "/api/standings/drivers?season=8",
      "/api/standings/constructors/t1",
      "/api/standings/records",
      "/api/races?season=8",
      "/api/races/abc123/results",
      "/api/drivers/13bot_s8/profile",
      "/api/drivers/13bot_s8/rating",
      "/api/teams",
      "/api/seasons",
      "/api/series",
      "/api/tracks/countries",
      "/api/events/open",
      "/api/live/status",
      "/api/settings/social",
      "/api/uploads/avatars/13bot_s8.jpg",
    ]) {
      expect([p, crawlerMayFetch(robots, p)]).toEqual([p, true]);
    }
  });

  it("keeps everything else in the API shut", () => {
    for (const p of [
      "/api/admin/seasons",
      "/api/auth/discord/callback",
      "/api/me/rating/history",
      "/api/me/cockpit",
      "/api/downloads/12",
      "/api/feedback",
      "/api/notifications",
      "/api/market/offers",
      "/api/search/admin",
      "/api/hit",
    ]) {
      expect([p, crawlerMayFetch(robots, p)]).toEqual([p, false]);
    }
  });

  it("still turns crawlers away from the member-only pages", () => {
    for (const p of ["/admin", "/profile", "/feedback", "/cockpit", "/cards", "/downloads", "/tools", "/auth/discord"]) {
      expect([p, crawlerMayFetch(robots, p)]).toEqual([p, false]);
    }
    expect(crawlerMayFetch(robots, "/s/friday-f1/drivers")).toBe(true);
    expect(crawlerMayFetch(robots, "/")).toBe(true);
  });

  it("names the sitemap", () => {
    expect(robots).toContain("Sitemap: https://x.test/sitemap.xml");
  });
});

describe("applyCrawlLinks", () => {
  const shell = '<!doctype html><html><body>\n    <div id="root"></div>\n  </body></html>';

  it("puts the block inside the element React later clears", () => {
    const out = applyCrawlLinks(shell, "<p>links</p>");
    expect(out).toContain('<div id="root"><p>links</p></div>');
  });

  it("leaves the page untouched when there is nothing to add", () => {
    expect(applyCrawlLinks(shell, "")).toBe(shell);
  });
});

// The boundary between the two halves, which is the one that can get the site
// removed from the index rather than added to it.
//
// A driver's page renders ONE driver. The block it gets must be that driver's
// facts and that driver's links — never the four hundred links the driver LIST
// page gets, however good four hundred internal links would look. Same for a
// team, and same for a single round.
describe("a page about one thing is not the list it came from", () => {
  const nobody = {}; // buildEntityBlock swallows its own errors and returns null

  it("gives a driver's own page no season driver list", async () => {
    const html = await buildCrawlLinks(nobody, "/s/friday-f1/drivers/m1c_s8", {});
    expect(html).not.toContain("/s/friday-f1/drivers/tball_s8");
    expect(html).not.toContain("Season 8 drivers");
    expect(html).toContain("/s/friday-f1/drivers"); // the footer's Drivers link stays
  });

  it("gives a team's own page no season team list", async () => {
    const html = await buildCrawlLinks(nobody, "/s/friday-f1/constructors/ferrari_s8", {});
    expect(html).not.toContain("Season 8 teams");
    expect(html).not.toContain("/s/friday-f1/constructors/reserve_s8");
  });

  it("gives one round no list of the season's rounds", async () => {
    const html = await buildCrawlLinks(nobody, "/s/friday-f1/races", { race: "r1" });
    expect(html).not.toContain("Season 8 rounds");
    expect(html).not.toContain("race=r2");
  });

  // The driver entries themselves are asserted further up; an earlier test in
  // this file rewrites them to check escaping, so this one asks only that the
  // list group is still built for the address that renders a list.
  it("still gives the listing pages their lists", async () => {
    const html = await buildCrawlLinks(nobody, "/s/friday-f1/drivers", {});
    expect(html).toContain("Season 8 drivers");
    expect(html).toContain("Seasons");
  });

  it("still gives the season's rounds to the races page with no round chosen", async () => {
    const html = await buildCrawlLinks(nobody, "/s/friday-f1/races", {});
    expect(html).toContain("Season 8 rounds");
  });
});
