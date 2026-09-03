// ---------------------------------------------------------------------------
// In-site notifications: the bell in the nav bar. One row per event; a row
// with recipientId = null is a broadcast every member sees, a row with a
// discordId is personal (e.g. "you got the seat"). Read state is one
// timestamp per member (MemberAccount.notificationsSeenAt) — opening the bell
// marks everything seen, which is exactly how members use it.
//
// Like MemberAccount/Download/Series, managed via raw SQL (the running dev
// server locks the generated Prisma client on Windows). Keep in sync with the
// Notification model in prisma/schema.prisma.
//
// Every notify* helper is best-effort by design: a notification must never
// fail or slow down the admin action / member action that caused it.
// ---------------------------------------------------------------------------
import { randomUUID } from "crypto";
import { raceKickoff } from "./raceKickoff.js";
import { readRaceTypes } from "./raceTypes.js";
import { readHiddenRaceIds } from "./attendanceHidden.js";
import { unlockStateFor, CARD_EDITIONS } from "./cardEditions.js";
import { getAdminDiscordIds } from "./adminUsers.js";
import { cardUnlockInputs } from "../services/driverProfileService.js";

// Type keys the frontend maps to icons: RESULTS | REMINDER | DOWNLOAD | MARKET.
// New kinds (achievements, card frames, ...) just add a key + an icon.

function shapeNotification(r) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body ?? null,
    link: r.link ?? null,
    createdAt: r.createdAt,
    unread: !!Number(r.unread ?? 0),
  };
}

// dedupeKey makes an event idempotent: re-saving the same race's results or
// re-registering reminders can never post twice (unique index + OR IGNORE).
export async function dbCreateNotification(
  prisma,
  { type, title, body = null, link = null, recipientId = null, dedupeKey = null }
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO "Notification"
      ("id","type","title","body","link","recipientId","dedupeKey","createdAt")
    VALUES (${id}, ${type}, ${title}, ${body}, ${link}, ${recipientId}, ${dedupeKey}, ${now})`;
}

// Everything a member can see, newest first: broadcasts + their personal ones,
// each flagged unread relative to when they last opened the bell.
export async function dbListNotificationsFor(prisma, discordId, limit = 30) {
  const rows = await prisma.$queryRaw`
    SELECT n.*,
      CASE WHEN n."createdAt" > COALESCE(m."notificationsSeenAt", '') THEN 1 ELSE 0 END AS unread
    FROM "Notification" n
    LEFT JOIN "MemberAccount" m ON m."discordId" = ${discordId}
    WHERE n."recipientId" IS NULL OR n."recipientId" = ${discordId}
    ORDER BY n."createdAt" DESC
    LIMIT ${limit}`;
  return rows.map(shapeNotification);
}

export async function dbUnreadCount(prisma, discordId) {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*) AS n
    FROM "Notification"
    WHERE ("recipientId" IS NULL OR "recipientId" = ${discordId})
      AND "createdAt" > COALESCE(
        (SELECT "notificationsSeenAt" FROM "MemberAccount" WHERE "discordId" = ${discordId}), '')`;
  return Number(rows[0]?.n || 0);
}

