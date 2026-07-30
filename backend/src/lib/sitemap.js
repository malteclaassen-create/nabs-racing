// ---------------------------------------------------------------------------
// robots.txt and sitemap.xml.
//
// Both are generated per request rather than kept as files, for one reason: the
// site's address is not fixed. It runs on localhost, on a tunnel while sharing,
// on nabsracing.com, and one day on whatever domain the league admin uses after
// the handover. A file would carry a hard-coded address that is wrong on three
// of those, and a sitemap with the wrong host is worse than none at all.
//
// What is listed: the public pages, one entry per driver and per team of every
// PUBLIC season, every season's tables, and every race that has been run.
//
// Those last two are the reason this file grew. The listing pages show one season
// at a time and default to the active one, and the races page opens on one round
// at a time; both select what they show through a query parameter. So without an
// entry each, six of seven seasons of tables and about a hundred race results
// existed on the site but not as addresses, and could not be found. They are
// spelled exactly as the canonical tag spells them (see lib/seo.js) down to the
// parameter order, because a sitemap that disagrees with the canonical lists
// pages that get dropped again.
//
// Private (unpublished) seasons are left out entirely, the same rule the link
// previews follow, so an announced-but-hidden season cannot be discovered
// through here. Member-only areas (profile, downloads, admin) are excluded and
// additionally turned away in robots.txt.
//
// No lastmod dates: the driver and team rows carry no reliable "changed at"
// timestamp, and a made-up one is worse than none (search engines learn to
// distrust the whole file).
// ---------------------------------------------------------------------------
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { primarySlug } from "./seo.js";
import { readRaceTypes } from "./raceTypes.js";

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
  const urls = ["/"];

  // Series and their seasons. A series with no public season contributes
  // nothing: its pages would render empty for a visitor.
  const [series, seasons, priv] = await Promise.all([
    prisma.series
      .findMany({ where: { isPublic: true }, select: { id: true, slug: true } })
      .catch(() => []),
    prisma.season.findMany({ select: { id: true, seriesId: true } }).catch(() => []),
    getPrivateSeasonIds(prisma).catch(() => new Set()),
  ]);

  const publicSeasonIds = new Set(seasons.filter((s) => !priv.has(s.id)).map((s) => s.id));
  const seasonsOfSeries = new Map(); // seriesId -> [seasonId]
  for (const s of seasons) {
    if (!publicSeasonIds.has(s.id)) continue;
    if (!seasonsOfSeries.has(s.seriesId)) seasonsOfSeries.set(s.seriesId, []);
    seasonsOfSeries.get(s.seriesId).push(s.id);
  }

  // Pre-series databases have no Series rows at all; the site then lives under
  // its flat paths, so list those instead of nothing.
  const seriesList = series.length ? series : [];
  if (!seriesList.length) {
    urls.push("/drivers", "/constructors", "/races", "/records", "/live");
  }

  // The primary series' home IS the root, so listing /s/<slug> as well would
  // offer the same page under two addresses (the canonical tag says the short
  // one wins, and a sitemap should agree with it).
  const primary = await primarySlug(prisma).catch(() => null);

  for (const s of seriesList) {
    const ids = seasonsOfSeries.get(s.id) || [];
    if (!ids.length) continue;
    const base = `/s/${s.slug}`;
    if (s.slug !== primary) urls.push(base);
    urls.push(`${base}/drivers`, `${base}/constructors`, `${base}/races`, `${base}/records`, `${base}/live`);

    const [drivers, teams] = await Promise.all([
      prisma.driver
        .findMany({ where: { seasonId: { in: ids } }, select: { id: true } })
        .catch(() => []),
      prisma.team.findMany({ where: { seasonId: { in: ids } }, select: { id: true } }).catch(() => []),
    ]);
    for (const d of drivers) urls.push(`${base}/drivers/${encodeURIComponent(d.id)}`);
    for (const t of teams) urls.push(`${base}/constructors/${encodeURIComponent(t.id)}`);

    // The ARCHIVE. The listing pages above show one season at a time and default
    // to the active one, so without these the six finished seasons of tables have
    // no address of their own and cannot be found at all. ?season=<n> is the
    // address the canonical tag hands them (see lib/seo.js), which is why it is
    // spelled the same way here: a sitemap that disagrees with the canonical is
    // a sitemap of pages Google will drop again.
    const seasons = await prisma.season
      .findMany({ where: { id: { in: ids } }, select: { id: true, number: true, isActive: true } })
      .catch(() => []);
    for (const season of seasons) {
      // /records is deliberately absent: it is all-time, not per season.
      if (!season.isActive) {
        for (const page of ["drivers", "constructors", "races"]) {
          urls.push(`${base}/${page}?season=${season.number}`);
        }
      }
      // Every round, of every season. The one thing on this site with a date, a
      // circuit and a winner attached, and until now all of it lived on a single
      // address. Training sessions are left out on purpose: they score nothing
      // and there is no result to look up.
      const races = await prisma.race
        .findMany({
          where: { seasonId: season.id },
          select: { id: true, number: true, isCompleted: true },
          orderBy: { number: "asc" },
        })
        .catch(() => []);
      const types = await readRaceTypes(prisma, races.map((r) => r.id)).catch(() => new Map());
      for (const r of races) {
        if ((types.get(r.id) || "CHAMPIONSHIP") === "TRAINING") continue;
        if (!r.isCompleted && !season.isActive) continue; // a race that never ran
        // Same parameter order as the canonical tag builds, to the character.
        const q = season.isActive ? "" : `season=${season.number}&`;
        urls.push(`${base}/races?${q}race=${encodeURIComponent(r.id)}`);
      }
    }
  }

  const body = [...new Set(urls)]
    .map((u) => `  <url><loc>${esc(origin + u)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
