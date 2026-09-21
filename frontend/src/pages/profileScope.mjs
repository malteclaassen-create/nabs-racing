// ---------------------------------------------------------------------------
// Which league the Personal Area is about.
//
// Somebody racing in two series has a profile row — name, number, team, card —
// in each of them, and the Discord login sits on exactly ONE of those rows.
// The backend answers /api/me with that row, which is not necessarily the
// league the site is viewing: switch the series in the header, open the
// Personal Area, and the Friday card looked back at you while the header (and
// every public page) said Sunday.
//
// So the page follows the viewed series, the way the My Rating panel already
// does (myRatingLeague.mjs) — the "Applies to" picker then says which league
// is being edited, and the reader can still put it anywhere by hand. Kept free
// of React so the choice itself can be tested.
// ---------------------------------------------------------------------------

// `leagues` = api.myLeagues() rows ([{ driverId, seriesSlug, isActing, … }],
// the login's own row first); `slug` = the series the site is viewing.
//
// Returns the scope the editor should start on: a league row's driverId, or
// "all" (= every league at once, which is what the page did before knowing the
// series). One league means there is nothing to scope — the picker is hidden
// then, and "all" is that single row anyway.
export function defaultProfileScope(leagues, slug) {
  if (!leagues || leagues.length < 2) return "all";
  const row = slug ? leagues.find((l) => l.seriesSlug === slug) : null;
  // Browsing a league this person does NOT race in leaves the scope on every
  // league: guessing one of their others would be no more right than the row
  // the login happens to sit on, which is the bug this exists for.
  return row ? row.driverId : "all";
}

// The scope the page actually uses: the reader's own pick while it is still one
// of their leagues ("all" always is), else whatever the viewed series resolves
// to. A pick that no longer exists (the leagues reloaded, a season rolled over)
// falls back rather than scoping the form to nothing.
export function pickedProfileScope(leagues, slug, pick) {
  if (pick === "all") return "all";
  if (pick && (leagues || []).some((l) => l.driverId === pick)) return pick;
  return defaultProfileScope(leagues, slug);
}

// Which card the /profile/card editor opens on, out of api.myCardSeasons()
// rows ([{ driverId, seasonNumber, seriesSlug, … }]). Same idea one level
// down: the chips carry every season of every league, and the page used to
// start on the login's own row whatever the header said.
//
// `fallbackId` is the acting row (api.me), used when the viewed series has no
// row here — including when the chips have not loaded yet.
export function cardRowFor(seasons, slug, fallbackId) {
  const rows = (seasons || []).filter((s) => slug && s.seriesSlug === slug);
  if (!rows.length) return fallbackId;
  // The newest season of that league is the card the person wears today; the
  // older ones stay one chip away.
  return rows.reduce((best, s) => ((s.seasonNumber ?? -1) > (best.seasonNumber ?? -1) ? s : best)).driverId;
}
