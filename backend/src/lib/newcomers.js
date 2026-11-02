// ---------------------------------------------------------------------------
// Newcomers signing themselves up.
//
// It used to go: sign in with Discord, press "I want to race", wait for an
// admin to link the account or create a driver in the Members tab, and only
// then answer a race. A newcomer who turned up on a Wednesday for Friday's race
// could easily miss it waiting for that click.
//
// Now the site does the admin's first step itself. The first time a signed-in
// account with no driver anywhere answers a race (or presses "Join" on its
// profile), it gets a driver of its own in that season's Reserve pool, linked
// to the Discord account, and the answer goes through like anybody else's.
//
// Before it makes a new row, the site looks hard for the person it may already
// know (recogniseBySteam): a returning driver who proved their Steam account
// is matched to the rows the race imports filed under that Steam id, and
// simply gets those back. No new row, no admin.
//
// The admins still decide who is in the league, after the fact instead of
// before, and only where something needs a look. The account is marked as new
// (MemberAccount.newDriverAt), and reviewNewcomers checks it against everything
// the league knows: a name or Discord handle that matches somebody already on
// a roster (or nearly does), a Steam account that belongs to an entry another
// login holds, a Discord account only days old. A newcomer with none of that
// needs nobody. One with any of it shows up in the Members tab's "New drivers"
// card, on the admins' To do card and in the badge, with the reason and these
// buttons:
//
//   Keep       clears the mark. Nothing else changes.
//   Same driver as …  the account is linked to the entry it really is, and
//              the row the site made is merged into it (routes/admin.js).
//   Turn away  deletes every driver row the site made for them and every
//              answer on those rows, moves the waiting list up into any seat
//              that frees, refreshes the race posts on Discord and tells the
//              member. The account is marked (turnedAwayAt) so the site never
//              signs them up by itself again; from then on they can only ask
//              ("I want to race") and an admin decides by hand, which clears
//              the mark.
//
// Doing nothing is keeping them: a newcomer nobody looks at stays a reserve.
//
// Two identity rules matter here, because nobody has looked at the account
// yet. The new row's name never repeats a name already on any roster, and
// while the account is unchecked its Discord username is not trusted as a
// handle (isUncheckedNewcomer in lib/members.js, read by lib/persons.js seasonRowForDriver and
// the season handover in routes/discordAuth.js). Otherwise renaming yourself
// on Discord after a driver who has not logged in yet, and signing up, would
// hand you that driver's row the next time those two went looking for one.
// ---------------------------------------------------------------------------
import { rmSync } from "node:fs";
import { join } from "node:path";
import { ensureReservePool } from "./reservePool.js";
import { uniqueDriverId } from "./driverHandles.js";
import { dbGetMember, applyMemberSteamId, isUncheckedNewcomer, dbClearRaceRequest } from "./members.js";
import { getLinkedDriverIds, getPersonGroups, dbLinkDrivers } from "./persons.js";
import { personKey } from "./onePerPerson.js";
import { mergeDrivers } from "../services/driverMerge.js";
import { deleteDriverOps } from "./driverDeletion.js";
import { promoteFromWaitlist } from "./waitlist.js";
import { notifyAdminsNewDriver, notifyTurnedAway, notifyAdminsRecognised } from "./notifications.js";
import { syncRaceToDiscord } from "../services/discordService.js";
import { safeUploadPath } from "./safeUpload.js";
import { UPLOADS_DIR } from "./dataDirs.js";

export { isUncheckedNewcomer };

const IMG_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
// A row counts as made for the newcomer when it was created at most this long
// before the account was marked: the mark is written right after the row.
const CREATED_SLACK_MS = 60_000;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// Why this account may NOT sign itself up, or null when it may.
//   banned          a banned account never gets this far through the API
//                   (optionalUser drops it), but the rule should not lean on it
//   second-account  it signs in as its main account; the main one is checked
//   turned-away     an admin said no once; from here it is the admin's call
export function joinBlock(account) {
  if (!account) return "no-account";
  if (Number(account.banned)) return "banned";
  if (account.mainDiscordId) return "second-account";
  if (account.turnedAwayAt) return "turned-away";
  return null;
}

