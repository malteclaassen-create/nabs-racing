// Fields on a Driver row that identify the person BEHIND the racing nickname:
// the Discord account they log in with and the Steam account their lap times
// were imported from. The league is pseudonymous by default, so these must
// never reach a public response — a full roster carrying them would map every
// nickname to a real, contactable account (and a Steam profile usually carries
// the real name and friend list on top).
//
// They stay available to admins, who need them for the Drivers tab (link an
// account by hand) and for the result import (match by Steam GUID).
export const PRIVATE_DRIVER_FIELDS = ["discordUserId", "steamId", "inheritedDiscordUserId"];

// Removes the fields above from a driver object IN PLACE. Deliberately a
// denylist rather than a hand-written allowlist: several Driver columns are
// managed in raw SQL (role, hideFromStandings, cardStyle, …) and are attached
// to the object after the Prisma query, so an allowlist here would silently
// drop them and break the roster. If a future column carries contact data,
// add it to PRIVATE_DRIVER_FIELDS.
export function stripPrivateDriverFields(driver) {
  if (!driver) return driver;
  for (const key of PRIVATE_DRIVER_FIELDS) delete driver[key];
  return driver;
}
