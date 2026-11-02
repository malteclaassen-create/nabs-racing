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
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ensureReservePool } from "./reservePool.js";
import { driverHandle } from "./driverHandles.js";
import { dbGetMember, applyMemberSteamId, isUncheckedNewcomer, dbClearRaceRequest } from "./members.js";
import { getLinkedDriverIds, getPersonGroups, dbLinkDrivers, dbMergeDuplicateAnswers } from "./persons.js";
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
//   admin-hold      an admin took this login off its driver by hand
//                   (manualLinkAt); the same: only an admin links it again
export function joinBlock(account) {
  if (!account) return "no-account";
  if (Number(account.banned)) return "banned";
  if (account.mainDiscordId) return "second-account";
  if (account.turnedAwayAt) return "turned-away";
  if (account.manualLinkAt) return "admin-hold";
  return null;
}

// Whether a block means "ask an admin" (the hand-raise is what is left) rather
// than "not this account at all".
export const ASK_INSTEAD = new Set(["turned-away", "admin-hold"]);

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

// Whether pictures are still on disk under this row id (a row deleted by a
// turn-away, or merged away with its photo still pointing at the file).
function picturesExist(driverId) {
  for (const dir of [join(UPLOADS_DIR, "avatars"), join(UPLOADS_DIR, "cards")]) {
    for (const ext of IMG_EXTS) {
      const file = safeUploadPath(dir, `${driverId}${ext}`);
      if (file && existsSync(file)) return true;
    }
  }
  return false;
}

// A row id for a new driver called `name`: the handle, numbered on when that
// id is taken or still has somebody's pictures lying under it. Uploads are
// named after the row id, so reusing one would put the old pictures (or a
// merged driver's photo, still pointing at its old file) on the new row.
async function freshDriverId(prisma, name) {
  const base = driverHandle(name);
  for (let i = 1; i < 10_000; i++) {
    const id = i === 1 ? base : `${base}_${i}`;
    if (!(await prisma.driver.findUnique({ where: { id } })) && !picturesExist(id)) return id;
  }
  return `${base}_${Date.now().toString(36)}`;
}

// Mark rows as made by the site for an unchecked newcomer (Driver.selfMadeAt):
// no name match lands on them. Best-effort: the sign-up stands either way.
export async function markSelfMade(prisma, driverIds) {
  for (const id of driverIds || []) {
    await prisma.$executeRawUnsafe(`UPDATE "Driver" SET "selfMadeAt" = ? WHERE "id" = ?`, new Date().toISOString(), id).catch(() => {});
  }
}

// An admin has looked: the rows of this login's person are ordinary rows now.
async function clearSelfMade(prisma, discordId) {
  try {
    const own = await prisma.driver.findUnique({ where: { discordUserId: String(discordId) } });
    if (!own) return;
    const ids = [...new Set([own.id, ...(await getLinkedDriverIds(prisma, own.id).catch(() => []))])];
    await prisma.$executeRawUnsafe(
      `UPDATE "Driver" SET "selfMadeAt" = NULL WHERE "id" IN (${ids.map(() => "?").join(",")})`,
      ...ids
    );
  } catch {
    /* best-effort */
  }
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
        id: await freshDriverId(prisma, name),
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
  await markSelfMade(prisma, [driver.id]);
  // A Steam account proved on the welcome page goes onto the row now, so the
  // import of the very race they signed up for matches them by Steam id.
  await applyMemberSteamId(prisma, id, driver.id);
  const marked = await dbGetMember(prisma, id).catch(() => null);
  notifyAdminsNewDriver(prisma, marked || account, { driver, race }).catch(() => {});
  return { driver, created: true };
}