// The name the new row goes by: their Discord display name, else the
// username, as long as nobody on any roster already goes by it. A newcomer
// who happens to share a name with a driver of an earlier season is usually
// that same person, and the admin links the two in one click (the Members tab
// merges the rows). Until then two drivers with one name on the entry list
// would be anybody's guess, so the new one gets a number.
export function pickNewcomerName(account, takenNames) {
  const taken = new Set([...takenNames].map(norm).filter(Boolean));
  const options = [account?.displayName, account?.username]
    .map((s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 40))
    .filter((s) => norm(s));
  const base = options[0] || "New driver";
  for (const name of options.length ? options : [base]) if (!taken.has(norm(name))) return name;
  for (let i = 2; i < 1000; i++) {
    const name = `${base} ${i}`;
    if (!taken.has(norm(name))) return name;
  }
  return base;
}

async function markNew(prisma, discordId) {
  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET
      "newDriverAt" = ${new Date().toISOString()},
      "raceRequestAt" = NULL,
      "raceRequestText" = NULL
    WHERE "discordId" = ${discordId}`;
}

// The account signs itself up in `seasonId`: a reserve driver of its own,
// linked to the login. Returns { driver, created } or { error } with one of
// joinBlock's reasons (or "no-season"). An account that already has a driver
// (a double click, two tabs) gets that one back, created: false.
//
// `race` is only for the admins' note: which race brought them in.
export async function joinAsNewcomer(prisma, { discordId, seasonId, race = null }) {
  const id = String(discordId || "");
  const account = id ? await dbGetMember(prisma, id) : null;
  const block = joinBlock(account);
  if (block) return { error: block };

  const existing = await prisma.driver.findUnique({ where: { discordUserId: id } });
  if (existing) return { driver: existing, created: false };

  // Somebody we already know, proved by Steam: their own entry, not a new one.
  // The caller books the race's season from there (seasonRowForDriver, or the
  // Reserve pool for a season they have no row in yet).
  const known = await recogniseBySteam(prisma, id);
  if (known?.driver) return { driver: known.driver, created: false, recognised: known.recognised };

  const pool = seasonId ? await ensureReservePool(prisma, seasonId) : null;
  if (!pool) return { error: "no-season" };

  const everyone = await prisma.driver.findMany({ select: { name: true } });
  const name = pickNewcomerName(account, everyone.map((d) => d.name));
  let driver;
  try {
    driver = await prisma.driver.create({
      data: {
        id: await uniqueDriverId(prisma, name),
        name,
        // Their Discord username, the same as an admin's "New driver" button
        // writes. Not used as a handle while the account is unchecked (see the
        // note at the top).
        discordName: account.username,
        teamId: pool.id,
        tier: 0,
        isActive: true,
        seasonId,
        discordUserId: id,
        discordAvatar: account.avatarUrl ?? null,
      },
    });
  } catch (e) {
    // Two answers at once: both found no driver, one created it, the other hit
    // the unique Discord id (or the same fresh row id). That row is theirs.
    const raced = await prisma.driver.findUnique({ where: { discordUserId: id } });
    if (raced) return { driver: raced, created: false };
    throw e;
  }

  await markNew(prisma, id);
  // A Steam account proved on the welcome page goes onto the row now, so the
  // import of the very race they signed up for matches them by Steam id.
  await applyMemberSteamId(prisma, id, driver.id);
  const marked = await dbGetMember(prisma, id).catch(() => null);
  notifyAdminsNewDriver(prisma, marked || account, { driver, race }).catch(() => {});
  return { driver, created: true };
}

// An admin kept the newcomer: off the "New drivers" list, nothing else.
export async function keepNewcomer(prisma, discordId) {
  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET "newDriverAt" = NULL WHERE "discordId" = ${String(discordId)}`;
}

