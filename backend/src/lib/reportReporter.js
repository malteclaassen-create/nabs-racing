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
import { getAltMap, mainOf } from "./members.js";

// GUID -> Discord id, for the GUIDs that lead to exactly one account. The
// roster is asked first (the league's own record of who raced under that
// GUID), the "Sign in through Steam" logins only for GUIDs the roster has no
// account for. Where either source names two different people the GUID is left
// out rather than guessed at: a wrong link would show one driver another's
// report. That happens for real: drivers move to a new Discord account.
//
// `seasonId` is the season the report's round belongs to. The driver row of
// THAT season is asked before all the others: it is who raced in that round
// under that GUID. urma is the case: his Friday row is on his new account,
// his Sunday row is joined with an old row on his old one, so across the
// whole roster his GUID names two accounts, while in the Friday season it
// names one.
export async function discordIdsForGuids(prisma, guids, { seasonId = null } = {}) {
  const ids = [...new Set((guids || []).filter(Boolean).map(String))];
  const out = new Map();
  if (!ids.length) return out;
  const ph = ids.map(() => "?").join(",");
  const fromSeason = new Map(ids.map((g) => [g, new Set()]));
  const fromRoster = new Map(ids.map((g) => [g, new Set()]));
  const fromLogin = new Map(ids.map((g) => [g, new Set()]));

  const drivers = await prisma
    .$queryRawUnsafe(`SELECT "id", "steamId", "seasonId" FROM "Driver" WHERE "steamId" IN (${ph})`, ...ids)
    .catch(() => []);
  const viaDriver = await discordIdsForDrivers(
    prisma,
    drivers.map((d) => d.id)
  ).catch(() => new Map());
  for (const d of drivers) {
    const discord = viaDriver.get(d.id);
    if (!discord) continue;
    fromRoster.get(String(d.steamId))?.add(String(discord));
    if (seasonId && String(d.seasonId) === String(seasonId)) fromSeason.get(String(d.steamId))?.add(String(discord));
  }

  const accounts = await prisma
    .$queryRawUnsafe(`SELECT "discordId", "steamId" FROM "MemberAccount" WHERE "steamId" IN (${ph})`, ...ids)
    .catch(() => []);
  for (const a of accounts) if (a.discordId) fromLogin.get(String(a.steamId))?.add(String(a.discordId));

  // A second account counts as its main one (lib/accountLinks.js): the same
  // person on two accounts is one answer, not two.
  const altMap = await getAltMap(prisma).catch(() => new Map());
  const one = (raw) => {
    const set = new Set([...raw].map((id) => mainOf(altMap, id)));
    return set.size === 1 ? [...set][0] : null;
  };
  for (const guid of ids) {
    const found =
      one(fromSeason.get(guid)) ||
      (fromRoster.get(guid).size ? one(fromRoster.get(guid)) : one(fromLogin.get(guid)));
    if (found) out.set(guid, found);
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
  // Asked once per season, so each report is answered by its own season's
  // roster first (see discordIdsForGuids).
  const seasonOf = new Map((races || []).map((x) => [x.id, x.season?.id || null]));
  const bySeason = new Map();
  for (const r of loose) {
    const guid = guids.get(r.id);
    if (!guid) continue;
    const season = seasonOf.get(r.raceId) || null;
    if (!bySeason.has(season)) bySeason.set(season, new Set());
    bySeason.get(season).add(String(guid));
  }
  const accounts = new Map();
  for (const [season, set] of bySeason) {
    accounts.set(season, await discordIdsForGuids(prisma, [...set], { seasonId: season }));
  }

  const linked = new Map();
  for (const r of loose) {
    const discord = accounts.get(seasonOf.get(r.raceId) || null)?.get(String(guids.get(r.id) || ""));
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
