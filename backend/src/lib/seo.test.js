// The canonical address of a page. This decides which of several spellings of
// the same page a search engine keeps, and equally which query parameters name a
// page of their OWN: an archived season's tables (?season=<n>) and a single
// round (?race=<id>) are the site's two biggest groups of content, and both live
// behind a parameter.
//
// Getting this wrong is expensive in both directions. Keep too much and one page
// multiplies into endless near-duplicates; keep too little and a hundred race
// results share one address. Hence the tests.
import { describe, it, expect, vi } from "vitest";
import { canonicalUrl, applyCanonical, legacyRedirects, seasonLabel } from "./seo.js";

// Just enough Prisma for the two lookups canonicalUrl makes: the primary series
// (to fold its home onto "/") and the active season number (to drop a parameter
// naming the season the page shows anyway). Series and season ids come from raw
// SQL in the real thing, so the fake answers by inspecting the statement.
function fakePrisma({ slug = "friday-f1", active = 7 } = {}) {
  const series = { id: "series1", name: "F1 Friday", slug, order: 0, isActive: 1, isPublic: 1 };
  const season = active == null ? null : { id: "season-x", number: active, isActive: true };
  return {
    $queryRawUnsafe: vi.fn(async (sql) => {
      if (/FROM "Series"/.test(sql)) return [series];
      if (/FROM "Season"/.test(sql) && /"seriesId"/.test(sql)) return season ? [{ id: season.id }] : [];
      return [];
    }),
    season: {
      findFirst: vi.fn(async ({ where } = {}) => (where?.isActive && season ? season : null)),
      findMany: vi.fn(async () => (season ? [season] : [])),
    },
  };
}

// A request as Express hands it over.
const req = (url, host = "nabsracing.com") => {
  const [path, search = ""] = url.split("?");
  const query = Object.fromEntries(new URLSearchParams(search));
  return { protocol: "https", path, query, get: () => host };
};

const canonical = (url, opts) => canonicalUrl(req(url), fakePrisma(opts));

describe("seasonLabel", () => {
  // The name is free text, and seasons routinely arrive with nothing but their
  // number in it. That reads fine in the switcher and nowhere else: the page
  // title came out as "8 driver standings".
  it("puts the word in front of a name that is only digits", () => {
    expect(seasonLabel({ name: "8", number: 8 })).toBe("Season 8");
    expect(seasonLabel({ name: " 8 ", number: 8 })).toBe("Season 8");
  });

  it("leaves a name the admin actually typed alone", () => {
    expect(seasonLabel({ name: "Winter Series", number: 9 })).toBe("Winter Series");
    expect(seasonLabel({ name: "Season 3", number: 3 })).toBe("Season 3");
    expect(seasonLabel({ name: "F1 2010", number: 8 })).toBe("F1 2010");
  });

  it("falls back to the number, and says nothing without one", () => {
    expect(seasonLabel({ name: "", number: 4 })).toBe("Season 4");
    expect(seasonLabel({ name: null, number: null })).toBeNull();
    expect(seasonLabel(null)).toBeNull();
  });
});

