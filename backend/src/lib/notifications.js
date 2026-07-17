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
import { unlockStateFor, CARD_EDITIONS } from "./cardEditions.js";
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

export const NOTIFY_DEFAULTS = {
  results: true, // "results are in" broadcast
  downloads: true, // "new download" broadcast
  seatOffers: "reserves", // who hears about seat offers: "reserves" | "all" | "off"
  seatFilled: true, // personal "you got the seat" note to the picked reserve
  reminders: [24], // race reminders, hours before kickoff
  trainingReminders: true, // do the reminders above also cover training sessions?
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
    trainingReminders: o.trainingReminders !== false,
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
];

export async function announceFeatures(prisma) {
  for (const a of FEATURE_ANNOUNCEMENTS) {
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
function reminderText(race, kick, now, isTraining = false) {
  const hoursOut = (kick.getTime() - now) / 3_600_000;
  const time = `${berlinTime(kick)} German time`;
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
    if (offsets.length) {
      // Championship rounds always; TRAINING sessions too unless the admin
      // switched them off. SPECIAL events stay announcement-only.
      const races = await prisma.race.findMany({
        where: {
          isCompleted: false,
          date: { not: null },
          season: { isActive: true },
        },
      });
      const types = await readRaceTypes(prisma, races.map((r) => r.id));
      for (const race of races) {
        const type = types.get(race.id) || (race.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
        if (type === "SPECIAL") continue;
        if (type === "TRAINING" && !settings.trainingReminders) continue;
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
          ...reminderText(race, kick, now, type === "TRAINING"),
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
