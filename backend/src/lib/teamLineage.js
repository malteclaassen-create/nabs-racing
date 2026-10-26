// ---------------------------------------------------------------------------
// Which team rows across seasons are the SAME team.
//
// Team ids are per season and inconsistent ("ferrari", "s6_ferrari") and there
// is no link table for teams, so the name is what travels from season to
// season (the team page's season-by-season table and its all-time drivers).
// Matching the raw name split one team into several whenever it was typed a
// little differently ("Mclaren" / "McLaren", "Redbull" / "Red Bull") or raced
// under a sponsor name for a while ("Porsche Martini" / "Porsche").
//
// So two names are the same team when they agree after case, spaces and
// punctuation are ignored, and a renamed team is listed in RENAMES below under
// its plain name. Add a line there when a team changes its name.
// ---------------------------------------------------------------------------

const squash = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Squashed name -> the squashed name of the team it is.
const RENAMES = {
  porschemartini: "porsche",
  bmwsauber: "sauber",
};

export function teamLineageKey(name) {
  const key = squash(name);
  return RENAMES[key] ?? key;
}

// From the team rows of several seasons, the one row per season that is the
// same team as `name`: Map<seasonId, team>. Should a season hold two rows of
// the same team, the one spelled exactly like `name` wins.
export function sameTeamBySeason(teams, name) {
  const key = teamLineageKey(name);
  const out = new Map();
  for (const t of teams) {
    if (teamLineageKey(t.name) !== key) continue;
    const have = out.get(t.seasonId);
    if (!have || (have.name !== name && t.name === name)) out.set(t.seasonId, t);
  }
  return out;
}