export async function dbMarkNotificationsSeen(prisma, discordId) {
  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET "notificationsSeenAt" = ${new Date().toISOString()}
    WHERE "discordId" = ${discordId}`;
}

// --- league-wide notification settings (admin-only) ---------------------------
// Who gets notified about what is a LEAGUE decision, not a per-member one, so
// it lives in one admin-edited Setting blob (same pattern as Race Info).
// Admin tab "Notifications"; readable with a short cache since every event
// trigger consults it.

export const NOTIFY_SETTINGS_KEY = "notification_settings";

// The reminder offsets the admin can enable (hours before kickoff).
export const REMINDER_OFFSETS = [72, 24, 6, 1];

export const ATTENDANCE_STATUSES = ["ACCEPTED", "DECLINED", "TENTATIVE"];

export const NOTIFY_DEFAULTS = {
  results: true, // "results are in" broadcast
  photos: true, // "photos from the round are up" broadcast (first batch only)
  downloads: true, // "new download" broadcast
  seatOffers: "reserves", // who hears about seat offers: "reserves" | "all" | "off"
  seatFilled: true, // personal "you got the seat" note to the picked reserve
  adminAlerts: true, // admins-only: a login with no driver, a "I want to race"
  reminders: [24], // race reminders, hours before kickoff
  trainingReminders: true, // do the reminders above also cover training sessions?
  attendanceOpenDays: null, // sign-up opens N days before race day (null = always open)
  attendanceOpenHour: 8, // ... at this hour, German time
  attendanceOpenNotify: true, // broadcast the moment the sign-up opens
  attendanceShow: [...ATTENDANCE_STATUSES], // which answer columns the page shows
};

export function sanitizeNotifySettings(input) {
  const o = input && typeof input === "object" ? input : {};
  return {
    results: o.results !== false,
    photos: o.photos !== false,
    downloads: o.downloads !== false,
    seatOffers: ["reserves", "all", "off"].includes(o.seatOffers) ? o.seatOffers : "reserves",
    seatFilled: o.seatFilled !== false,
    adminAlerts: o.adminAlerts !== false,
    reminders: REMINDER_OFFSETS.filter((h) =>
      (Array.isArray(o.reminders) ? o.reminders : NOTIFY_DEFAULTS.reminders).map(Number).includes(h)
    ),
    trainingReminders: o.trainingReminders !== false,
    attendanceOpenDays:
      Number.isFinite(Number(o.attendanceOpenDays)) && Number(o.attendanceOpenDays) >= 1
        ? Math.min(21, Math.round(Number(o.attendanceOpenDays)))
        : null,
    attendanceOpenHour:
      Number.isFinite(Number(o.attendanceOpenHour)) && Number(o.attendanceOpenHour) >= 0 && Number(o.attendanceOpenHour) <= 23
        ? Math.round(Number(o.attendanceOpenHour))
        : NOTIFY_DEFAULTS.attendanceOpenHour,
    attendanceOpenNotify: o.attendanceOpenNotify !== false,
    attendanceShow: (() => {
      const arr = Array.isArray(o.attendanceShow)
        ? ATTENDANCE_STATUSES.filter((s) => o.attendanceShow.includes(s))
        : [...ATTENDANCE_STATUSES];
      // Hiding every column would make the page pointless — fall back to all.
      return arr.length ? arr : [...ATTENDANCE_STATUSES];
    })(),
  };
}

// When the sign-up for a race opens: N days before the race DAY (not the exact
// kickoff instant), at the configured hour German time — so "5 days, 8:00" for
// a Friday-evening race means Sunday 08:00. null = no gate, always open.
export function attendanceOpensAt(race, settings) {
  if (!settings?.attendanceOpenDays) return null;
  const kick = raceKickoff(race?.date);
  if (!kick) return null;
  // The race's calendar day in Berlin, walked back N days (UTC-noon anchor so
  // DST shifts can't move the calendar date).
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", dateStyle: "short" })
    .format(kick)
    .split("-")
    .map(Number);
  const anchor = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
  anchor.setUTCDate(anchor.getUTCDate() - settings.attendanceOpenDays);
  // That day at the configured Berlin wall-clock hour (try both DST offsets).
  const h = settings.attendanceOpenHour;
  for (const offset of [2, 1]) {
    const t = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), h - offset));
    if (Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(t)) === h) {
      return t;
    }
  }
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), h - 1));
}

const SETTINGS_CACHE_MS = 30_000;
let settingsCache = { value: null, at: 0 };

export async function readNotifySettings(prisma) {
  const now = Date.now();
  if (!settingsCache.value || now - settingsCache.at > SETTINGS_CACHE_MS) {
    let value = { ...NOTIFY_DEFAULTS };
    try {
      const row = await prisma.setting.findUnique({ where: { key: NOTIFY_SETTINGS_KEY } });
      if (row) value = sanitizeNotifySettings(JSON.parse(row.value));
    } catch {
      /* unreadable blob: defaults */
    }
    settingsCache = { value, at: now };
  }
  return settingsCache.value;
}

export async function writeNotifySettings(prisma, input) {
  const clean = sanitizeNotifySettings(input);
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: NOTIFY_SETTINGS_KEY },
    update: { value },
    create: { key: NOTIFY_SETTINGS_KEY, value },
  });
  settingsCache = { value: clean, at: Date.now() }; // takes effect immediately
  return clean;
}

// --- helpers shared by the notify* functions --------------------------------

// The /s/<slug> URL prefix of the series a season belongs to, so notification
// links land inside the right series. "" when unresolvable (fresh DB).
async function seriesPrefixForSeason(prisma, seasonId) {
  if (!seasonId) return "";
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT se."slug" AS slug FROM "Season" s JOIN "Series" se ON se."id" = s."seriesId" WHERE s."id" = ?`,
      seasonId
    );
    return rows[0]?.slug ? `/s/${rows[0].slug}` : "";
  } catch {
    return "";
  }
}

// A PRIVATE season (an upcoming one the admin is still building) must never
// broadcast — results imports and market changes there stay invisible until
// the season is published. isPublic is a raw-SQL column -> raw read; treat a
// missing column (fresh checkout) as public, like seasonService does.
async function seasonIsPublic(prisma, seasonId) {
  if (!seasonId) return true;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "isPublic" AS p FROM "Season" WHERE "id" = ?`,
      seasonId
    );
    return rows[0] ? !!Number(rows[0].p) : true;
  } catch {
    return true;
  }
}

const roundName = (race) => (race?.number ? `Round ${race.number}` : race?.track || "the race");

// Deep link to ONE race on the calendar: series prefix, the season (the bell
// outlives a season switch, and a training result of next season must not open
// on the current one) and the race id — the Races page picks the round AND the
// right session tab (rounds/training/special) from it. Falls back to the plain
// calendar when the season row is gone.
async function racePageLink(prisma, race) {
  const prefix = await seriesPrefixForSeason(prisma, race?.seasonId);
  if (!race?.id) return `${prefix}/races`;
  let seasonNumber = null;
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT "number" FROM "Season" WHERE "id" = ?`, race.seasonId);
    seasonNumber = rows[0]?.number ?? null;
  } catch {
    /* season lookup is a nicety; the race param alone still lands on the page */
  }
  const q = seasonNumber != null ? `season=${seasonNumber}&race=${race.id}` : `race=${race.id}`;
  return `${prefix}/races?${q}`;
}

