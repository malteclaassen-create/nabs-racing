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
import { driverTable, constructorTables } from "./crawlTables.js";
import { raceKickoff } from "./raceKickoff.js";

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
    // The footer's ninth link, Race Info, points at /downloads, and robots.txt
    // turns crawlers away from it (member-only files). A link every page
    // carries to an address nothing may fetch teaches Google one thing only:
    // that this site links pages it is not allowed to have. The reader still
    // gets it from the footer — this block simply does not spend a link on it.
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

// A cell is a string or a link. Both spellings appear in the same table: the
// standings' Pos column is a number, its Driver column is an address.
function renderCell(c) {
  if (c && typeof c === "object" && c.href) {
    return `<a class="text-medium underline-offset-2 hover:text-dark" href="${esc(c.href)}">${esc(c.label)}</a>`;
  }
  return esc(c ?? "");
}

// A real table, because the thing it mirrors is a real table. Scrollable on a
// phone for the same reason the app's tables are: this is on screen for the
// tenth of a second before React replaces it, and it should not be what makes
// that tenth of a second scroll sideways.
function renderTable(title, columns, rows) {
  if (!rows?.length) return "";
  const head = columns?.length
    ? `<thead><tr>${columns.map((c) => `<th class="px-3 py-2 text-left font-semibold">${esc(c)}</th>`).join("")}</tr></thead>`
    : "";
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td class="px-3 py-2">${renderCell(c)}</td>`).join("")}</tr>`)
    .join("");
  return [
    "<section>",
    `<h2 class="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">${esc(title)}</h2>`,
    '<div class="mt-2 overflow-x-auto">',
    // No <caption>: the h2 above already names the table, and repeating it
    // would put the same line into the document twice.
    '<table class="w-full text-sm">',
    head,
    `<tbody>${body}</tbody>`,
    "</table></div></section>",
  ].join("");
}

// The calendar, the way the round rail reads it: round number, circuit, date.
// Built from the season index rather than from a query of its own, so the round
// addresses here cannot drift from the ones the sitemap lists. Falls back to the
// plain circuit list for a season whose rounds carry no numbers at all.
function renderCalendar(season) {
  const all = season.races || [];
  // A special event is not a round and has no round number — on the page it
  // lives behind its own tab, not in the calendar. Kept in a table of its own
  // rather than as rows with an empty Rnd column.
  const rounds = all.filter((r) => r.number != null);
  const specials = all.filter((r) => r.number == null);
  if (!rounds.length) return renderGroup(`${season.name} rounds`, all);
  return [
    renderTable(
      `${season.name} rounds`,
      ["Rnd", "Circuit", "Date"],
      rounds.map((r) => [String(r.number), { href: r.href, label: r.label }, fmtDate(r.date)])
    ),
    specials.length
      ? renderTable(
          `${season.name} special events`,
          ["Event", "Date"],
          specials.map((r) => [{ href: r.href, label: r.label }, fmtDate(r.date)])
        )
      : "",
  ].join("");
}

// The date the round rail prints: "Fri 14 Aug 2026" (frontend utils/format.js,
// fmtRaceDateFull). Through raceKickoff first, for the reason that helper
// exists: a date-only round is stored at UTC midnight and means 19:00 German
// time, and formatting it raw prints the day before for half the world. Fixed
// to the league's own zone so the delivered HTML does not depend on where the
// server happens to be, and two requests for the same page cannot disagree.
function fmtDate(d) {
  const t = raceKickoff(d);
  if (!t) return "";
  return t
    .toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Europe/Berlin",
    })
    .replace(",", "");
}

// One entity group, in whichever of the two shapes it came in.
const renderBlock = (g) =>
  g?.rows ? renderTable(g.title, g.columns, g.rows) : renderGroup(g?.title, g?.links);

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
    // The championship tables, as tables (lib/crawlTables.js). Each one falls
    // back to the plain list of names it used to be if the scoring pass is
    // unavailable — a page must never be worse off for this block failing.
    if (section === "drivers") {
      const t = await driverTable(prisma, season.id, series.base).catch(() => null);
      if (t) {
        groups.push(renderTable(`${season.name} drivers`, t.columns, t.rows));
        // The table is the championship, which is the page's default view: the
        // reserves who never got in a car are behind a click ("N reserves
        // without a start"). They keep their links here, as a list, because
        // they had them before this table existed and their pages have no
        // other way in — the sitemap leaves them out on purpose.
        const shown = new Set(t.rows.map((r) => r.find((c) => c?.href)?.href).filter(Boolean));
        const rest = (season.drivers || []).filter((d) => !shown.has(d.href));
        if (rest.length) groups.push(renderGroup(`${season.name} reserves`, rest));
      } else {
        groups.push(renderGroup(`${season.name} drivers`, season.drivers));
      }
    }
    if (section === "constructors") {
      const tables = await constructorTables(prisma, season.id, series.base, season.name).catch(() => null);
      if (tables) for (const t of tables) groups.push(renderTable(t.title, t.columns, t.rows));
      else groups.push(renderGroup(`${season.name} teams`, season.teams));
    }
    if (section === "races") groups.push(renderCalendar(season));

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
      // The home page's opening sentence — the one place the document says what
      // the league IS. Only that block sets it; the driver, team and round
      // blocks say what their own page says and nothing more.
      entity.blurb ? `<p class="mt-2 max-w-2xl text-sm leading-relaxed">${esc(entity.blurb)}</p>` : "",
    ].join("");
    const blocks = head ? [`<section>${head}</section>`] : [];
    for (const g of entity.groups || []) blocks.push(renderBlock(g));
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
