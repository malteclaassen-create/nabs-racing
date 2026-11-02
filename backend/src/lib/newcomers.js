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
// The admins still decide who is in the league, after the fact instead of
// before. The account is marked as new (MemberAccount.newDriverAt) and shows
// up in the Members tab's "New drivers" list with two buttons:
//
//   Keep       clears the mark. Nothing else changes.
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
import { dbGetMember, applyMemberSteamId, isUncheckedNewcomer } from "./members.js";
import { getLinkedDriverIds } from "./persons.js";
import { deleteDriverOps } from "./driverDeletion.js";
import { promoteFromWaitlist } from "./waitlist.js";
import { notifyAdminsNewDriver, notifyTurnedAway } from "./notifications.js";
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