// "Round 3" / "Training session" / "Special event" — what a notification calls
// the race. Reads the stored type so a training session is announced as one
// instead of as a bare track name.
async function raceLabel(prisma, race) {
  const type =
    (await readRaceTypes(prisma, [race.id])).get(race.id) || (race.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
  if (type === "TRAINING") return { type, label: `the training session at ${race.track}` };
  if (type === "SPECIAL") return { type, label: `the special event at ${race.track}` };
  return { type, label: roundName(race) };
}

// --- event triggers ----------------------------------------------------------
// All of these swallow their own errors: the caller's action already succeeded
// and must stay successful even if the notification write goes wrong.

// Race results stored (admin import or first-time save). Deduped per race, so
// later edits/re-imports of the same round don't ping everyone again.
export async function notifyResultsSaved(prisma, race) {
  try {
    if (!race?.id) return;
    if (!(await readNotifySettings(prisma)).results) return;
    if (!(await seasonIsPublic(prisma, race.seasonId))) return;
    const { type, label } = await raceLabel(prisma, race);
    await dbCreateNotification(prisma, {
      type: "RESULTS",
      // A training session has no round number; "Results are in from the
      // training session at Monza" beats the bare "monza results are in".
      title: type === "CHAMPIONSHIP" ? `${label} results are in` : `Results are in from ${label}`,
      body: race.track ? `Full classification from ${race.track} is up.` : null,
      // Straight to the round: right season, right session tab, row selected.
      link: await racePageLink(prisma, race),
      dedupeKey: `results:${race.id}`,
    });
  } catch {
    /* best-effort */
  }
}

// The first photos of a round's gallery. Deduped per RACE, on purpose: the
// admin uploads in batches while sorting the night's screenshots, and one
// "photos are up" is an invitation — five would be spam.
export async function notifyRacePhotosAdded(prisma, race, count) {
  try {
    if (!race?.id || !count) return;
    if (!(await readNotifySettings(prisma)).photos) return;
    if (!(await seasonIsPublic(prisma, race.seasonId))) return;
    const { label } = await raceLabel(prisma, race);
    await dbCreateNotification(prisma, {
      type: "PHOTOS",
      title: `Photos from ${label} are up`,
      body: `The gallery from ${race.track} is live. See the night as it happened.`,
      link: await racePageLink(prisma, race),
      dedupeKey: `race-photos:${race.id}`,
    });
  } catch {
    /* best-effort */
  }
}

// A new file/link in the member downloads. Expects the shaped download row.
export async function notifyDownloadAdded(prisma, download) {
  try {
    if (!download?.id || !download.published) return;
    if (!(await readNotifySettings(prisma)).downloads) return;
    await dbCreateNotification(prisma, {
      type: "DOWNLOAD",
      title: `New download: ${download.title}`,
      body: download.description || null,
      link: `/downloads?dl=${download.id}`,
      dedupeKey: `download:${download.id}`,
    });
  } catch {
    /* best-effort */
  }
}

// A full-time driver put their seat on the market. NOT a broadcast: the seat
// can only be taken by reserve drivers, so the default audience is the members
// linked to a reserve of the race's season. The admin can widen that to every
// member or mute it entirely (Notifications tab); one personal row per
// recipient, deduped per offer+recipient.
export async function notifySeatOffered(prisma, { race, teamName, driver }) {
  try {
    if (!race?.id) return;
    const audience = (await readNotifySettings(prisma)).seatOffers;
    if (audience === "off") return;
    if (!(await seasonIsPublic(prisma, race.seasonId))) return;

    // Discord ids of this season's reserve drivers (tier-0 team) with a linked
    // login — the default audience.
    const roster = await prisma.driver.findMany({
      where: { seasonId: race.seasonId, isActive: true, discordUserId: { not: null } },
      include: { team: { select: { tier: true } } },
    });
    const reserveIds = new Set(roster.filter((d) => d.team?.tier === 0).map((d) => d.discordUserId));

    // Anyone already driving this round. A reserve who has been given a seat is
    // ON the grid, so a second offer for the same race is not an opportunity —
    // it is a message about somebody else's problem, sent to the one person who
    // definitely cannot help. Two full-time drivers dropping out of the same
    // round is exactly when this used to fire twice at the person who had just
    // taken the first seat.
    const taken = await prisma.seatOffer.findMany({
      where: { raceId: race.id, status: "FILLED", filledById: { not: null } },
      select: { filledBy: { select: { discordUserId: true } } },
    });
    const seated = new Set(taken.map((o) => o.filledBy?.discordUserId).filter(Boolean));

    const members = await prisma.$queryRawUnsafe(
      `SELECT "discordId" FROM "MemberAccount" WHERE "banned" = 0`
    );
    const recipients = members.filter((m) => {
      if (m.discordId === driver?.discordUserId) return false; // not the offerer
      if (seated.has(m.discordId)) return false; // already has a seat this round
      return audience === "all" || reserveIds.has(m.discordId);
    });

    const prefix = await seriesPrefixForSeason(prisma, race.seasonId);
    for (const m of recipients) {
      await dbCreateNotification(prisma, {
        type: "MARKET",
        title: `Seat available for ${roundName(race)}`,
        body: `${driver?.name || "A driver"} is offering their ${teamName ? `${teamName} ` : ""}seat at ${race.track}.`,
        link: `${prefix}/attendance`,
        recipientId: m.discordId,
        dedupeKey: `market-offer:${race.id}:${driver?.id || ""}:${m.discordId}`,
      });
    }
  } catch {
    /* best-effort */
  }
}

// The offering driver (or the admin) picked a reserve: tell that reserve
// personally. Needs the reserve's linked Discord id; silently skips otherwise.
export async function notifySeatFilled(prisma, { offerId, raceId, reserve }) {
  try {
    if (!reserve?.discordUserId || !raceId) return;
    if (!(await readNotifySettings(prisma)).seatFilled) return;
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    if (!race) return;
    const prefix = await seriesPrefixForSeason(prisma, race.seasonId);
    await dbCreateNotification(prisma, {
      type: "MARKET",
      title: `You're driving ${roundName(race)}`,
      body: `You've been picked to take over the seat at ${race.track}.`,
      link: `${prefix}/attendance`,
      recipientId: reserve.discordUserId,
      dedupeKey: `market-filled:${offerId}:${reserve.id}`,
    });
  } catch {
    /* best-effort */
  }
}

// --- admin alerts -------------------------------------------------------------
// The two things in the Members tab that need a HUMAN: somebody signed in and no
// driver row claims them, and somebody asked for a seat. Both sit in the admin
// area, which nobody keeps open, so the bell carries them to whoever can act.
//
// Personal rows addressed to the Discord admins (no broadcast — the rest of the
// league has no business seeing who logged in). Muteable in the Notifications
// tab. Best-effort like every other trigger: a login must never fail because a
// notification could not be written.
async function notifyAdmins(prisma, { title, body, link, dedupeSuffix }) {
  if (!(await readNotifySettings(prisma)).adminAlerts) return;
  const admins = await getAdminDiscordIds(prisma);
  for (const discordId of admins) {
    await dbCreateNotification(prisma, {
      type: "ADMIN",
      title,
      body,
      link,
      recipientId: discordId,
      // Per admin, so a second admin appointed later still hears about the
      // people already waiting the next time one comes in.
      dedupeKey: `${dedupeSuffix}:${discordId}`,
    });
  }
}

const memberName = (m) => m?.displayName || m?.username || "Someone";

// A Discord login that matched no driver row. Deduped per account for good: the
// same person logging in twenty times is still one thing to deal with.
export async function notifyAdminsUnlinkedLogin(prisma, member) {
  try {
    if (!member?.discordId) return;
    await notifyAdmins(prisma, {
      title: `New login with no driver: ${memberName(member)}`,
      body: "They signed in with Discord but no roster driver carries their Discord id. Link them, or create a driver for them, in the Members tab.",
      link: "/admin?tab=members",
      dedupeSuffix: `admin-unlinked:${member.discordId}`,
    });
  } catch {
    /* best-effort */
  }
}

// Somebody pressed "I want to race". Deduped per hand-raise (the timestamp is
// part of the key), so a request withdrawn and raised again is heard again.
export async function notifyAdminsRaceRequest(prisma, member, text) {
  try {
    if (!member?.discordId) return;
    await notifyAdmins(prisma, {
      title: `${memberName(member)} wants to race`,
      body: text
        ? `They asked for a seat at ${text}. Link them to a driver in the Members tab, and that answers the request.`
        : "They asked for a seat. Link them to a driver in the Members tab, and that answers the request.",
      link: "/admin?tab=members",
      dedupeSuffix: `admin-race-request:${member.discordId}:${member.raceRequestAt || ""}`,
    });
  } catch {
    /* best-effort */
  }
}

// A reserve who had already been given a seat has stood down again. This is the
// one market event an admin has to hear about rather than discover: the grid
// they built is now a car short, and the round may be days away. Deduped per
// offer and driver, so backing out of the same seat twice (given it back, was
// re-assigned, backed out again) is heard both times only if it is a new offer.
export async function notifyAdminsSeatDropped(prisma, { race, offerId, reserve, offeredByName }) {
  try {
    if (!race?.id || !reserve) return;
    const prefix = await seriesPrefixForSeason(prisma, race.seasonId);
    await notifyAdmins(prisma, {
      title: `${reserve.name || "A reserve"} stood down from ${roundName(race)}`,
      body: `They had the ${offeredByName ? `${offeredByName} ` : ""}seat at ${race.track} and have given it back. The seat is open again.`,
      link: `${prefix}/attendance`,
      dedupeSuffix: `admin-seat-dropped:${offerId}:${reserve.id}`,
    });
  } catch {
    /* best-effort */
  }
}

// --- manual attendance nudge ------------------------------------------------
// The admin's "poke everyone" button: a broadcast asking members to answer (or
// update) the attendance for one race. Deliberately NOT deduped per race — the
// admin decides when a fresh nudge is warranted, so every press posts anew
// (timestamp in the dedupeKey). Unlike the automatic triggers this THROWS on
// bad input: the admin pressed a button and deserves a real error message.
export async function sendAttendancePing(prisma, raceId) {
  const race = await prisma.race.findUnique({ where: { id: raceId } });
  if (!race) throw Object.assign(new Error("Race not found"), { status: 404 });
  if (race.isCompleted) throw Object.assign(new Error("Race already completed"), { status: 400 });
  const types = await readRaceTypes(prisma, [race.id]);
  const isTraining = (types.get(race.id) || "CHAMPIONSHIP") === "TRAINING";
  const prefix = await seriesPrefixForSeason(prisma, race.seasonId);
  await dbCreateNotification(prisma, {
    type: "REMINDER",
    title: `Attendance check: ${isTraining ? "training session" : roundName(race)} at ${race.track}`,
    body: "Please confirm or update whether you're racing. Every answer helps the planning.",
    link: `${prefix}/attendance?race=${race.id}`,
    dedupeKey: `attendance-ping:${race.id}:${Date.now()}`,
  });
}

// --- card unlocks --------------------------------------------------------------
// A driver earns an unlockable rating-card edition (a milestone hit, a title
// sealed). We ping them once per edition, tracked in Driver.cardUnlocksNotified
// (a JSON key array) so re-computing never re-pings. The FIRST computation for a
// row seeds that array silently — a veteran opening the feature for the first
// time must not get their whole backlog dumped into the bell.

// key -> { name, tagline, earned } (earned = has an unlock requirement; the free
// classic/nabs/mono editions are never "unlock news").
const EDITION_META = new Map(CARD_EDITIONS.map((e) => [e.key, { name: e.name, tagline: e.tagline, earned: !!e.req }]));

// Parse the stored notified-keys array. null column = never computed (seed);
// unreadable/legacy = treat as an empty set (grow from here, never dump).
function parseNotifiedKeys(raw) {
  if (raw == null) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

// Reconcile one driver row's unlocked editions against what they've been
// notified about, pinging the bell for anything genuinely new. `editions` (the
// unlockStateFor array) can be passed in to avoid recomputing when the caller
// already has it (the card-editions endpoint does).
export async function notifyCardUnlocks(prisma, driverId, editions = null) {
  try {
    if (!driverId) return;
    const rows = await prisma.$queryRaw`SELECT "discordUserId","cardUnlocksNotified" FROM "Driver" WHERE "id" = ${driverId}`;
    const row = rows[0];
    if (!row) return;

    let list = editions;
    if (!list) {
      const inputs = await cardUnlockInputs(prisma, driverId);
      if (!inputs) return;
      list = unlockStateFor(inputs.stats, inputs.badges, inputs.teamBadges, inputs.seasonNumber);
    }
    const unlocked = list.filter((e) => e.unlocked).map((e) => e.key);

    const stored = parseNotifiedKeys(row.cardUnlocksNotified);
    // First-ever computation: seed silently, no backlog dump.
    if (stored === null) {
      await prisma.$executeRaw`UPDATE "Driver" SET "cardUnlocksNotified" = ${JSON.stringify(unlocked)} WHERE "id" = ${driverId}`;
      return;
    }

    const storedSet = new Set(stored);
    // Only EARNED editions are worth a ping (free ones were never locked).
    const fresh = unlocked.filter((k) => !storedSet.has(k) && EDITION_META.get(k)?.earned);
    if (row.discordUserId) {
      for (const key of fresh) {
        const meta = EDITION_META.get(key);
        await dbCreateNotification(prisma, {
          type: "CARD",
          title: `Card unlocked: ${meta?.name || key}`,
          body: meta ? `You've earned the ${meta.name} card edition (${meta.tagline}). Choose it on your driver card.` : null,
          link: "/profile/card",
          recipientId: row.discordUserId,
          dedupeKey: `card-unlock:${driverId}:${key}`,
        });
      }
    }
    // Keep the stored set current regardless (so an unlock earned while unlinked
    // isn't announced later once they log in).
    const union = [...new Set([...stored, ...unlocked])];
    if (union.length !== stored.length) {
      await prisma.$executeRaw`UPDATE "Driver" SET "cardUnlocksNotified" = ${JSON.stringify(union)} WHERE "id" = ${driverId}`;
    }
  } catch {
    /* best-effort: a notification must never fail the caller */
  }
}

// Fan out card-unlock reconciliation across a season's drivers after results are
// saved (the moment milestones tick over and, on the finale, titles seal). Only
// linked drivers (a Discord login) can see a bell, so we skip the rest. Fire and
// forget from the admin save path — never blocks or fails the commit.
export async function notifyCardUnlocksForSeason(prisma, seasonId) {
  try {
    if (!seasonId) return;
    const drivers = await prisma.driver.findMany({
      where: { seasonId, discordUserId: { not: null } },
      select: { id: true },
    });
    for (const d of drivers) {
      await notifyCardUnlocks(prisma, d.id);
    }
  } catch {
    /* best-effort */
  }
}

// One-time catch-up: when the unlockable-card feature first ships, drivers who
// ALREADY earned editions never got told (the per-driver seed is silent by
// design). So exactly once, post a single personal "you've unlocked N designs"
// note per person with a linked login and at least one earned edition. Guarded
// by a Setting flag so it runs once ever, and deduped per person (card-intro:
// <discordId>) so a re-run — or the same person logging in again — never
// doubles it. Best-effort; never blocks boot. Future NEW unlocks still ping
// individually via notifyCardUnlocks (a different dedupeKey namespace).
export async function backfillCardIntro(prisma) {
  const FLAG = "card_intro_done";
  try {
    const done = await prisma.setting.findUnique({ where: { key: FLAG } }).catch(() => null);
    if (done) return;

    const drivers = await prisma.driver.findMany({
      where: { discordUserId: { not: null } },
      include: { season: { select: { number: true } } },
    });
    // One row per person: the newest season they have (most milestones apply
    // there), so the count in the message is the fullest.
    const newestByUser = new Map();
    for (const d of drivers) {
      const n = d.season?.number ?? -1;
      const cur = newestByUser.get(d.discordUserId);
      if (!cur || n > cur.n) newestByUser.set(d.discordUserId, { id: d.id, discordId: d.discordUserId, n });
    }

    for (const { id, discordId } of newestByUser.values()) {
      try {
        const inputs = await cardUnlockInputs(prisma, id);
        if (!inputs) continue;
        const state = unlockStateFor(inputs.stats, inputs.badges, inputs.teamBadges, inputs.seasonNumber);
        const earned = state.filter((e) => e.unlocked && e.requirement).length;
        if (earned < 1) continue; // nothing special earned yet — no catch-up
        await dbCreateNotification(prisma, {
          type: "CARD",
          title: "Your rating card can be customised now",
          body: `You've already unlocked ${earned} card ${earned === 1 ? "design" : "designs"}. Pick your favourite on your driver card.`,
          link: "/profile/card",
          recipientId: discordId,
          dedupeKey: `card-intro:${discordId}`,
        });
      } catch {
        /* one driver's failure must not abort the whole backfill */
      }
    }

    await prisma.setting.upsert({ where: { key: FLAG }, update: { value: "1" }, create: { key: FLAG, value: "1" } });
  } catch {
    /* best-effort: a catch-up must never take the server down */
  }
}

// --- achievement unlocks --------------------------------------------------------
// Same pattern as the card unlocks above: reconcile the computed achievement
// state against Driver.achievementsNotified, ping the bell only for genuinely
// new ones, and seed silently on the first-ever computation so a veteran's
// backlog never floods the bell.
export async function notifyAchievements(prisma, driverId, state) {
  try {
    if (!driverId || !Array.isArray(state)) return;
    const rows = await prisma.$queryRaw`SELECT "discordUserId","achievementsNotified" FROM "Driver" WHERE "id" = ${driverId}`;
    const row = rows[0];
    if (!row) return;

    const unlocked = state.filter((a) => a.unlocked).map((a) => a.key);
    const stored = parseNotifiedKeys(row.achievementsNotified);
    if (stored === null) {
      await prisma.$executeRaw`UPDATE "Driver" SET "achievementsNotified" = ${JSON.stringify(unlocked)} WHERE "id" = ${driverId}`;
      return;
    }
    const storedSet = new Set(stored);
    const fresh = unlocked.filter((k) => !storedSet.has(k));
    if (row.discordUserId) {
      const metaByKey = new Map(state.map((a) => [a.key, a]));
      for (const key of fresh) {
        const a = metaByKey.get(key);
        await dbCreateNotification(prisma, {
          type: "AWARD",
          title: `Achievement unlocked: ${a?.name || key}`,
          body: a?.tagline ? `${a.tagline}. See it in your Cockpit.` : null,
          link: "/cockpit?tab=achievements",
          recipientId: row.discordUserId,
          dedupeKey: `achievement:${driverId}:${key}`,
        });
      }
    }
    const union = [...new Set([...stored, ...unlocked])];
    if (union.length !== stored.length) {
      await prisma.$executeRaw`UPDATE "Driver" SET "achievementsNotified" = ${JSON.stringify(union)} WHERE "id" = ${driverId}`;
    }
  } catch {
    /* best-effort */
  }
}

// --- feature announcements ------------------------------------------------------
// One-off "look what's new" broadcasts to every member's bell. Each entry runs
// exactly once ever — the dedupeKey's unique index makes re-running a no-op —
// so shipping the NEXT announcement is just another array entry. Best-effort
// at boot, like the card-intro backfill.
const FEATURE_ANNOUNCEMENTS = [
  {
    dedupeKey: "feature:hall-of-fame",
    type: "NEWS",
    title: "New: Hall of Fame",
    body: "All-time records are live: every champion, single-season records and the career top 10s. Find it under Standings.",
    link: "/records",
  },
  {
    dedupeKey: "feature:cards-view",
    type: "NEWS",
    title: "New: the field as driver cards",
    body: "The driver standings got a Cards view: everyone's rating card in championship order, with each driver's own edition and picture.",
    link: "/drivers",
  },
  {
    dedupeKey: "feature:achievements",
    type: "NEWS",
    title: "New: achievements",
    body: "Your career now earns you achievements: milestones, race-day feats and a few hidden ones to discover. Unlock them and pin up to three favourites to your public profile.",
    link: "/profile?tab=achievements",
  },
  {
    dedupeKey: "feature:quali-title-fight",
    type: "NEWS",
    title: "New: qualifying results & title fight",
    body: "Races can now show the full qualifying classification with pole times next to the race result. The driver standings mark who moved up or down after every round, and while the title is still open the home page tracks who can mathematically win it.",
    link: "/races",
  },
  {
    dedupeKey: "feature:attendance-window",
    type: "NEWS",
    title: "Attendance works a little differently now",
    body: "Sign-up for a race opens a few days before the event and you'll get a notification here the moment it does. The Attendance button only shows in the menu while a sign-up is open. You can already answer for next season's races too.",
    link: "/attendance",
  },
  {
    dedupeKey: "feature:my-rating",
    type: "CARD",
    title: "New: your private rating breakdown",
    body: "There's now a \"My Rating\" tab in your Personal Area, just for you: it shows round by round where your rating comes from, your biggest strengths and what's costing you most. Tap this to be walked there step by step.",
    // A `tour:` link starts a guided walk-through instead of jumping straight to
    // the page (see the notification bell / Tour.jsx on the frontend).
    link: "tour:my-rating",
  },
  {
    dedupeKey: "feature:install-app",
    type: "NEWS",
    title: "Put NABS on your phone",
    body: "The site can sit on your home screen like a normal app: full screen, no address bar, and still signed in. Tap here for the steps. There's a set for Android and a set for iPhone and iPad.",
    link: "/app",
  },
];

// The track editor's announcement goes to the members, not to the admins,
// who have had it for weeks: one personal entry per member, so an admin's
// bell stays quiet. The one admin who asked for it is on the list by id.
// Members who sign up later get theirs at the next boot, since this runs
// with every start and the dedupe key makes the rest a no-op.
const TRACK_EDITOR_ANNOUNCEMENT = {
  type: "NEWS",
  title: "New: the track editor",
  body: "Build your own circuit in the browser and export it straight into Assetto Corsa. You find it under Tools.",
  link: "/track-editor",
};
const TRACK_EDITOR_ALWAYS = new Set(["306124825439764480"]);

async function trackEditorAnnouncements(prisma) {
  const admins = await getAdminDiscordIds(prisma);
  const rows = await prisma.$queryRaw`SELECT "discordId", "banned" FROM "MemberAccount"`;
  const out = [];
  for (const r of rows) {
    const id = String(r.discordId ?? "");
    if (!id || r.banned) continue;
    if (admins.has(id) && !TRACK_EDITOR_ALWAYS.has(id)) continue;
    out.push({ ...TRACK_EDITOR_ANNOUNCEMENT, dedupeKey: `feature:track-editor:${id}`, recipientId: id });
  }
  return out;
}

export async function announceFeatures(prisma) {
  let personal = [];
  try {
    personal = await trackEditorAnnouncements(prisma);
  } catch {
    /* best-effort */
  }
  for (const a of [...FEATURE_ANNOUNCEMENTS, ...personal]) {
    try {
      await dbCreateNotification(prisma, a); // broadcast: recipientId null
      // Keep an already-posted announcement's wording in sync with the array,
      // so a copy fix here reaches bells that got the old text (the dedupe
      // key makes the INSERT above a no-op in that case).
      await prisma.$executeRaw`
        UPDATE "Notification" SET "title" = ${a.title}, "body" = ${a.body}, "link" = ${a.link}
        WHERE "dedupeKey" = ${a.dedupeKey}`;
    } catch {
      /* best-effort */
    }
  }
}

// --- race reminders ------------------------------------------------------------
// Upcoming championship races of the active public seasons get their (deduped)
// reminder broadcasts. WHEN reminders go out is admin-configured
// (settings.reminders, hours before kickoff — e.g. [72, 24, 1] posts three
// staggered notes per race). Each enabled offset only fires inside ITS slice of
// the countdown (between it and the next enabled smaller offset), so a race
// entered late doesn't dump every stage at once. Throttled to roughly one check
// per 5 minutes.
//
// This runs from two places, and it needs both. Every bell request calls it, so
// an active site keeps itself current; and index.js also runs it on a timer,
// because the request-driven path alone silently loses reminders. An offset only
// fires inside its own slice of the countdown, so if nobody happens to have a
// tab open during the "1 hour before" window, that reminder is never created for
// anyone and is never caught up afterwards — the one hour before lights out
// being exactly when members are least likely to be sitting on the website.
// The throttle and the dedupe key make the extra caller free.
const REMINDER_CHECK_MS = 5 * 60 * 1000;
let remindersCheckedAt = 0;

// League time with its abbreviation ("20:00 CEST") — reads neutrally for an
// international audience, unlike spelling out "German time".
const berlinTime = (t) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(t);
const berlinDay = (t) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", dateStyle: "short" }).format(t);
const berlinWeekday = (t) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "long" }).format(t);

