// ---------------------------------------------------------------------------
// Two things that decide how the site looks in a search result.
//
// 1. LEGACY REDIRECTS. The site's pages live under /s/<series>/… since it grew
//    a second racing series. The old flat paths (/drivers, /races, …) still
//    work, but only because the app rewrites the address after it has loaded.
//    A search engine sees that as a separate page that happens to point
//    elsewhere, so /drivers and /s/friday-f1/drivers competed as two pages for
//    the same content, and the flat one is the one Google kept. A real redirect
//    on the server settles it before anything renders.
//
// 2. CANONICAL. The page carries one address that counts as the official one.
//    Without it, every variant of the same page competes with itself: the site
//    links with ?season=<n> so a click out of an archive table stays in that
//    season, and Google indexed one of those parameter addresses instead of the
//    plain page. The rule here is simply "the address without the query", plus
//    one fold: the primary series' home IS the root, since the root now renders
//    it rather than redirecting.
// ---------------------------------------------------------------------------
import { resolveSeries } from "./series.js";

// The series a flat path belongs to: the primary one, same choice the app makes
// when the address carries no slug. Cached, because it is needed on every page
// render and changes about once a year.
const SLUG_TTL_MS = 5 * 60 * 1000;
let slugCache = { value: null, at: 0 };

export async function primarySlug(prisma) {
  const now = Date.now();
  if (slugCache.value && now - slugCache.at < SLUG_TTL_MS) return slugCache.value;
  try {
    const series = await resolveSeries(prisma, undefined, { includePrivate: false });
    if (series?.slug) slugCache = { value: series.slug, at: now };
    return series?.slug || null;
  } catch {
    return slugCache.value; // stale is better than none
  }
}

// First path segments that belong INSIDE a series. Everything else (downloads,
// profile, tools, admin, the auth callbacks) is site-wide and stays flat.
const SERIES_SEGMENTS = new Set([
  "drivers",
  "constructors",
  "teams",
  "records",
  "races",
  "results",
  "calendar",
  "attendance",
  "live",
]);
// Aliases the app maps onto a page of their own.
const ALIASES = { signup: "/races", rennen: "/races" };

// Express middleware. Only ever redirects GET/HEAD, never touches /api or an
// address that already names a series.
export function legacyRedirects(prisma) {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const path = req.path;
    if (path.startsWith("/api") || path.startsWith("/s/")) return next();
    const [, first] = path.split("/");
    if (!first) return next(); // the root renders itself now
    const alias = ALIASES[first];
    if (!alias && !SERIES_SEGMENTS.has(first)) return next();
    const slug = await primarySlug(prisma);
    if (!slug) return next(); // no series yet: leave the app to handle it
    const rest = alias || path;
    const query = req.originalUrl.slice(req.path.length); // keeps ?season=… etc.
    // 301: these addresses are not coming back, and the point of the exercise
    // is to have search engines merge them into the prefixed ones.
    res.redirect(301, `/s/${slug}${rest}${query}`);
  };
}

// The address that counts as official for what this request renders.
export function canonicalUrl(req, slug) {
  const origin = `${req.protocol}://${req.get("host")}`;
  let path = req.path.replace(/\/+$/, "") || "/";
  // The primary series' home and the root are the same page; the short address
  // wins, because that is the one people share.
  if (slug && (path === `/s/${slug}` || path === `/s/${slug}/`)) path = "/";
  return origin + path;
}

// Put it into the HTML, replacing an existing tag rather than adding a second.
export function applyCanonical(html, url) {
  const tag = `<link rel="canonical" href="${url.replace(/"/g, "&quot;")}" />`;
  if (/<link[^>]+rel=["']canonical["'][^>]*>/i.test(html)) {
    return html.replace(/<link[^>]+rel=["']canonical["'][^>]*>/i, tag);
  }
  return html.replace(/<\/head>/i, `  ${tag}\n  </head>`);
}
