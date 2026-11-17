// The choices in the sign-up's Team dropdown that are not a team
// (TeamSignupCard). They are saved as the entry's team name, so the admin
// list shows them as they are; AdminTeamSignups leaves them out of its
// team count. The backend has the same list (NOT_A_TEAM in
// backend/src/lib/teamSignups.js); keep the two in step.
export const NO_TEAM = "No team yet";
export const LOOKING_FOR_TEAM = "Looking for a team";
export const NOT_A_TEAM = [NO_TEAM, LOOKING_FOR_TEAM];

export function isNotATeam(name) {
  const n = String(name || "").trim().toLowerCase();
  return NOT_A_TEAM.some((c) => c.toLowerCase() === n);
}
