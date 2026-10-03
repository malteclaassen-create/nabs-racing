// ---------------------------------------------------------------------------
// Who pressed the in-game report button, as a Discord account.
//
// The button sends a name and nothing else, and the name is whatever the driver
// typed into Content Manager. The ingest matches it against the roster, which
// works for most people and silently fails for anyone racing under another name
// ("Urmaggedon" on the server, "urma" on the roster). Such a report still lands,
// but with no account on it, so it never shows up under the driver's own
// "My reports" and they cannot answer in the thread.
//
// Assetto Corsa itself knows the person by Steam GUID. The live server has it
// while the race is on, and the round's result file has it once imported
// (lib/reportAnchor.js reporterGuids already reads both name maps). The GUID is
// on the roster (Driver.steamId) or on the login (MemberAccount.steamId), which
// leads to the Discord account. That is what this does, and it writes the
// answer onto the report so the question is asked once.
// ---------------------------------------------------------------------------

import { discordIdsForDrivers } from "./persons.js";
import { reporterGuids } from "./reportAnchor.js";

// GUID -> Discord id, for the GUIDs that lead to exactly one account. The
// roster is asked first (the league's own record of who raced under that
// GUID), the "Sign in through Steam" logins only for GUIDs the roster has no
// account for. Where either source names two different people the GUID is left
// out rather than guessed at: a wrong link would show one driver another's
// report. That happens for real: drivers move to a new Discord account.
export async function discordIdsForGuids(prisma, guids) {
  const ids = [...new Set((guids || []).filter(Boolean).map(String))];
  const out = new Map();
  if (!ids.length) return out;
  const ph = ids.map(() => "?").join(",");
  const fromRoster = new Map(ids.map((g) => [g, new Set()]));
  const fromLogin = new Map(ids.map((g) => [g, new Set()]));

  const drivers = await prisma
    .$queryRawUnsafe(`SELECT "id", "steamId" FROM "Driver" WHERE "steamId" IN (${ph})`, ...ids)
    .catch(() => []);
  const viaDriver = await discordIdsForDrivers(
    prisma,
    drivers.map((d) => d.id)
  ).catch(() => new Map());
  for (const d of drivers) {
    const discord = viaDriver.get(d.id);
    if (discord) fromRoster.get(String(d.steamId))?.add(String(discord));
  }

  const accounts = await prisma
    .$queryRawUnsafe(`SELECT "discordId", "steamId" FROM "MemberAccount" WHERE "steamId" IN (${ph})`, ...ids)
    .catch(() => []);
  for (const a of accounts) if (a.discordId) fromLogin.get(String(a.steamId))?.add(String(a.discordId));

  for (const guid of ids) {
    const set = fromRoster.get(guid).size ? fromRoster.get(guid) : fromLogin.get(guid);
    if (set.size === 1) out.set(guid, [...set][0]);
  }
  return out;
}

// Fills in the account on in-game reports that came in without one, where the
// GUID can now be worked out. Returns the same list with the links applied, and
// saves each new link. Never overwrites an account already on a report.
//
// `races` are the rounds in reporterGuids' shape (season number, round number,
// sprint flag), which is what lets it read the round's result file.
export async function linkInGameReporters(prisma, reports, races = [], knownGuids = null) {
  const loose = (reports || []).filter((r) => r.source === "INGAME" && !r.reporterDiscordId && r.reporterName);
  if (!loose.length) return reports;
  const guids = knownGuids || (await reporterGuids(prisma, loose, races).catch(() => new Map()));
  const accounts = await discordIdsForGuids(
    prisma,
    loose.map((r) => guids.get(r.id))
  );
  if (!accounts.size) return reports;

  const linked = new Map();
  for (const r of loose) {
    const discord = accounts.get(String(guids.get(r.id) || ""));
    if (!discord) continue;
    await prisma
      .$executeRawUnsafe(
        `UPDATE "Report" SET "reporterDiscordId" = ? WHERE "id" = ? AND "reporterDiscordId" IS NULL`,
        discord,
        r.id
      )
      .then(() => linked.set(r.id, discord))
      .catch(() => {});
  }
  if (!linked.size) return reports;
  return reports.map((r) => (linked.has(r.id) ? { ...r, reporterDiscordId: linked.get(r.id) } : r));
}
