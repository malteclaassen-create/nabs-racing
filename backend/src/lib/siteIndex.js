// ---------------------------------------------------------------------------
// One snapshot of everything on this site that has a public address.
//
// Two consumers need this list, and the whole point is that they cannot
// disagree about it:
//
//   sitemap.xml       which addresses we ASK a search engine to look at
//   lib/crawlLinks.js which addresses the site POINTS AT in the delivered HTML
//
// They want different slices of it (the sitemap is a short priority list, the
// link block mirrors whatever the requested page really shows), but both have
// to be reading the same underlying facts. Built once and held for ten minutes,
// because a page render must not cost a dozen queries and the answer changes
// about as often as a race is scored.
//
// `strong` on each entry is the one editorial judgement in here: does this page
// have something behind it, or is it an empty shell? A reserve who has never
// started a race has a page, and it renders, but it says "P90 · 0 pts" and
// nothing else. Listing four hundred of those in a sitemap is how a young site
// teaches Google that its addresses are not worth fetching — which is exactly
// the state this file was written to get out of. The link block ignores `strong`
// (it mirrors the page, and the page shows everyone); the sitemap honours it.
// ---------------------------------------------------------------------------
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { primarySlug } from "./seo.js";
import { readRaceTypes } from "./raceTypes.js";

const TTL_MS = 10 * 60 * 1000;
const EMPTY = { primary: null, series: [] };

let cache = { at: 0, value: null };

// Called when something that changes the list is saved (a result, a season's
// privacy). Not wired anywhere yet on purpose: the TTL above already bounds how
// stale this gets, and a sitemap ten minutes behind costs nothing.
export function invalidateSiteIndex() {
  cache = { at: 0, value: null };
}

export async function getSiteIndex(prisma) {
  const now = Date.now();
  if (cache.value && now - cache.at < TTL_MS) return cache.value;
  try {
    const value = await build(prisma);
    cache = { at: now, value };
    return value;
  } catch {
    return cache.value || EMPTY; // a stale list beats no page at all
  }
}

async function build(prisma) {
  const [seriesRows, seasonRows, priv, primary] = await Promise.all([
    prisma.series
      .findMany({ where: { isPublic: true }, select: { id: true, slug: true } })
      .catch(() => []),
    prisma.season
      .findMany({ select: { id: true, seriesId: true, number: true, name: true, isActive: true } })
      .catch(() => []),
    getPrivateSeasonIds(prisma).catch(() => new Set()),
    primarySlug(prisma).catch(() => null),
  ]);

  const series = [];
  for (const s of seriesRows) {
    // Newest season first: that is the order the season switcher shows, and the
    // order a reader scanning the archive links expects.
    const seasons = seasonRows
      .filter((x) => x.seriesId === s.id && !priv.has(x.id))
      .sort((a, b) => b.number - a.number);
    // A series whose every season is unpublished has nothing to show a visitor,
    // so it has nothing to offer a crawler either.
    if (!seasons.length) continue;
    const base = `/s/${s.slug}`;
    const filled = [];
    for (const season of seasons) filled.push(await seasonEntities(prisma, season, base));
    series.push({ slug: s.slug, base, isPrimary: s.slug === primary, seasons: filled });
  }
  return { primary, series };
}

async function seasonEntities(prisma, season, base) {
  const [drivers, teams, races] = await Promise.all([
    prisma.driver
      .findMany({
        where: { seasonId: season.id },
        select: {
          id: true,
          name: true,
          team: { select: { tier: true } },
          _count: { select: { results: true } },
        },
        orderBy: { name: "asc" },
      })
      .catch(() => []),
    prisma.team
      .findMany({
        where: { seasonId: season.id },
        select: { id: true, name: true, tier: true },
        orderBy: { name: "asc" },
      })
      .catch(() => []),
    prisma.race
      .findMany({
        where: { seasonId: season.id },
        select: { id: true, number: true, track: true, isCompleted: true },
        orderBy: { number: "asc" },
      })
      .catch(() => []),
  ]);

  // `type` is a raw-SQL column (see lib/raceTypes.js), so it cannot be selected
  // above. Training sessions score nothing and have no result to look up.
  const types = await readRaceTypes(
    prisma,
    races.map((r) => r.id)
  ).catch(() => new Map());

  // The active season's tables ARE the plain address; every other season reaches
  // them through ?season=<n>. Spelled exactly as lib/seo.js builds the canonical
  // tag, in the same parameter order, because a link or a sitemap entry that
  // disagrees with the canonical points at a page Google will drop again.
  const prefix = season.isActive ? "" : `season=${season.number}&`;
  const listing = (page) =>
    season.isActive ? `${base}/${page}` : `${base}/${page}?season=${season.number}`;

  return {
    number: season.number,
    name: season.name || `Season ${season.number}`,
    isActive: season.isActive,
    listing: {
      drivers: listing("drivers"),
      constructors: listing("constructors"),
      races: listing("races"),
    },
    drivers: drivers.map((d) => ({
      label: d.name,
      href: `${base}/drivers/${encodeURIComponent(d.id)}`,
      // A seat on a real team, or at least one race entry to show.
      strong: (d.team?.tier ?? 0) > 0 || (d._count?.results ?? 0) > 0,
    })),
    teams: teams.map((t) => ({
      label: t.name,
      href: `${base}/constructors/${encodeURIComponent(t.id)}`,
      // Tier 0 is the reserve pool, not a constructor: it scores nothing and
      // holds whoever has no seat this season.
      strong: t.tier > 0,
    })),
    races: races
      .filter((r) => (types.get(r.id) || "CHAMPIONSHIP") !== "TRAINING")
      .map((r) => ({
        label: r.track || (r.number != null ? `Round ${r.number}` : "Race"),
        href: `${base}/races?${prefix}race=${encodeURIComponent(r.id)}`,
        // A round that never ran has a date and nothing else.
        strong: r.isCompleted,
      })),
  };
}