describe("canonicalUrl", () => {
  it("keeps a plain page as it is", async () => {
    expect(await canonical("/s/friday-f1/drivers")).toBe("https://nabsracing.com/s/friday-f1/drivers");
  });

  it("folds the primary series' home onto the root", async () => {
    expect(await canonical("/s/friday-f1")).toBe("https://nabsracing.com/");
    expect(await canonical("/")).toBe("https://nabsracing.com/");
  });

  it("folds /join onto the root, which renders the same page to a crawler", async () => {
    // /join exists so the newcomer page can be linked and reached while signed
    // in. A crawler is never signed in, so it sees that page at "/" too, and the
    // root is the address other sites link to.
    expect(await canonical("/join")).toBe("https://nabsracing.com/");
  });

  it("gives an archived season's tables an address of their own", async () => {
    expect(await canonical("/s/friday-f1/drivers?season=3")).toBe(
      "https://nabsracing.com/s/friday-f1/drivers?season=3"
    );
  });

  it("drops the season parameter when it names the season the page shows anyway", async () => {
    // Otherwise /drivers and /drivers?season=7 compete for the same content.
    expect(await canonical("/s/friday-f1/drivers?season=7", { active: 7 })).toBe(
      "https://nabsracing.com/s/friday-f1/drivers"
    );
  });

  it("gives a single round an address of its own", async () => {
    expect(await canonical("/s/friday-f1/races?race=abc123")).toBe(
      "https://nabsracing.com/s/friday-f1/races?race=abc123"
    );
  });

  it("spells a round of an archived season one way only", async () => {
    // The sitemap writes this exact string. Parameter order is part of it.
    const expected = "https://nabsracing.com/s/friday-f1/races?season=5&race=abc123";
    expect(await canonical("/s/friday-f1/races?season=5&race=abc123")).toBe(expected);
    expect(await canonical("/s/friday-f1/races?race=abc123&season=5")).toBe(expected);
  });

  it("folds a page's second name onto its first", async () => {
    // /races, /results and /calendar are one page in the route table.
    for (const alias of ["results", "calendar"]) {
      expect(await canonical(`/s/friday-f1/${alias}`)).toBe("https://nabsracing.com/s/friday-f1/races");
    }
    expect(await canonical("/s/friday-f1/teams")).toBe("https://nabsracing.com/s/friday-f1/constructors");
    expect(await canonical("/s/friday-f1/teams/ferrari")).toBe(
      "https://nabsracing.com/s/friday-f1/constructors/ferrari"
    );
  });

  it("strips parameters that select nothing", async () => {
    for (const junk of ["dl=12", "tour=my-rating", "demo=1", "utm_source=discord", "foo=bar"]) {
      expect(await canonical(`/s/friday-f1/drivers?${junk}`)).toBe(
        "https://nabsracing.com/s/friday-f1/drivers"
      );
    }
  });

  it("ignores a season parameter on a page that has no seasons", async () => {
    // The Hall of Fame is all-time; live timing is now.
    expect(await canonical("/s/friday-f1/records?season=3")).toBe(
      "https://nabsracing.com/s/friday-f1/records"
    );
    expect(await canonical("/s/friday-f1/live?season=3")).toBe("https://nabsracing.com/s/friday-f1/live");
  });

  it("ignores a race parameter anywhere but the races page", async () => {
    expect(await canonical("/s/friday-f1/drivers?race=abc123")).toBe(
      "https://nabsracing.com/s/friday-f1/drivers"
    );
  });

  it("ignores parameters on a page that already names what it shows", async () => {
    expect(await canonical("/s/friday-f1/drivers/mtimmis_s5?season=5")).toBe(
      "https://nabsracing.com/s/friday-f1/drivers/mtimmis_s5"
    );
  });

  it("refuses a made-up season or race rather than minting an address for it", async () => {
    for (const bad of ["season=0", "season=-2", "season=abc", "season=1.5"]) {
      expect(await canonical(`/s/friday-f1/drivers?${bad}`)).toBe(
        "https://nabsracing.com/s/friday-f1/drivers"
      );
    }
    for (const bad of ["race=", "race=a b", "race=" + "x".repeat(65), "race=../../etc"]) {
      expect(await canonical(`/s/friday-f1/races?${bad}`)).toBe("https://nabsracing.com/s/friday-f1/races");
    }
  });

  it("writes a two-parameter address so an HTML parser reads it whole", async () => {
    const html = applyCanonical(
      '<head><meta property="og:url" content="https://nabsracing.com/" /></head>',
      "https://nabsracing.com/s/friday-f1/races?season=5&race=abc"
    );
    expect(html).toContain('href="https://nabsracing.com/s/friday-f1/races?season=5&amp;race=abc"');
    expect(html).toContain('content="https://nabsracing.com/s/friday-f1/races?season=5&amp;race=abc"');
    // Never a bare "&", which a parser may read as the start of an entity.
    expect(/href="[^"]*[^p]&[^a]/.test(html)).toBe(false);
  });

  it("drops a trailing slash", async () => {
    expect(await canonical("/s/friday-f1/drivers/")).toBe("https://nabsracing.com/s/friday-f1/drivers");
  });

  it("keeps working when the season lookup comes back empty", async () => {
    // A fresh database with no active season must not lose the parameter, or the
    // archive would collapse onto one page again. Its own slug, because the
    // active-season lookup is cached per series.
    expect(
      await canonical("/s/fresh-league/drivers?season=3", { slug: "fresh-league", active: null })
    ).toBe("https://nabsracing.com/s/fresh-league/drivers?season=3");
  });
});

