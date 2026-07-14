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

export const NOTIFY_DEFAULTS = {
  results: true, // "results are in" broadcast
  downloads: true, // "new download" broadcast
  seatOffers: "reserves", // who hears about seat offers: "reserves" | "all" | "off"
  seatFilled: true, // personal "you got the seat" note to the picked reserve
  reminders: [24], // race reminders, hours before kickoff
};

export function sanitizeNotifySettings(input) {
  const o = input && typeof input === "object" ? input : {};
  return {
    results: o.results !== false,
    downloads: o.downloads !== false,
    seatOffers: ["reserves", "all", "off"].includes(o.seatOffers) ? o.seatOffers : "reserves",
    seatFilled: o.seatFilled !== false,
    reminders: REMINDER_OFFSETS.filter((h) =>
      (Array.isArray(o.reminders) ? o.reminders : NOTIFY_DEFAULTS.reminders).map(Number).includes(h)
    ),
  };
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
    const prefix = await seriesPrefixForSeason(prisma, race.seasonId);
    await dbCreateNotification(prisma, {
      type: "RESULTS",
      title: `${roundName(race)} results are in`,
      body: race.track ? `Full classification from ${race.track} is up.` : null,
      link: `${prefix}/races`,
      dedupeKey: `results:${race.id}`,
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

    const members = await prisma.$queryRawUnsafe(
      `SELECT "discordId" FROM "MemberAccount" WHERE "banned" = 0`
    );
    const recipients = members.filter((m) => {
      if (m.discordId === driver?.discordUserId) return false; // not the offerer
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

// --- race reminders ------------------------------------------------------------
// No cron needed: whenever anyone asks the bell for data, upcoming championship
// races of the active public seasons get their (deduped) reminder broadcasts.
// WHEN reminders go out is admin-configured (settings.reminders, hours before
// kickoff — e.g. [72, 24, 1] posts three staggered notes per race). Each
// enabled offset only fires inside ITS slice of the countdown (between it and
// the next enabled smaller offset), so a race entered late doesn't dump every
// stage at once. Throttled to roughly one check per 5 minutes.
const REMINDER_CHECK_MS = 5 * 60 * 1000;
let remindersCheckedAt = 0;

const berlinTime = (t) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(t);
const berlinDay = (t) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", dateStyle: "short" }).format(t);
const berlinWeekday = (t) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "long" }).format(t);

// Title/body for one reminder, phrased by how far out it actually fires.
function reminderText(race, kick, now) {
  const hoursOut = (kick.getTime() - now) / 3_600_000;
  const time = `${berlinTime(kick)} German time`;
  if (hoursOut <= 6) {
    return { title: `Starting soon: ${roundName(race)} at ${race.track}`, body: `Lights out at ${time}.` };
  }
  if (berlinDay(kick) === berlinDay(new Date(now))) {
    return { title: `Race day: ${roundName(race)} at ${race.track}`, body: `Lights out at ${time}.` };
  }
  return {
    title: `Coming up: ${roundName(race)} at ${race.track}`,
    body: `${berlinWeekday(kick)} at ${time}.`,
  };
}

export async function ensureRaceReminders(prisma) {
  const now = Date.now();
  if (now - remindersCheckedAt < REMINDER_CHECK_MS) return;
  remindersCheckedAt = now;
  try {
    // Enabled offsets, largest first; each fires in (next smaller, itself].
    const offsets = [...(await readNotifySettings(prisma)).reminders].sort((a, b) => b - a);
    if (offsets.length) {
      const races = await prisma.race.findMany({
        where: {
          isCompleted: false,
          isSpecialEvent: false,
          date: { not: null },
          season: { isActive: true },
        },
      });
      for (const race of races) {
        const kick = raceKickoff(race.date);
        if (!kick) continue;
        const dt = kick.getTime() - now;
        if (dt <= 0) continue;
        const idx = offsets.findIndex(
          (h, i) => dt <= h * 3_600_000 && (i === offsets.length - 1 || dt > offsets[i + 1] * 3_600_000)
        );
        if (idx === -1) continue;
        if (!(await seasonIsPublic(prisma, race.seasonId))) continue;
        const prefix = await seriesPrefixForSeason(prisma, race.seasonId);
        await dbCreateNotification(prisma, {
          type: "REMINDER",
          ...reminderText(race, kick, now),
          link: `${prefix}/races`,
          dedupeKey: `reminder:${race.id}:${offsets[idx]}`,
        });
      }
    }
    // Housekeeping while we're here: the bell shows the latest 30 anyway, so
    // anything older than 90 days can go.
    const cutoff = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
    await prisma.$executeRaw`DELETE FROM "Notification" WHERE "createdAt" < ${cutoff}`;
  } catch {
    /* reminders must never take the bell down */
  }
}
