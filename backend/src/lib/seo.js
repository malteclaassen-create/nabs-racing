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
import { resolveSeries, dbListSeries } from "./series.js";
import { getActiveSeason } from "../services/seasonService.js";

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

// Addresses that are somebody ELSE's page, outside any series. The app has
// always answered these with a client-side <Navigate> (App.jsx), which is a
// redirect only once the JavaScript has run: the server answered 200 with a
// canonical tag naming the address itself, so /rules and /info went into the
// index as two more pages of this site whose entire content was "we are about
// to send you somewhere else" — and the somewhere else is a page robots.txt
// forbids. A real redirect settles it before anything renders.
const GLOBAL_REDIRECTS = { "/rules": "/downloads", "/info": "/downloads" };

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
    const query = req.originalUrl.slice(req.path.length); // keeps ?season=… etc.
    const global = GLOBAL_REDIRECTS[path.replace(/\/+$/, "")];
    if (global) return res.redirect(301, `${global}${query}`);
    const [, first] = path.split("/");
    if (!first) return next(); // the root renders itself now
    const alias = ALIASES[first];
    if (!alias && !SERIES_SEGMENTS.has(first)) return next();
    const slug = await primarySlug(prisma);
    if (!slug) return next(); // no series yet: leave the app to handle it
    const rest = alias || path;
    // 301: these addresses are not coming back, and the point of the exercise
    // is to have search engines merge them into the prefixed ones.
    res.redirect(301, `/s/${slug}${rest}${query}`);
  };
}