// An admin decided by hand (linked the account, or made its driver): neither
// "new" nor "turned away" applies any more.
export async function settleNewcomer(prisma, discordId) {
  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET "newDriverAt" = NULL, "turnedAwayAt" = NULL
    WHERE "discordId" = ${String(discordId)}`;
}

// The driver rows the site made for a newcomer: the row carrying the login and
// every row person-linked to it (a second series signs them up through the
// usual Reserve-pool route in routes/events.js), as long as it was created
// after the account was marked. A row an admin linked from an earlier season
// is older than that and never counts.
export async function newcomerRows(prisma, account) {
  if (!account?.discordId) return [];
  const own = await prisma.driver.findUnique({ where: { discordUserId: String(account.discordId) } });
  if (!own) return [];
  const ids = await getLinkedDriverIds(prisma, own.id).catch(() => [own.id]);
  const rows = await prisma.driver.findMany({
    where: { id: { in: [...new Set([own.id, ...ids])] } },
    include: {
      team: { select: { name: true, tier: true } },
      season: { select: { name: true } },
      _count: { select: { results: true } },
    },
  });
  const since = new Date(account.newDriverAt || 0).getTime();
  if (!account.newDriverAt || !Number.isFinite(since)) return rows.filter((r) => r.id === own.id);
  return rows.filter((r) => new Date(r.createdAt).getTime() >= since - CREATED_SLACK_MS);
}

// Pictures uploaded for a deleted row are named after its id. Driver ids are
// slugs of the name, so the next "Max" to sign up would otherwise find the
// last one's photo waiting under his id.
function removeRowPictures(driverId) {
  for (const dir of [join(UPLOADS_DIR, "avatars"), join(UPLOADS_DIR, "cards")]) {
    for (const ext of IMG_EXTS) {
      const file = safeUploadPath(dir, `${driverId}${ext}`);
      if (!file) continue;
      try {
        rmSync(file, { force: true });
      } catch {
        /* a picture left behind is not worth failing the turn-away for */
      }
    }
  }
}

// Turn a newcomer away: see the note at the top. Throws with .status on a
// refusal. Returns { removed: [{ id, name }], answers } where answers counts the
// upcoming races they had answered.
export async function turnAwayNewcomer(prisma, discordId) {
  const account = await dbGetMember(prisma, String(discordId));
  if (!account) throw fail(404, "Account not found");
  if (!account.newDriverAt) {
    throw fail(409, "Only a new driver nobody has kept yet can be turned away. Remove other drivers in the Drivers tab.");
  }
  const rows = await newcomerRows(prisma, account);
  const raced = rows.find((r) => r._count.results > 0);
  if (raced) {
    throw fail(
      409,
      `${raced.name} has race results in ${raced.season?.name || "a season"} now, so turning them away would change the results. Keep them, or ban the account in the Members tab.`
    );
  }
  const ids = rows.map((r) => r.id);

  // What their answers were, read before they go: a seat they held is handed
  // to the waiting list, and every race they answered gets its Discord post
  // redone so their name leaves it.
  const answers = ids.length
    ? await prisma.raceRsvp.findMany({
        where: { driverId: { in: ids } },
        include: { race: { select: { id: true, number: true, track: true, seasonId: true, isCompleted: true } } },
      })
    : [];
  const filled = ids.length
    ? await prisma.seatOffer.findMany({ where: { filledById: { in: ids } }, select: { raceId: true } })
    : [];

  // One transaction per row, like the bulk delete: a row the foreign keys
  // refuse leaves the others deleted and says which.
  for (const id of ids) await prisma.$transaction(deleteDriverOps(prisma, id));
  for (const id of ids) removeRowPictures(id);

  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET
      "newDriverAt" = NULL,
      "turnedAwayAt" = ${new Date().toISOString()},
      "raceRequestAt" = NULL,
      "raceRequestText" = NULL
    WHERE "discordId" = ${String(account.discordId)}`;

  const upcoming = answers.filter((a) => a.race && !a.race.isCompleted);
  const heldSeat = new Set(upcoming.filter((a) => a.status === "ACCEPTED").map((a) => a.raceId));
  for (const raceId of heldSeat) await promoteFromWaitlist(prisma, raceId);
  const touched = new Set([...upcoming.map((a) => a.raceId), ...filled.map((f) => f.raceId)]);
  for (const raceId of touched) await syncRaceToDiscord(prisma, raceId).catch(() => null);

  const races = [...new Map(upcoming.map((a) => [a.raceId, a.race])).values()];
  await notifyTurnedAway(prisma, { discordId: String(account.discordId), races });
  return { removed: rows.map((r) => ({ id: r.id, name: r.name })), answers: races.length };
}

