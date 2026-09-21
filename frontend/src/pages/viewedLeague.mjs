// ---------------------------------------------------------------------------
// Which league a Personal Area panel is about.
//
// Used by both panels that show one league's things: My Rating (the numbers)
// and the profile editor (the driver card and the public-page preview).
//
// A rating is a LEAGUE's rating. It ranks you against that league's field over
// that series' seasons, so a person racing in two of them carries two ratings
// that are not comparable — and the card on their public page is the one for
// the league that page belongs to.
//
// The backend answers for the row the Discord link sits on (Driver.discordUserId
// is unique, and the login heals within that row's series only, never sideways).
// That is one league of possibly several, and it is not necessarily the one the
// site is viewing: switch the series in the header and the card changes while
// the rating panel did not, which reads as the numbers simply being wrong.
//
// So a panel names the row it wants: the league matching the viewed series by
// default, or whichever league the reader picks by hand. Kept free of React so
// the choice itself can be tested.
// ---------------------------------------------------------------------------

// `leagues` = api.myLeagues() rows ([{ driverId, seriesSlug, isActing, … }],
// the login's own league first); `slug` = the series the site is viewing.
//
// Returns the row to ask for, or null when there is nothing to choose: with one
// league (or none loaded yet) the backend's own fallback is already right, and
// naming a row would only add a query parameter that changes nothing.
export function leagueRowFor(leagues, slug) {
  if (!leagues || leagues.length < 2) return null;
  // The viewed series wins. A member browsing a league they don't race in
  // falls back to their own row rather than to an empty panel — the picker
  // then says which league they are looking at.
  return (slug && leagues.find((l) => l.seriesSlug === slug)) || leagues.find((l) => l.isActing) || leagues[0];
}

// The row the panel actually reads: the reader's own pick while it is still one
// of their leagues, else whatever the viewed series resolves to. A pick that no
// longer exists (the leagues reloaded, a season rolled over) falls back rather
// than blanking the panel.
export function pickedLeague(leagues, slug, pick) {
  return (pick && (leagues || []).find((l) => l.driverId === pick)) || leagueRowFor(leagues, slug);
}

// Which card the /profile/card editor opens on, out of api.myCardSeasons()
// rows ([{ driverId, seasonNumber, seriesSlug, … }]). The same question one
// level down: those chips carry every season of every league, and the page
// started on the login's own row whatever the header said — so the button
// that says "Edit driver card" under a Sunday card opened the Friday one.
//
// `fallbackId` is the acting row (api.me), for when the viewed series has no
// row here — including while the chips are still loading.
export function cardRowFor(seasons, slug, fallbackId) {
  const rows = (seasons || []).filter((s) => slug && s.seriesSlug === slug);
  if (!rows.length) return fallbackId;
  // The newest season of that league is the card the person wears today; the
  // older ones stay one chip away.
  return rows.reduce((best, s) => ((s.seasonNumber ?? -1) > (best.seasonNumber ?? -1) ? s : best)).driverId;
}