// An admin kept the newcomer: off the "New drivers" list, and their rows are
// ordinary rows from now on. Nothing else changes.
export async function keepNewcomer(prisma, discordId) {
  await clearSelfMade(prisma, discordId);
  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET "newDriverAt" = NULL WHERE "discordId" = ${String(discordId)}`;
}

// The question of who this login is has been answered (an admin linked the
// account or made its driver, or Steam proved it): neither "new", "turned
// away" nor "taken off by hand" applies any more.
export async function settleNewcomer(prisma, discordId) {
  await clearSelfMade(prisma, discordId);
  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET "newDriverAt" = NULL, "turnedAwayAt" = NULL, "manualLinkAt" = NULL
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

// Delete the rows the site made for a newcomer, with every answer on them,
// then hand any seat they held to the waiting list and redo the race posts on
// Discord so their name leaves them. Rows with race results are left alone
// (and listed in `kept`): those are part of a classification now. Returns
// { removed: [{ id, name }], kept, races } where races are the upcoming ones
// they had answered.
export async function removeNewcomerRows(prisma, account) {
  const rows = await newcomerRows(prisma, account);
  const kept = rows.filter((r) => r._count.results > 0);
  const gone = rows.filter((r) => r._count.results === 0);
  const ids = gone.map((r) => r.id);

  // What their answers were, read before they go.
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
  // refuse leaves the others deleted.
  for (const id of ids) await prisma.$transaction(deleteDriverOps(prisma, id));
  for (const id of ids) removeRowPictures(id);

  const upcoming = answers.filter((a) => a.race && !a.race.isCompleted);
  const heldSeat = new Set(upcoming.filter((a) => a.status === "ACCEPTED").map((a) => a.raceId));
  for (const raceId of heldSeat) await promoteFromWaitlist(prisma, raceId);
  const touched = new Set([...upcoming.map((a) => a.raceId), ...filled.map((f) => f.raceId)]);
  for (const raceId of touched) await syncRaceToDiscord(prisma, raceId).catch(() => null);

  return {
    removed: gone.map((r) => ({ id: r.id, name: r.name })),
    kept,
    races: [...new Map(upcoming.map((a) => [a.raceId, a.race])).values()],
  };
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
  const raced = (await newcomerRows(prisma, account)).find((r) => r._count.results > 0);
  if (raced) {
    throw fail(
      409,
      `${raced.name} has race results in ${raced.season?.name || "a season"} now, so turning them away would change the results. Keep them, or ban the account in the Members tab.`
    );
  }

  // The mark goes on FIRST. A sign-up that arrives while the rows are being
  // deleted then meets "turned away" instead of finding no driver and making
  // a fresh one behind the admin's back. `account` still holds newDriverAt,
  // which is what finds the rows.
  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET
      "newDriverAt" = NULL,
      "turnedAwayAt" = ${new Date().toISOString()},
      "raceRequestAt" = NULL,
      "raceRequestText" = NULL
    WHERE "discordId" = ${String(account.discordId)}`;

  const out = await removeNewcomerRows(prisma, account);
  await notifyTurnedAway(prisma, { discordId: String(account.discordId), races: out.races });
  return { removed: out.removed, answers: out.races.length };
}

// The row the site made for a newcomer, folded into the entry they turn out to
// be (same season): everything moves over (services/driverMerge.js). Where both
// rows answered the same race the NEWER answer stays, not the kept row's: the
// one the member just gave is what they meant, the old one may be an admin's
// entry from weeks ago. Then the seat question is settled and the race posts
// redone, the way any answer change does it.
export async function foldNewRowInto(prisma, keepId, dropId) {
  const answered = await prisma.raceRsvp.findMany({
    where: { driverId: { in: [keepId, dropId] } },
    include: { race: { select: { id: true, isCompleted: true } } },
  });
  await dbMergeDuplicateAnswers(prisma, [keepId, dropId]);
  const result = await mergeDrivers(prisma, { keepId, dropId });
  const races = [...new Set(answered.filter((a) => a.race && !a.race.isCompleted).map((a) => a.raceId))];
  for (const raceId of races) {
    await promoteFromWaitlist(prisma, raceId);
    await syncRaceToDiscord(prisma, raceId).catch(() => null);
  }
  return result;
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
  // A ban, a second account (it signs in as its main one), a turn-away and an
  // admin taking the login off its driver by hand are all decisions somebody
  // made about this login. Not undone from here. The last one matters most:
  // the Steam id an admin's link once copied onto a driver is still on that
  // row after the admin unlinks it, and would otherwise put the login straight
  // back on the next visit.
  if (joinBlock(account)) return null;

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
  // account, maybe a mix-up. Either way not for the site to move. Only a real
  // login counts: a Discord id an admin typed in that nobody has ever signed
  // in with is what a link replaces anyway.
  const logins = await loginIds(prisma);
  const claimed = rows.filter((r) => r.discordUserId && r.discordUserId !== id && logins.has(String(r.discordUserId)));
  if (claimed.length) return { conflict: "claimed", rows: claimed };

  // One person, two Steam accounts on their rows: an import that matched the
  // wrong car once, or two people an admin linked as one. Which of them is
  // this login is not something to guess.
  const steamOnRows = await prisma.$queryRawUnsafe(
    `SELECT "id", "steamId" FROM "Driver" WHERE "id" IN (${rows.map(() => "?").join(",")})`,
    ...rows.map((r) => r.id)
  );
  const mixed = steamOnRows.filter((r) => r.steamId && String(r.steamId) !== String(account.steamId));
  if (mixed.length) return { conflict: "mixed", rows: rows.filter((r) => mixed.some((m) => m.id === r.id)) };

  // The entry the login goes onto: their row in a running season, newest
  // first, else their newest row.
  rows.sort(
    (a, b) =>
      (b.season?.isActive ? 1 : 0) - (a.season?.isActive ? 1 : 0) || (b.season?.number ?? 0) - (a.season?.number ?? 0)
  );
  const target = rows[0];

  // Rows the site made for them before Steam gave them away: the one in a
  // season their old entry also has is folded into it, answers and all (the
  // login moves along with the merge); any other stays, as the same person,
  // under the name and handle that person has always had.
  const fresh = own ? await newcomerRows(prisma, account) : [];
  for (const r of fresh) {
    const twin = rows.find((x) => x.seasonId === r.seasonId);
    if (twin) await foldNewRowInto(prisma, twin.id, r.id);
  }
  const leftover = fresh.filter((r) => !rows.some((x) => x.seasonId === r.seasonId)).map((r) => r.id);
  if (leftover.length) {
    await prisma.driver.updateMany({
      where: { id: { in: leftover } },
      data: { name: target.name, ...(target.discordName ? { discordName: target.discordName } : {}) },
    });
    await dbLinkDrivers(prisma, [target.id, ...leftover]).catch(() => {});
  }

  // No row of their own at all: the login goes straight onto the old entry,
  // and only while nobody else's login is on it (two of these at the same
  // moment must not overwrite each other).
  let login = await prisma.driver.findUnique({ where: { discordUserId: id } });
  if (!login) {
    const { count } = await prisma.driver.updateMany({
      where: { id: target.id, OR: [{ discordUserId: null }, { discordUserId: { notIn: [...logins] } }] },
      data: { discordUserId: id, ...(account.avatarUrl ? { discordAvatar: account.avatarUrl } : {}) },
    });
    if (!count) return { conflict: "claimed", rows: [target] };
    login = await prisma.driver.findUnique({ where: { id: target.id } });
  }

  await settleNewcomer(prisma, id);
  await dbClearRaceRequest(prisma, id).catch(() => {});
  await applyMemberSteamId(prisma, id, login.id).catch(() => null);
  notifyAdminsRecognised(prisma, account, { driver: target }).catch(() => {});
  return { driver: login, recognised: { id: target.id, name: target.name, seasonName: target.season?.name || null } };
}

