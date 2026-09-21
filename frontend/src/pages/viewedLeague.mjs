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