// ---------------------------------------------------------------------------
// Recognising somebody the league already knows.
//
// The one proof the site has that a login is a particular driver is Steam: the
// member signs in through Steam (routes/steamAuth.js), which proves the
// account is theirs, and every race import files a driver's results under the
// Steam id their game reported (Driver.steamId). The same id on both ends is
// the same human, whatever either of them calls themselves today.
//
// Names are no proof. Anybody can take a Discord name, and anybody can type
// one into their profile, which is why nothing here links on a name. A name
// that matches is a reason for an admin to look (reviewNewcomers below), not a
// reason to hand over a driver.
//
// Returns:
//   null                       nothing to go on (no proved Steam id, no rows
//                              with it, or the login is not one this applies to)
//   { driver, recognised }     linked: `driver` is the row carrying the login
//                              now, `recognised` the entry they were found as
//   { conflict, rows }         the Steam id leads somewhere this cannot settle
//                              alone ("several" people, or rows "claimed" by
//                              another login). Left for an admin.
// ---------------------------------------------------------------------------
export async function recogniseBySteam(prisma, discordId) {
  const id = String(discordId || "");
  const account = id ? await dbGetMember(prisma, id) : null;
  if (!account?.steamId) return null;
  // A ban, a second account (it signs in as its main one) and a turn-away are
  // all decisions somebody made about this login. Not undone from here.
  if (Number(account.banned) || account.mainDiscordId || account.turnedAwayAt) return null;

  // Only for a login with no driver, or with the rows the site made for it.
  // A driver an admin set up or kept is already where they belong.
  const own = await prisma.driver.findUnique({ where: { discordUserId: id } });
  if (own && !account.newDriverAt) return null;
  const ownIds = new Set(own ? await getLinkedDriverIds(prisma, own.id).catch(() => [own.id]) : []);
  if (own) ownIds.add(own.id);

  // Their own rows carry the Steam id too (applyMemberSteamId copies it on),
  // and are not the entry being looked for. Raw SQL, the way every path reads
  // this column (a dev server's generated client may predate it).
  const hitIds = (
    await prisma.$queryRawUnsafe(`SELECT "id" FROM "Driver" WHERE "steamId" = ?`, String(account.steamId))
  ).map((r) => r.id).filter((x) => !ownIds.has(x));
  if (!hitIds.length) return null;
  const hits = await prisma.driver.findMany({ where: { id: { in: hitIds } } });
  if (!hits.length) return null;

  const { byDriver, byPerson } = await getPersonGroups(prisma);
  const people = new Set(hits.map((d) => personKey(d.id, byDriver)));
  if (people.size > 1) return { conflict: "several", rows: hits };
  const key = [...people][0];
  const personIds = key.startsWith("row:") ? [hits[0].id] : byPerson.get(key) || [hits[0].id];
  const rows = await prisma.driver.findMany({
    where: { id: { in: personIds } },
    include: { season: { select: { id: true, number: true, isActive: true, name: true } } },
  });
  // Somebody else signs in as this driver already: maybe their second Discord
  // account, maybe a mix-up. Either way not for the site to move.
  const claimed = rows.filter((r) => r.discordUserId && r.discordUserId !== id);
  if (claimed.length) return { conflict: "claimed", rows: claimed };

  // The entry the login goes onto: their row in a running season, newest
  // first, else their newest row.
  rows.sort(
    (a, b) =>
      (b.season?.isActive ? 1 : 0) - (a.season?.isActive ? 1 : 0) || (b.season?.number ?? 0) - (a.season?.number ?? 0)
  );
  const target = rows[0];

  // Rows the site made for them before Steam gave them away: the one in a
  // season their old entry also has is folded into it, answers and all
  // (services/driverMerge.js moves the login along when it merges); any other
  // stays, as the same person.
  const fresh = own ? await newcomerRows(prisma, account) : [];
  for (const r of fresh) {
    const twin = rows.find((x) => x.seasonId === r.seasonId);
    if (twin) await mergeDrivers(prisma, { keepId: twin.id, dropId: r.id });
  }
  const leftover = fresh.filter((r) => !rows.some((x) => x.seasonId === r.seasonId)).map((r) => r.id);
  if (leftover.length) await dbLinkDrivers(prisma, [target.id, ...leftover]).catch(() => {});

  // No row of their own at all: the login goes straight onto the old entry.
  let login = await prisma.driver.findUnique({ where: { discordUserId: id } });
  if (!login) {
    login = await prisma.driver.update({
      where: { id: target.id },
      data: { discordUserId: id, discordAvatar: account.avatarUrl ?? undefined },
    });
  }

  await settleNewcomer(prisma, id);
  await dbClearRaceRequest(prisma, id).catch(() => {});
  await applyMemberSteamId(prisma, id, login.id).catch(() => null);
  notifyAdminsRecognised(prisma, account, { driver: target }).catch(() => {});
  return { driver: login, recognised: { id: target.id, name: target.name, seasonName: target.season?.name || null } };
}

