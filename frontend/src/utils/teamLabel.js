// How a team is named in a dropdown that lists both divisions at once.
//
// A season with Division 2 has every team twice (McLaren in Division 1,
// McLaren in Division 2, each a team of its own), so a plain list of names
// shows two identical "McLaren" lines and only their order tells them apart.
// The Division 2 one carries the division; Division 1 keeps its plain name.
export const DIV2_TIER = 3;

export function teamLabel(team) {
  if (!team) return "";
  return team.tier === DIV2_TIER ? `${team.name} (Division 2)` : team.name;
}

// "Tier 1", "Tier 2", "Division 2", "Reserve": what a tier number means.
export function tierLabel(tier) {
  if (tier === DIV2_TIER) return "Division 2";
  if (tier === 0) return "Reserve";
  return `Tier ${tier}`;
}