// A series slug is not an id like a driver's. There are two of them, they are
// frozen when the series is created, and until this check existed EVERY page
// had unlimited spellings: /s/<anything>/drivers answered 200 with the real
// driver table and a canonical tag naming the made-up address as official.
describe("seriesSlugKnown", () => {
  // Each test gets its own module instance: the slug set is cached for five
  // minutes, and a cache shared across tests would answer with the wrong series.
  const fresh = async () => {
    vi.resetModules();
    return (await import("./seo.js")).seriesSlugKnown;
  };
  const prismaWith = (slugs) => ({
    $queryRawUnsafe: vi.fn(async (sql) =>
      /FROM "Series"/.test(sql)
        ? slugs.map((slug, i) => ({ id: `s${i}`, name: slug, slug, order: i, isActive: i === 0 ? 1 : 0, isPublic: 1 }))
        : []
    ),
  });

  it("accepts a series that exists", async () => {
    const known = await fresh();
    expect(await known(prismaWith(["friday-f1"]), "/s/friday-f1/drivers")).toBe(true);
  });

  it("rejects a slug no series has", async () => {
    const known = await fresh();
    expect(await known(prismaWith(["friday-f1"]), "/s/f1-friday/drivers")).toBe(false);
  });

  it("rejects it on the series home too, not only on a section", async () => {
    const known = await fresh();
    expect(await known(prismaWith(["friday-f1"]), "/s/typo")).toBe(false);
  });

  it("is case sensitive, because the slug is", async () => {
    const known = await fresh();
    expect(await known(prismaWith(["friday-f1"]), "/s/FRIDAY-F1/drivers")).toBe(false);
  });

  it("accepts a PRIVATE series: members see those pages, it is not a typo", async () => {
    const known = await fresh();
    const prisma = {
      $queryRawUnsafe: vi.fn(async (sql) =>
        /FROM "Series"/.test(sql)
          ? [
              { id: "a", name: "F1 Friday", slug: "friday-f1", order: 0, isActive: 1, isPublic: 1 },
              { id: "b", name: "GT Sunday", slug: "gt-sunday", order: 1, isActive: 0, isPublic: 0 },
            ]
          : []
      ),
    };
    expect(await known(prisma, "/s/gt-sunday/races")).toBe(true);
  });

  it("leaves addresses outside /s/ alone", async () => {
    const known = await fresh();
    const prisma = prismaWith(["friday-f1"]);
    expect(await known(prisma, "/")).toBe(true);
    expect(await known(prisma, "/downloads")).toBe(true);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  // A database that cannot be reached must never turn the whole site into 404s.
  it("says yes when the series list cannot be read", async () => {
    const known = await fresh();
    const prisma = { $queryRawUnsafe: vi.fn(async () => { throw new Error("no db"); }) };
    expect(await known(prisma, "/s/friday-f1/drivers")).toBe(true);
  });
});

// The redirects, which decide which addresses EXIST as far as a crawler is
// concerned. Both cases here were pages the server answered with a perfectly
// good 200 and a canonical tag naming themselves, so both went into the index:
// the flat /drivers competing with the series page it renders, and /rules,
// whose whole content is a client-side jump to a page robots.txt forbids.
describe("legacyRedirects", () => {
  const run = async (url, opts) => {
    const [path, search = ""] = url.split("?");
    const res = { redirect: vi.fn() };
    let passed = false;
    await legacyRedirects(fakePrisma(opts))(
      { method: "GET", path, originalUrl: url, query: {} },
      res,
      () => {
        passed = true;
      }
    );
    return { to: res.redirect.mock.calls[0], passed, search };
  };

  it("sends the app's own client-side jumps as real redirects", async () => {
    expect((await run("/rules")).to).toEqual([301, "/downloads"]);
    expect((await run("/info")).to).toEqual([301, "/downloads"]);
  });

  it("keeps whatever was on the end of the address", async () => {
    expect((await run("/rules?tab=cars")).to).toEqual([301, "/downloads?tab=cars"]);
  });

  it("still folds a flat page onto the series that renders it", async () => {
    expect((await run("/drivers")).to).toEqual([301, "/s/friday-f1/drivers"]);
  });

  it("leaves everything else alone", async () => {
    expect((await run("/join")).passed).toBe(true);
    expect((await run("/teams/porsche.png")).passed).toBe(true);
  });
});
