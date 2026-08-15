// ---------------------------------------------------------------------------
// The links a page already shows, written into the HTML the server delivers.
//
// The site is a single-page app: index.html ships `<div id="root"></div>` and
// React builds everything else in the browser. Nav bar, footer, the driver list
// on /drivers, the round list on /races — all of it real, visible and linked,
// none of it present in what a crawler is handed. Search Console spelled out
// the consequence: 646 addresses sat at "Gefunden – zurzeit nicht indexiert",
// found through sitemap.xml and never fetched, because nothing on the site
// pointed at any of them and an address nothing links to is an address worth
// postponing.
//
// So the server pre-fills the root element with the links that page renders
// anyway. React's createRoot() clears the container on mount (see
// frontend/src/main.jsx — createRoot, NOT hydrateRoot), so this lives exactly
// until the app boots and then it is gone. That is the trade, and it was taken
// deliberately: for a tenth of a second on a cold load the reader sees a plain
// link index before the real page replaces it.
//
// MIRROR THE PAGE. Every block below lists what the requested address actually
// renders: /drivers gets that season's drivers, /races that season's rounds,
// everything gets the same eight links the footer carries (App.jsx footerLinks).
// This is the one rule that must not be bent. Showing a crawler links a reader
// does not get is cloaking, and it is the sort of clever that ends with the site
// removed from the index rather than added to it. Which also rules out the
// tempting shortcut of sending this block only to Googlebot: it goes to
// everyone, or it does not go.
// ---------------------------------------------------------------------------
import { getSiteIndex } from "./siteIndex.js";
import { isCrawlable } from "./sitemap.js";
import { buildEntityBlock } from "./crawlEntities.js";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// Same list, same order, same labels as the footer's "Explore" column
// (frontend/src/App.jsx footerLinks). If that list changes, this one changes
// with it — they are supposed to be the same eight links.
//
// One deliberate difference, and only for the primary series: the footer's Home
// link points at /s/<slug> (useSeriesPath builds every link that way), while the
// canonical tag says that page's official address is the bare root. Both render
// the same thing, so this is not the block showing something the reader does not
// get — it is the block spending its one Home link on the address that counts
// instead of on one that redirects a crawler's attention elsewhere.
function exploreLinks(base, isPrimary) {
  return [
    { href: isPrimary ? "/" : base || "/", label: "Home" },
    { href: `${base}/drivers`, label: "Drivers" },
    { href: `${base}/constructors`, label: "Constructors" },
    { href: `${base}/races`, label: "Races" },
    { href: `${base}/attendance`, label: "Attendance" },
    { href: `${base}/live`, label: "Live Timing" },
    { href: "/join", label: "How it works" },
    { href: "/downloads", label: "Race Info" },
  ];
}

// The app maps these onto one page each (see SECTION_ALIASES in lib/seo.js).
const SECTION_ALIASES = { results: "races", calendar: "races", teams: "constructors" };

function renderGroup(title, links) {
  if (!links?.length) return "";
  const items = links
    .map((l) => `<a class="text-medium underline-offset-2 hover:text-dark" href="${esc(l.href)}">${esc(l.label)}</a>`)
    .join('<span class="text-border" aria-hidden="true"> · </span>');
  return [
    "<section>",
    `<h2 class="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">${esc(title)}</h2>`,
    `<p class="mt-2 text-sm leading-relaxed">${items}</p>`,
    "</section>",
  ].join("");
}

// The block for one address, or "" when there is nothing worth writing.
export async function buildCrawlLinks(prisma, path, query) {
  // Member-only areas (admin, profile, downloads, …) are turned away in
  // robots.txt; handing them a link index would be pure weight for nobody.
  if (!isCrawlable(path)) return "";

  const index = await getSiteIndex(prisma);
  if (!index.series.length) return "";

  const parts = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  let slug = null;
  let section = null;
  let entityId = null;
  if (parts[0] === "s") {
    slug = parts[1] || null;
    // parts[3] is an entity id (/s/<slug>/drivers/<id>). That page shows ONE
    // driver rather than the list, so it gets no list of drivers — it gets its
    // own facts and its own links instead, from lib/crawlEntities.js.
    section = parts[2] ? SECTION_ALIASES[parts[2]] || parts[2] : null;
    entityId = parts.length === 4 ? parts[3] : null;
    if (parts.length !== 3 && !entityId) section = null;
  }

  // No slug in the address means the primary series, the same fold the app and
  // the canonical tag make.
  const series =
    index.series.find((s) => s.slug === slug) || index.series.find((s) => s.isPrimary) || index.series[0];
  if (!series) return "";

  const groups = [renderGroup("Explore", exploreLinks(series.base, series.isPrimary))];

  // Which season this page is showing. ?season=<n> selects it; without one the
  // listing pages show the active season.
  const wanted = Number(query?.season);
  const season =
    (Number.isInteger(wanted) && series.seasons.find((s) => s.number === wanted)) ||
    series.seasons.find((s) => s.isActive) ||
    series.seasons[0];

  // The LISTING pages only. A driver's own page is not the driver list and must
  // not be handed one: it shows that driver, and what it shows is built below
  // by lib/crawlEntities.js. Getting this wrong is the whole cloaking trap —
  // four hundred driver links on a page that renders one driver.
  if (season && !entityId && !query?.race) {
    if (section === "drivers") groups.push(renderGroup(`${season.name} drivers`, season.drivers));
    if (section === "constructors") groups.push(renderGroup(`${season.name} teams`, season.teams));
    if (section === "races") groups.push(renderGroup(`${season.name} rounds`, season.races));

    // The season switcher is visible on exactly these three pages, and this is
    // the same set of seasons it offers. Elsewhere there is no switcher, so
    // there are no season links either.
    if (section === "drivers" || section === "constructors" || section === "races") {
      const others = series.seasons
        .filter((s) => s.number !== season.number)
        .map((s) => ({ href: s.listing[section], label: s.name }));
      groups.push(renderGroup("Seasons", others));
    }
  }

  // What THIS page is about, for the addresses that are about one thing: a
  // driver, a team, a round, or the home page's title race. Until this existed
  // those pages were a title, a nav bar and a footer, and Google wrote every
  // driver's description out of the footer because it was the only prose in
  // the document.
  const entity = await buildEntityBlock(prisma, {
    base: series.base,
    section,
    id: entityId,
    raceId: section === "races" && query?.race ? String(query.race) : null,
    seasonId: season?.id || null,
    isHome: !section && !entityId,
  });
  if (entity) {
    const head = [
      entity.heading
        ? `<h1 class="font-display text-2xl font-black uppercase tracking-tight">${esc(entity.heading)}</h1>`
        : "",
      entity.line ? `<p class="mt-1 text-sm text-medium">${esc(entity.line)}</p>` : "",
    ].join("");
    const blocks = head ? [`<section>${head}</section>`] : [];
    for (const g of entity.groups || []) blocks.push(renderGroup(g.title, g.links));
    // In FRONT of the footer links: what the address is about leads, and the
    // eight links every page carries are not what it is about.
    groups.unshift(...blocks);
  }

  const body = groups.filter(Boolean).join("");
  if (!body) return "";
  // aria-hidden is deliberately NOT set: these are real links, and a reader on a
  // slow connection reaching them before the app boots should be able to use them.
  return `<div class="container-page space-y-8 py-12">${body}</div>`;
}

// Put the block inside the root element. React clears it on mount.
export function applyCrawlLinks(html, block) {
  if (!block) return html;
  return html.replace(/<div id="root">\s*<\/div>/i, `<div id="root">${block}</div>`);
}