// When a Discord account was made: Discord ids carry their own creation time
// (the top bits are milliseconds since 2015). null when the id is not one.
const DISCORD_EPOCH = 1420070400000n;
export function discordCreatedAt(discordId) {
  try {
    const ms = Number((BigInt(String(discordId)) >> 22n) + DISCORD_EPOCH);
    return ms > Number(DISCORD_EPOCH) && ms < Date.now() + 86_400_000 ? new Date(ms) : null;
  } catch {
    return null;
  }
}

// A Discord account younger than this when it signed up is worth a look: the
// usual shape of a throwaway, or of somebody's second account.
export const NEW_ACCOUNT_DAYS = 30;

// Two names close enough that an admin should see them side by side. Equal
// once case, accents and punctuation are gone; one inside the other when both
// are long enough to mean something ("maltegoat" and "maltegoat86"); or one
// letter apart in a longer name ("Verstapen").
export function similarNames(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const short = Math.min(x.length, y.length);
  if (short >= 5 && (x.includes(y) || y.includes(x))) return true;
  return short >= 6 && Math.abs(x.length - y.length) <= 1 && editDistanceAtMostOne(x, y);
}

function editDistanceAtMostOne(x, y) {
  if (x.length > y.length) [x, y] = [y, x];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (x.length === y.length) i++;
    j++;
  }
  return edits + (y.length - j) + (x.length - i) <= 1;
}