// Title/body for one reminder, phrased by how far out it actually fires.
function reminderText(race, kick, now, isTraining = false) {
  const hoursOut = (kick.getTime() - now) / 3_600_000;
  const time = berlinTime(kick);
  const label = isTraining ? "Training session" : roundName(race);
  if (hoursOut <= 6) {
    return { title: `Starting soon: ${label} at ${race.track}`, body: `Lights out at ${time}.` };
  }
  if (berlinDay(kick) === berlinDay(new Date(now))) {
    return {
      title: `${isTraining ? "Training today" : "Race day"}: ${label} at ${race.track}`,
      body: `Lights out at ${time}.`,
    };
  }
  return {
    title: `Coming up: ${label} at ${race.track}`,
    body: `${berlinWeekday(kick)} at ${time}.`,
  };
}

export async function ensureRaceReminders(prisma) {
  const now = Date.now();
  if (now - remindersCheckedAt < REMINDER_CHECK_MS) return;
  remindersCheckedAt = now;
  try {
    // Enabled offsets, largest first; each fires in (next smaller, itself].
    const settings = await readNotifySettings(prisma);
    const offsets = [...settings.reminders].sort((a, b) => b - a);
    const announceOpening = !!settings.attendanceOpenDays && settings.attendanceOpenNotify;
    if (offsets.length || announceOpening) {
      // Championship rounds always; TRAINING sessions too unless the admin
      // switched them off. SPECIAL events stay announcement-only.
      //
      // EVERY season's upcoming races, not just the active one's: the
      // attendance page takes sign-ups for next season's rounds while the
      // current season finishes (eventSeasonIds does the same), and a training
      // session scheduled there was getting no reminder and no "sign-up open"
      // broadcast. Private seasons are filtered per race below, exactly like
      // before; past dates fall out of the dt<=0 check.
      const races = await prisma.race.findMany({
        where: {
          isCompleted: false,
          date: { not: null },
        },
      });
      const types = await readRaceTypes(prisma, races.map((r) => r.id));
      // A race the admin took off the attendance page must not keep pinging the
      // grid about it. Hiding it and then broadcasting "sign-up open" for a page
      // it isn't on would be worse than leaving it visible.
      const hidden = await readHiddenRaceIds(prisma);
      for (const race of races) {
        const type = types.get(race.id) || (race.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
        if (type === "SPECIAL") continue;
        if (hidden.has(race.id)) continue;
        if (type === "TRAINING" && !settings.trainingReminders) continue;
        const kick = raceKickoff(race.date);
        if (!kick) continue;
        const dt = kick.getTime() - now;
        if (dt <= 0) continue;

        // "Attendance is open" broadcast: fires (once) as soon as the sign-up
        // window opens, until kickoff. Deduped per race, so enabling the gate
        // late never double-posts.
        if (announceOpening) {
          const opens = attendanceOpensAt(race, settings);
          if (opens && opens.getTime() <= now && (await seasonIsPublic(prisma, race.seasonId))) {
            const prefix = await seriesPrefixForSeason(prisma, race.seasonId);
            await dbCreateNotification(prisma, {
              type: "REMINDER",
              title: `Sign-up open: ${type === "TRAINING" ? "training session" : roundName(race)} at ${race.track}`,
              body: `Attendance for ${race.track} is open now. Let us know if you're on the grid.`,
              link: `${prefix}/attendance?race=${race.id}`,
              dedupeKey: `attendance-open:${race.id}`,
            });
          }
        }

        const idx = offsets.findIndex(
          (h, i) => dt <= h * 3_600_000 && (i === offsets.length - 1 || dt > offsets[i + 1] * 3_600_000)
        );
        if (idx === -1) continue;
        if (!(await seasonIsPublic(prisma, race.seasonId))) continue;
        await dbCreateNotification(prisma, {
          type: "REMINDER",
          ...reminderText(race, kick, now, type === "TRAINING"),
          // The round itself, not the calendar's front page — for a training
          // session that also switches the explorer onto the Training tab.
          link: await racePageLink(prisma, race),
          dedupeKey: `reminder:${race.id}:${offsets[idx]}`,
        });
      }
    }
    // Housekeeping while we're here: the bell shows the latest 30 anyway, so
    // anything older than 90 days can go.
    const cutoff = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
    await prisma.$executeRaw`DELETE FROM "Notification" WHERE "createdAt" < ${cutoff}`;
    await fixLegacyRaceLinks(prisma);
  } catch {
    /* reminders must never take the bell down */
  }
}

// One-shot repair for race notifications minted before their links carried the
// season and the race (they pointed at the calendar's front page, which shows
// the running season's championship rounds — a note about another season's
// training session left the reader somewhere else entirely). The dedupe key
// has always carried the race id, so the stored rows can be rewritten to the
// deep link new ones get. Runs once per boot; rows for a since-deleted race
// are left alone (their round is gone either way).
let legacyLinksChecked = false;
async function fixLegacyRaceLinks(prisma) {
  if (legacyLinksChecked) return;
  legacyLinksChecked = true;
  const rows = await prisma.notification.findMany({
    where: { type: { in: ["RESULTS", "PHOTOS", "REMINDER"] } },
    select: { id: true, link: true, dedupeKey: true },
  });
  for (const n of rows) {
    if (!n.dedupeKey || (n.link || "").includes("race=")) continue;
    const m = /^(?:results|race-photos|reminder):([^:]+)/.exec(n.dedupeKey);
    if (!m) continue;
    const race = await prisma.race.findUnique({ where: { id: m[1] }, select: { id: true, seasonId: true } });
    if (!race) continue;
    await prisma.notification.update({ where: { id: n.id }, data: { link: await racePageLink(prisma, race) } });
  }
}