// Every Discord id that has signed in on the site at least once.
async function loginIds(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT "discordId" FROM "MemberAccount"`;
    return new Set(rows.map((r) => String(r.discordId)));
  } catch {
    return new Set();
  }
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
//                  `claimed` when another login holds that entry, `typedId`
//                  when it only carries a Discord id an admin typed in that
//                  nobody signs in with (a link simply replaces that). The
//                  entry shown is the person's row in a season the newcomer
//                  has a row in where there is one, because that is the row
//                  a link merges their new row into.
//   newAccountDays how old the Discord account was at sign-up, when that is
//                  under NEW_ACCOUNT_DAYS
//   lastSeenOnDiscord  the last day the league's bot saw them talk or sit in
//                  voice; null when never, undefined when the bot has not been
//                  reporting at all (then it says nothing either way)
//   needsCheck     any match, or a brand-new account. Only these reach the
//                  admins' To do card and the badges; the rest need nobody.
export async function reviewNewcomers(prisma) {
  // A banned newcomer has been dealt with (the ban turns them away too).
  const marked = await prisma.$queryRaw`
    SELECT * FROM "MemberAccount"
    WHERE "newDriverAt" IS NOT NULL AND "mainDiscordId" IS NULL AND COALESCE("banned", 0) = 0`.catch(() => []);
  const out = new Map();
  if (!marked.length) return out;

  const [drivers, steamRows, groups, resultCounts, seen, botAlive, logins] = await Promise.all([
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
    loginIds(prisma),
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

    const ownSeasons = new Set([...ownIds].map((x) => byId.get(x)?.seasonId).filter(Boolean));
    const matches = [...people.entries()].map(([key, { rows, why }]) => {
      const all = key.startsWith("row:") ? rows : (groups.byPerson.get(key) || []).map((x) => byId.get(x)).filter(Boolean);
      const pick = [...all].sort(
        (a, b) =>
          (ownSeasons.has(b.seasonId) ? 1 : 0) - (ownSeasons.has(a.seasonId) ? 1 : 0) ||
          (b.season?.isActive ? 1 : 0) - (a.season?.isActive ? 1 : 0) ||
          (b.season?.number ?? 0) - (a.season?.number ?? 0)
      )[0];
      const others = all.filter((r) => r.discordUserId && r.discordUserId !== id);
      if (why.has("name")) why.delete("similar");
      return {
        driverId: pick.id,
        name: pick.name,
        seasonName: pick.season?.name || null,
        activeSeason: !!pick.season?.isActive,
        starts: all.reduce((n, r) => n + (starts.get(r.id) || 0), 0),
        why: [...why],
        claimed: others.some((r) => logins.has(String(r.discordUserId))),
        typedId: others.length > 0 && others.every((r) => !logins.has(String(r.discordUserId))),
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