// What the admins should know about each newcomer still marked as new, keyed
// by Discord id. Only the accounts that hold a driver count (one whose row an
// admin deleted by hand has been dealt with). For each:
//
//   matches        entries already in the league that may be the same person,
//                  one per person, with why: "steam" (their proved Steam id is
//                  on it), "handle" (their Discord username is the handle an
//                  admin wrote on it), "name" (same name), "similar" (nearly);
//                  `claimed` when another login holds that entry
//   newAccountDays how old the Discord account was at sign-up, when that is
//                  under NEW_ACCOUNT_DAYS
//   lastSeenOnDiscord  the last day the league's bot saw them talk or sit in
//                  voice; null when never, undefined when the bot has not been
//                  reporting at all (then it says nothing either way)
//   needsCheck     any match, or a brand-new account. Only these reach the
//                  admins' To do card and the badges; the rest need nobody.
export async function reviewNewcomers(prisma) {
  const marked = await prisma.$queryRaw`
    SELECT * FROM "MemberAccount" WHERE "newDriverAt" IS NOT NULL AND "mainDiscordId" IS NULL`.catch(() => []);
  const out = new Map();
  if (!marked.length) return out;

  const [drivers, steamRows, groups, resultCounts, seen, botAlive] = await Promise.all([
    prisma.driver.findMany({
      select: {
        id: true, name: true, discordName: true, discordUserId: true, seasonId: true,
        season: { select: { name: true, number: true, isActive: true } },
      },
    }),
    prisma.$queryRawUnsafe(`SELECT "id", "steamId" FROM "Driver" WHERE "steamId" IS NOT NULL`).catch(() => []),
    getPersonGroups(prisma),
    prisma.raceResult.groupBy({ by: ["driverId"], _count: { _all: true } }).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT "discordId", MAX("day") AS "lastDay" FROM "TokenActivity" WHERE "discordId" IN (${marked.map(() => "?").join(",")}) GROUP BY "discordId"`,
      ...marked.map((m) => String(m.discordId))
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT 1 AS "x" FROM "TokenActivity" WHERE "day" >= ? LIMIT 1`,
      new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    ).then((r) => r.length > 0).catch(() => false),
  ]);
  const steamOf = new Map(steamRows.map((r) => [r.id, String(r.steamId)]));
  const starts = new Map(resultCounts.map((r) => [r.driverId, r._count?._all || 0]));
  const lastSeen = new Map(seen.map((r) => [String(r.discordId), r.lastDay]));
  const byId = new Map(drivers.map((d) => [d.id, d]));

  for (const account of marked) {
    const id = String(account.discordId);
    const own = drivers.find((d) => d.discordUserId === id);
    if (!own) continue;
    const ownKey = personKey(own.id, groups.byDriver);
    const ownIds = new Set(
      ownKey.startsWith("row:") ? [own.id] : groups.byPerson.get(ownKey) || [own.id]
    );
    // What they go by: their Discord names, and the name on their new row
    // (which they may have changed on their profile since).
    const theirNames = [account.displayName, account.username, own.name].filter(Boolean);
    const handle = norm(account.username);

    const people = new Map();
    for (const d of drivers) {
      if (ownIds.has(d.id)) continue;
      const why = new Set();
      if (account.steamId && steamOf.get(d.id) === String(account.steamId)) why.add("steam");
      if (handle && norm(d.discordName) === handle) why.add("handle");
      for (const n of theirNames) {
        if (norm(n) && (norm(n) === norm(d.name) || norm(n) === norm(d.discordName))) why.add("name");
        else if (similarNames(n, d.name)) why.add("similar");
      }
      if (!why.size) continue;
      const key = personKey(d.id, groups.byDriver);
      const entry = people.get(key) || { rows: [], why: new Set() };
      entry.rows.push(d);
      for (const w of why) entry.why.add(w);
      people.set(key, entry);
    }

    const matches = [...people.entries()].map(([key, { rows, why }]) => {
      const all = key.startsWith("row:") ? rows : (groups.byPerson.get(key) || []).map((x) => byId.get(x)).filter(Boolean);
      const pick = [...all].sort(
        (a, b) =>
          (b.season?.isActive ? 1 : 0) - (a.season?.isActive ? 1 : 0) || (b.season?.number ?? 0) - (a.season?.number ?? 0)
      )[0];
      const claimedBy = all.find((r) => r.discordUserId && r.discordUserId !== id)?.discordUserId || null;
      if (why.has("name")) why.delete("similar");
      return {
        driverId: pick.id,
        name: pick.name,
        seasonName: pick.season?.name || null,
        activeSeason: !!pick.season?.isActive,
        starts: all.reduce((n, r) => n + (starts.get(r.id) || 0), 0),
        why: [...why],
        claimed: !!claimedBy,
      };
    });
    const rank = (m) => (m.why.includes("steam") ? 4 : m.why.includes("handle") ? 3 : m.why.includes("name") ? 2 : 1);
    matches.sort((a, b) => rank(b) - rank(a) || b.starts - a.starts);

    const created = discordCreatedAt(id);
    const signedUp = new Date(account.newDriverAt).getTime();
    const ageDays = created && Number.isFinite(signedUp) ? Math.floor((signedUp - created.getTime()) / 86_400_000) : null;
    const newAccountDays = ageDays != null && ageDays < NEW_ACCOUNT_DAYS ? Math.max(0, ageDays) : null;

    out.set(id, {
      matches: matches.slice(0, 5),
      newAccountDays,
      lastSeenOnDiscord: botAlive ? lastSeen.get(id) || null : undefined,
      needsCheck: matches.length > 0 || newAccountDays != null,
    });
  }
  return out;
}
