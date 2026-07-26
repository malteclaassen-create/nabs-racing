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

// A path that ends in a file extension is a FILE, not a page: /teams/porsche.png
// is the bundled team logo, not the Porsche team's page. Both live under the
// same first segment, and this middleware runs before express.static so it also
// catches crawlers — which meant every /public/teams/*.png answered with a 301
// into /s/<slug>/teams/<file>.png, where the SPA fallback handed back index.html.
// The browser got HTML where it asked for a PNG, the <img> failed, and every
// team fell back to its monogram badge. Only teams whose logo had been re-uploaded
// through the admin survived, because those are served from /api/uploads/… and
// leave by the guard below. Pages never carry an extension, so skipping these is
// free.
const FILE_LIKE = /\.[a-z0-9]{2,5}$/i;

// Express middleware. Only ever redirects GET/HEAD, never touches /api, a static
// file, or an address that already names a series.
export function legacyRedirects(prisma) {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const path = req.path;
    if (path.startsWith("/api") || path.startsWith("/s/")) return next();
    if (FILE_LIKE.test(path)) return next(); // let express.static answer it
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

// Global pages that live outside any series (see the route table in App.jsx).
const GLOBAL_SEGMENTS = new Set([
  "downloads",
  "tools",
  "profile",
  "cockpit",
  "cards",
  "rules",
  "info",
  "admin",
  "auth",
  "market",
  "driver-market",
]);

// Does this address correspond to a page the app actually has?
//
// The SPA fallback answers every non-API address with index.html and a 200, so
// a typo'd or long-dead URL was served as a perfectly good page — with a
// canonical tag naming itself, which invites a search engine to index it. The
// app renders its own 404 there, but nothing ever said so in the HTTP status.
//
// This is deliberately shape-based, not exhaustive: it recognises the route
// patterns, not the ids inside them. /s/<slug>/drivers/<id> for a driver who
// does not exist stays a 200 — answering that needs a database lookup per
// request, and the app's own "not found" copy covers it. What this catches is
// the address that was never a page at all.
export function isKnownRoute(path) {
  if (path === "/" || path === "") return true;
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  // /s/<slug>[/<segment>[/<id>]]
  if (parts[0] === "s") {
    if (parts.length === 2) return true; // the series home
    if (parts.length === 3 || parts.length === 4) return SERIES_SEGMENTS.has(parts[2]);
    return false;
  }
  const first = parts[0];
  if (ALIASES[first] || SERIES_SEGMENTS.has(first)) return parts.length <= 2;
  if (GLOBAL_SEGMENTS.has(first)) return true; // these have their own sub-paths
  if (first === "signup" || first === "rennen") return parts.length === 1;
  return false;
}

// Tell a crawler not to keep an address the app answers with its 404 page.
export function applyNoindex(html) {
  if (/<meta[^>]+name=["']robots["'][^>]*>/i.test(html)) return html;
  return html.replace(/<\/head>/i, `  <meta name="robots" content="noindex" />\n  </head>`);
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