// Global pages that live outside any series (see the route table in App.jsx).
const GLOBAL_SEGMENTS = new Set([
  "join",
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

// Is the /s/<slug>/… in this address a series that exists?
//
// isKnownRoute above deliberately does not check the ids INSIDE a route, and
// for a driver or a race that is the right call: the app's own "not found" copy
// covers it and checking would cost a query per request. The series slug is not
// an id of that kind. There are two of them, they are frozen at creation, and
// leaving them unchecked meant every page had unlimited spellings:
//
//     /s/friday-f1/drivers    200, canonical .../s/friday-f1/drivers
//     /s/anything-here/drivers 200, canonical .../s/anything-here/drivers
//
// The same driver table under both, each declaring itself the official address.
// One mistyped link shared anywhere is then a duplicate of the real page for a
// search engine to weigh up, and the canonical tag — the one thing meant to
// prevent exactly this — was arguing FOR the typo.
//
// Private series count as existing: their pages are served to the members who
// may see them (the API does that gating), and a private slug must not be
// treated as a typo. The list is cached like the primary slug, for the same
// reason: needed on every render, changes about once a year.
const SERIES_TTL_MS = 5 * 60 * 1000;
let seriesCache = { slugs: null, at: 0 };

export async function seriesSlugKnown(prisma, path) {
  const parts = String(path || "").replace(/^\/+|\/+$/g, "").split("/");
  if (parts[0] !== "s" || !parts[1]) return true; // not a series address

  const now = Date.now();
  if (!seriesCache.slugs || now - seriesCache.at >= SERIES_TTL_MS) {
    try {
      const all = await dbListSeries(prisma, { includePrivate: true });
      if (all.length) seriesCache = { slugs: new Set(all.map((s) => s.slug)), at: now };
    } catch {
      /* stale is better than none, and none is better than a wrong 404 */
    }
  }
  // Never turn a real page into a 404 because the database was unreachable.
  if (!seriesCache.slugs) return true;
  return seriesCache.slugs.has(parts[1]);
}

// Tell a crawler not to keep an address the app answers with its 404 page.
export function applyNoindex(html) {
  if (/<meta[^>]+name=["']robots["'][^>]*>/i.test(html)) return html;
  return html.replace(/<\/head>/i, `  <meta name="robots" content="noindex" />\n  </head>`);
}

// Sections that are the SAME page under a second name (the route table hands
// each pair to one component). Left alone they are two official addresses for
// identical content, which is the one thing a canonical tag exists to prevent.
const SECTION_ALIASES = { results: "races", calendar: "races", teams: "constructors" };

// Query parameters that select WHICH content a page shows, and therefore belong
// in its official address.
//
// Everything else is dropped. That is the important half of this list: ?dl=,
// ?tour=, ?demo= and any campaign tag render the very same page, and left in the
// canonical they would turn one page into an unbounded number of addresses all
// competing with each other.
//
//   season=<n>  the listing pages show one season at a time. This is what gives
//               every archived season's tables an address of their own instead
//               of all seven folding into one. Dropped when it names the season
//               the page shows anyway (the active one), so /drivers and
//               /drivers?season=7 never compete.
//   race=<id>   the races page opens on one round. This is what gives every
//               round of every season an address of its own.
// NOT /records: the Hall of Fame is all-time across every season (see
// recordsService), so a season parameter there selects nothing and would only
// clone the page.
const SEASON_PAGES = new Set(["drivers", "constructors", "races", "attendance"]);
const RACE_PAGES = new Set(["races"]);

// The canonical query string ("" or "?season=3&race=abc"), built in a fixed
// order so the same page never yields two spellings of the same address.
function canonicalQuery(section, query, activeSeason) {
  const parts = [];
  const season = Number(query?.season);
  if (
    section &&
    SEASON_PAGES.has(section) &&
    Number.isInteger(season) &&
    season > 0 &&
    season !== activeSeason
  ) {
    parts.push(`season=${season}`);
  }
  const race = typeof query?.race === "string" ? query.race.trim() : "";
  // Ids are cuids; anything else is somebody probing, and it must not be
  // dignified with a canonical address of its own.
  if (section && RACE_PAGES.has(section) && /^[A-Za-z0-9_-]{1,64}$/.test(race)) {
    parts.push(`race=${encodeURIComponent(race)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// The address that counts as official for what this request renders.
export async function canonicalUrl(req, prisma) {
  const origin = `${req.protocol}://${req.get("host")}`;
  let path = req.path.replace(/\/+$/, "") || "/";
  const slug = await primarySlug(prisma).catch(() => null);
  // The primary series' home and the root are the same page; the short address
  // wins, because that is the one people share.
  if (slug && (path === `/s/${slug}` || path === `/s/${slug}/`)) path = "/";
  // /join is the newcomer page under an address you can put in a Discord
  // listing or a forum post, and one that keeps working for a member who is
  // signed in. But it renders exactly what the root renders to anyone who is
  // NOT signed in, and a crawler never is, so as far as a search engine is
  // concerned the two are one page. The root wins it: it is the address other
  // sites link to, and every link to /join should count towards it.
  //
  // If the root ever stops showing the newcomer page to signed-out visitors,
  // this fold is the line to remove.
  if (path === "/join") path = "/";

  // Only a series listing page (/s/<slug>/<section>) carries a section that the
  // rules above apply to. An entity page (/s/<slug>/drivers/<id>) already names
  // exactly what it shows, so no parameter can add anything to it.
  const parts = path.split("/").filter(Boolean);
  let section = null;
  if (parts[0] === "s" && parts.length === 3) {
    section = SECTION_ALIASES[parts[2]] || parts[2];
    path = `/s/${parts[1]}/${section}`;
  } else if (parts[0] === "s" && parts.length === 4) {
    path = `/s/${parts[1]}/${SECTION_ALIASES[parts[2]] || parts[2]}/${parts[3]}`;
  }

  const active = section ? await activeSeasonNumber(prisma, parts[1]).catch(() => null) : null;
  return origin + path + canonicalQuery(section, req.query, active);
}

// The number of the season a series' listing pages show by default. Cached like
// primarySlug above: it is needed on every page render and changes once a
// season.
const ACTIVE_TTL_MS = 60 * 1000;
const activeCache = new Map(); // slug -> { at, number }

export async function activeSeasonNumber(prisma, slug) {
  const hit = activeCache.get(slug || "");
  if (hit && Date.now() - hit.at < ACTIVE_TTL_MS) return hit.number;
  let number = null;
  try {
    const series = await resolveSeries(prisma, slug, { includePrivate: false });
    if (series) {
      const season = await getActiveSeason(prisma, series.id);
      number = season?.number != null ? Number(season.number) : null;
    }
  } catch {
    return hit ? hit.number : null; // stale is better than a wrong canonical
  }
  activeCache.set(slug || "", { at: Date.now(), number });
  return number;
}

// Put it into the HTML, replacing an existing tag rather than adding a second.
//
// og:url gets the same address. index.html carries a fixed one (the home page),
// which every subpage was then shipping unchanged: a pasted driver link unfurled
// with the right title but claimed to be the site root, and some readers use
// og:url rather than the address they fetched.
export function applyCanonical(html, url) {
  // An address with two parameters carries an "&", and in an attribute value that
  // has to be escaped: left raw, a parser is entitled to read "&race" as the
  // start of an entity. A canonical tag that does not parse is worse than none,
  // because the page then argues for whichever address happened to be crawled.
  const href = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const tag = `<link rel="canonical" href="${href}" />`;
  let out = html.replace(/(<meta property="og:url" content=")[^"]*(")/i, `$1${href}$2`);
  if (/<link[^>]+rel=["']canonical["'][^>]*>/i.test(out)) {
    return out.replace(/<link[^>]+rel=["']canonical["'][^>]*>/i, tag);
  }
  return out.replace(/<\/head>/i, `  ${tag}\n  </head>`);
}
