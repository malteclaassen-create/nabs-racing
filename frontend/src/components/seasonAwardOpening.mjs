// Which season's awards the Hall of Fame opens on, given the season the site
// is viewing (the season switcher in the menu): that season's own awards, or
// else the latest handed out before it (a season still running shows the last
// awards given). A season from before the first awards shows none: a later
// season's awards would read as if they were its own. `seasons` is the list
// from GET /standings/awards, newest first; returns a season number, or null
// for no awards section.
export function openingAwardSeason(seasons, viewed) {
  if (!seasons?.length) return null;
  if (viewed == null) return seasons[0].seasonNumber;
  const own = seasons.find((s) => s.seasonNumber === viewed);
  if (own) return own.seasonNumber;
  const before = seasons.find((s) => s.seasonNumber < viewed);
  return before ? before.seasonNumber : null;
}
