// ---------------------------------------------------------------------------
// robots.txt and sitemap.xml.
//
// Both are generated per request rather than kept as files, for one reason: the
// site's address is not fixed. It runs on localhost, on a tunnel while sharing,
// on nabsracing.com, and one day on whatever domain the league admin uses after
// the handover. A file would carry a hard-coded address that is wrong on three
// of those, and a sitemap with the wrong host is worse than none at all.
//
// WHAT IS LISTED, and why it is far less than it was.
//
// This file used to offer every driver and every team of every public season,
// plus every round ever run: 770 addresses from a domain three weeks old. Search
// Console's verdict on that was unambiguous — 646 of them sat at "Gefunden –
// zurzeit nicht indexiert" for two weeks without moving. Found, never fetched.
// Not a crawl error, a crawl DECISION: a site with no reputation that hands over
// hundreds of addresses gets a few sampled, and the rest wait.
//
// So the sitemap now argues for the pages that can win, and lets the rest be
// found the ordinary way (lib/crawlLinks.js puts the site's own links into the
// delivered HTML, which is what was really missing):
//
//   the home page, and each series' four listing pages
//   the ACTIVE season's drivers, teams and completed rounds
//   every archived season's three tables, as the way into the archive
//
// Left out on purpose: the archive's individual driver, team and race pages
// (they stay reachable through the season tables and the link block, they are
// simply not what this file should be spending its credibility on), /live (a
// page with nothing on it between race nights), and anything `strong` in
// lib/siteIndex.js rejects — a reserve who never started, the tier-0 reserve
// pool, a round that has not run.
//
// Addresses are spelled exactly as the canonical tag spells them (see
// lib/seo.js), down to the parameter order: a sitemap that disagrees with the
// canonical lists pages that get dropped again.
//
// Private (unpublished) seasons are absent entirely, the same rule the link
// previews follow, so an announced-but-hidden season cannot be discovered
// through here. Member-only areas (profile, downloads, admin) are excluded and
// additionally turned away in robots.txt.
//
// No lastmod dates: the driver and team rows carry no reliable "changed at"
// timestamp, and a made-up one is worse than none (search engines learn to
// distrust the whole file).
// ---------------------------------------------------------------------------
import { getSiteIndex } from "./siteIndex.js";

// Areas that have no business in a search index. Written as a denylist because
// the interesting pages are all public by default.
const DISALLOW = [
  "/api/", // the JSON API itself
  "/admin", // league office
  "/profile", // a member's own area
  "/feedback", // a member's own messages to the admins
  "/cockpit",
  "/cards",
  "/downloads", // member-only files
  "/tools",
  "/auth/", // login callbacks
];

// Is this address one a crawler is allowed to have? Same list as above, so the
// pre-rendered link block (lib/crawlLinks.js) never bothers building an index
// for a page robots.txt turns away.
export function isCrawlable(path) {
  const p = String(path || "/");
  return !DISALLOW.some((d) => p === d || p.startsWith(d) || p === d.replace(/\/$/, ""));
}

export function buildRobotsTxt(origin) {
  return [
    "# NABS Racing League",
    "User-agent: *",
    // Driver photos and team logos are served from here and are worth finding.
    "Allow: /api/uploads/",
    ...DISALLOW.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export async function buildSitemapXml(prisma, origin) {
  const index = await getSiteIndex(prisma);
  const urls = ["/"];

  // A database from before the series model has no Series rows at all; the site
  // then lives under its flat paths, so list those rather than nothing.
  if (!index.series.length) {
    urls.push("/drivers", "/constructors", "/races", "/records");
  }

  for (const s of index.series) {
    // The primary series' home IS the root, so listing /s/<slug> as well would
    // offer one page under two addresses (and the canonical tag says the short
    // one wins, which a sitemap should agree with).
    if (!s.isPrimary) urls.push(s.base);
    urls.push(`${s.base}/drivers`, `${s.base}/constructors`, `${s.base}/races`, `${s.base}/records`);

    for (const season of s.seasons) {
      if (season.isActive) {
        // THE SEASON BEING RACED. Its people and its rounds are what anyone is
        // searching for right now, and the pages carry the most content.
        for (const d of season.drivers) if (d.strong) urls.push(d.href);
        for (const t of season.teams) if (t.strong) urls.push(t.href);
        for (const r of season.races) if (r.strong) urls.push(r.href);
      } else {
        // THE ARCHIVE, as three tables per season rather than a few hundred
        // pages. The listing pages show one season at a time and default to the
        // active one, so without these the finished seasons have no address of
        // their own at all; with them the archive is one click deep and can be
        // crawled from the season tables when it earns it.
        urls.push(season.listing.drivers, season.listing.constructors, season.listing.races);
      }
    }
  }

  const body = [...new Set(urls)]
    .map((u) => `  <url><loc>${esc(origin + u)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
