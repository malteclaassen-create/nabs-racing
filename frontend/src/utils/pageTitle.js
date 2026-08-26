import { useEffect } from "react";

// ---------------------------------------------------------------------------
// The browser-tab title, and with it the title a search result shows.
//
// The server already writes a title into the HTML it ships (see
// backend/src/lib/pageMeta.js), which is what a link unfurler reads. But a
// search engine renders the page before it indexes it, and what it finds then is
// whatever this app has since put in document.title. So the two have to say the
// same thing: the wording below deliberately MIRRORS that file, and a change to
// one belongs in the other.
//
// Two kinds of caller, so that they cannot fight over the tab:
//
//   setFallbackTitle  the route's own title (a season's standings, the calendar).
//                     App's TitleSync keeps this current.
//   useSpecificTitle  a page that knows something more precise than its route
//                     does. The races page opens on ONE round, and that round is
//                     the most specific thing the site can say about the address;
//                     it wins while the page is mounted.
//
// Both go through render(), so the outcome never depends on which effect ran
// last.
// ---------------------------------------------------------------------------
const BRAND = "NABS Racing League";

let fallback = BRAND;
let specific = null;

function render() {
  document.title = specific || fallback;
}

export function setFallbackTitle(title) {
  fallback = title || BRAND;
  render();
}

// Claim the title while this component is mounted. Passing null gives it back.
export function useSpecificTitle(title) {
  useEffect(() => {
    if (!title) return;
    specific = title;
    render();
    return () => {
      specific = null;
      render();
    };
  }, [title]);
}

// Circuits that stay in capitals when the name around them is tidied.
const ACRONYM_TRACKS = new Set(["COTA", "GP", "USA", "UK"]);

// A track name fit for a title. The archive is inconsistent about capitals
// ("KYALAMI" in the early seasons, "interlagos" in one round), which never showed
// on the site because its styling shouts them anyway, but does show in a tab and
// in a search result. Mirrors the server's prettyTrack().
export function prettyTrack(name) {
  const raw = String(name || "").trim();
  if (!raw) return raw;
  if (!/[a-z]/.test(raw)) {
    return raw.replace(/[^\s-]+/g, (w) => (ACRONYM_TRACKS.has(w) ? w : w[0] + w.slice(1).toLowerCase()));
  }
  if (!/[A-Z]/.test(raw)) return raw[0].toUpperCase() + raw.slice(1);
  return raw;
}

// Formula 1 or not, from the season's game ("F1 2007 · Assetto Corsa") with the
// series name as the fallback. Same test as the server's disciplineOf().
export function disciplineOf(game, seriesName) {
  return /\bf1\b|formula/i.test(`${game || ""} ${seriesName || ""}`) ? "Formula 1" : null;
}

// What to call a season in a heading or a title.
//
// The name is free text an admin types, and a season is often stored with just
// its number in it ("8"), which reads fine in the switcher's own list and
// nowhere else: "8 driver standings" was a real page title. A name that is
// nothing but digits therefore gets the word in front of it; anything the admin
// actually named ("Winter Series") is left alone.
//
// The server writes the same label into the shipped HTML — see the `label` in
// backend/src/lib/pageMeta.js, which follows this rule too. The two must agree,
// or the tab and the search result argue about what the season is called.
export function seasonLabelOf(season) {
  if (!season) return null;
  const name = String(season.name || "").trim();
  if (name && !/^\d+$/.test(name)) return name;
  return season.number != null ? `Season ${season.number}` : name || null;
}

// What each listing page calls itself. `label` is the season being shown; the
// two pages that are not about a single season ignore it.
const SECTIONS = {
  drivers: (label) => `${label} driver standings`,
  constructors: (label) => `${label} constructor standings`,
  teams: (label) => `${label} constructor standings`,
  races: (label) => `${label} results and race calendar`,
  results: (label) => `${label} results and race calendar`,
  calendar: (label) => `${label} results and race calendar`,
  records: () => "League records and Hall of Fame",
  live: () => "Live timing",
  attendance: (label) => `${label} sign-ups and attendance`,
};
// Sections whose title stands without a season in it (the Hall of Fame is
// all-time, live timing is now), so they can be titled before the season list
// has even loaded.
const SEASONLESS = new Set(["records", "live"]);

// The full title for an address, brand included. `season` and `series` are the
// context rows; `multi` says whether more than one series exists, which is the
// only case where naming the series earns its space.
export function titleFor(pathname, { season, series, multi } = {}) {
  const label = seasonLabelOf(season);
  const isPrimary = !multi || !!series?.isActive;
  const tail = isPrimary || !series?.name ? BRAND : `${series.name} · ${BRAND}`;

  const parts = pathname.split("/").filter(Boolean);
  const section = parts[0] === "s" && parts.length >= 3 && !parts[3] ? parts[2] : null;

  // The home page (and a series' own landing page) says what the league is, in
  // the words someone looking for one would search for. /join renders the same
  // newcomer page and its canonical points at the root, so it says the same.
  const isHome =
    !parts.length ||
    (parts.length === 1 && parts[0] === "join") ||
    (parts[0] === "s" && (parts.length === 1 || parts.length === 2));
  if (isHome) {
    const discipline = disciplineOf(season?.game, series?.name) || "Sim";
    return `${BRAND} · ${discipline} Racing on Assetto Corsa`;
  }

  const wording = section ? SECTIONS[section] : null;
  if (wording && (label || SEASONLESS.has(section))) return `${wording(label)} · ${tail}`;

  // Anything else (a driver, a team, the member-only pages) keeps the plain tab
  // label. Entity pages get their real title from the server, and the season in
  // the tab is what makes two open tabs tellable apart.
  return label ? `${series?.name && multi ? series.name : BRAND} · ${label}` : BRAND;
}
