// ---------------------------------------------------------------------------
// Push notifications: the bell, on the lock screen.
//
// The bell only knows something happened while the site is open, and it asks
// once a minute. The reminder that matters most, an hour before lights out, is
// written whether anybody is looking or not (index.js runs the reminders on a
// clock) and then waits in a bell nobody opens until after the race. Push
// carries the same entry to the member's phone the moment it is written.
//
// So push is a mirror of the bell and nothing else. Every bell entry goes
// through dbCreateNotification (lib/notifications.js), which hands each NEW row
// to queuePush below: the same title, the same words, the same link. Whatever
// decides who hears about what for the bell (the admin's Notifications tab, a
// private season staying quiet, the seat offers going to reserves) decides it
// for push too, because push only ever sees rows the bell already got. Admin
// to-dos (type ADMIN) are not bell entries, so they are not pushed either.
//
// What a member decides is narrower: whether THIS device gets pushes (the
// browser's permission plus a subscription, one row per device), and which
// kinds of entry are worth a buzz (six categories, kept on the account, so a
// phone and a laptop follow the same choice). Everything else stays in the bell
// as before.
//
// The league decides when it starts: a switch with three positions, like the
// race recap's. Admins only first, so it can be tried on real phones; everyone
// once it has proved itself.
// ---------------------------------------------------------------------------
import { getAdminDiscordIds } from "./adminUsers.js";
import { fromB64u, generateVapidKeys, isVapidPublicKey, sendWebPush } from "./webPush.js";

export const PUSH_MODE_KEY = "push_mode";
export const PUSH_MODES = ["off", "admins", "all"];
export const DEFAULT_PUSH_MODE = "admins";

// This server's VAPID key pair, made on first use and kept with the rest of
// the settings. It has to survive deploys: every subscription is tied to the
// public half, and a new pair would quietly cut off every device. It is in the
// database, so the full backup carries it. VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY
// in the environment win over the stored pair, for a server that wants its
// secrets there instead.
const VAPID_SETTING_KEY = "push_vapid_keys";

// A member with more devices than this is a member whose old phones were never
// unsubscribed; the oldest go first.
export const PUSH_DEVICE_CAP = 10;

// A device that keeps failing without the push service ever calling it gone
// (an expired endpoint some services answer with 400 or 403 instead of 410) is
// dropped after this many failures in a row. One success resets the count.
const MAX_FAILURES = 8;

// Parallel requests per entry. A broadcast to fifty phones is fifty POSTs to
// the push services; six at a time is quick and polite.
const CONCURRENCY = 6;

// How long a push service may hold a message for a phone that is switched off,
// in seconds. Four days for news; reminders set their own (until kickoff),
// because "starting soon" arriving after the race is worse than nothing.
export const DEFAULT_PUSH_TTL = 4 * 24 * 3600;

// --- what a member can switch -------------------------------------------------
// Six kinds, in the order the settings page lists them. `types` are the bell's
// own type keys (lib/notifications.js); a type nobody has listed yet counts as
// news, so a new kind of bell entry is pushed under the most general switch
// rather than not at all.
export const PUSH_CATEGORIES = [
  {
    key: "reminders",
    label: "Race reminders",
    help: "Coming up, race day and starting soon, the moment a sign-up opens, and a nudge when you haven't answered.",
    types: ["REMINDER"],
  },
  {
    key: "seat",
    label: "Your seat",
    help: "A seat offered to the reserves, a seat that's yours, and moves on the waiting list.",
    types: ["MARKET", "ATTENDANCE"],
  },
  {
    key: "results",
    label: "Results and recaps",
    help: "A round's results and its photo gallery, and your Season Wrapped when a season ends.",
    types: ["RESULTS", "PHOTOS", "WRAPPED"],
  },
  {
    key: "messages",
    label: "Messages to you",
    help: "Incident reports that name you, new messages and decisions on them, and replies to your feedback.",
    types: ["REPORT", "FEEDBACK"],
  },
  {
    key: "awards",
    label: "Achievements and cards",
    help: "An achievement unlocked or a new card edition earned.",
    types: ["AWARD", "CARD"],
  },
  {
    key: "news",
    label: "League news",
    help: "Announcements from the admins, new downloads and what's new on the site.",
    types: ["NEWS", "ANNOUNCE", "DOWNLOAD"],
  },
];

const CATEGORY_BY_TYPE = new Map(PUSH_CATEGORIES.flatMap((c) => c.types.map((t) => [t, c.key])));

// The category a bell entry belongs to, or null for the entries that are never
// pushed (admin to-dos are not even bell entries).
export function categoryOf(type) {
  if (!type || type === "ADMIN") return null;
  return CATEGORY_BY_TYPE.get(type) || "news";
}

// Everything on unless switched off: someone who turns push on wants to hear
// things, and a category added later reaches them without a visit here first.
export function sanitizePushPrefs(input) {
  const o = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const out = {};
  for (const c of PUSH_CATEGORIES) out[c.key] = o[c.key] !== false;
  return out;
}

export function parsePushPrefs(raw) {
  try {
    return sanitizePushPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizePushPrefs(null);
  }
}

// --- the league's switch ------------------------------------------------------
// Read once per entry written and once per settings visit, changed a handful
// of times ever. Thirty seconds, the bargain lib/widgetsPage.js makes.
const MODE_CACHE_MS = 30_000;
let modeCache = { at: 0, value: null };

export async function readPushMode(prisma) {
  const now = Date.now();
  if (modeCache.value && now - modeCache.at < MODE_CACHE_MS) return modeCache.value;
  let mode = DEFAULT_PUSH_MODE;
  try {
    const row = await prisma.setting.findUnique({ where: { key: PUSH_MODE_KEY } });
    if (PUSH_MODES.includes(row?.value)) mode = row.value;
  } catch {
    /* fresh database: the default */
  }
  modeCache = { at: now, value: mode };
  return mode;
}

export async function setPushMode(prisma, mode) {
  const value = PUSH_MODES.includes(mode) ? mode : DEFAULT_PUSH_MODE;
  await prisma.setting.upsert({
    where: { key: PUSH_MODE_KEY },
    create: { key: PUSH_MODE_KEY, value },
    update: { value },
  });
  modeCache = { at: Date.now(), value };
  return value;
}

// Does this member get the push settings at all? `isAdmin` is the request's
// own answer (req.isAdminRequest), checked live by the auth middleware.
export function pushAvailableTo(mode, isAdmin) {
  return mode === "all" || (mode === "admins" && !!isAdmin);
}

// --- keys ---------------------------------------------------------------------
let vapidCache = null;
let vapidPending = null;

function parseStoredVapid(value) {
  try {
    const o = JSON.parse(value || "null");
    if (o && isVapidPublicKey(o.publicKey) && fromB64u(o.privateKey).length === 32) {
      return { publicKey: o.publicKey, privateKey: o.privateKey };
    }
  } catch {
    /* unreadable: treated as missing */
  }
  return null;
}

async function loadOrCreateVapid(prisma) {
  const read = async () => {
    const row = await prisma.setting.findUnique({ where: { key: VAPID_SETTING_KEY } });
    return { exists: !!row, keys: parseStoredVapid(row?.value) };
  };
  let { exists, keys } = await read();
  if (!keys) {
    const value = JSON.stringify({ ...generateVapidKeys(), createdAt: new Date().toISOString() });
    if (exists) {
      // Something unreadable is stored. Nothing can have subscribed against
      // it, so replacing it costs nobody anything.
      await prisma.setting.update({ where: { key: VAPID_SETTING_KEY }, data: { value } });
    } else {
      // INSERT OR IGNORE, then read back: two requests racing to make the
      // first pair end up with the same one, whichever got there first.
      await prisma.$executeRaw`INSERT OR IGNORE INTO "Setting" ("key", "value") VALUES (${VAPID_SETTING_KEY}, ${value})`;
    }
    ({ keys } = await read());
  }
  if (!keys) throw new Error("push keys unavailable");
  return keys;
}

export async function getVapidKeys(prisma) {
  const envPublic = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const envPrivate = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate };
  if (vapidCache) return vapidCache;
  if (!vapidPending) {
    vapidPending = loadOrCreateVapid(prisma)
      .then((keys) => (vapidCache = keys))
      .finally(() => {
        vapidPending = null;
      });
  }
  return vapidPending;
}

// Who the push services can reach about this server (RFC 8292's `sub`): a
// mailto: or an https address, and Apple insists on one of the two. The site's
// own address does, and is the one thing every deployment already has.
export function pushSubject() {
  const own = String(process.env.VAPID_SUBJECT || "").trim();
  if (/^(mailto:|https:\/\/)/i.test(own)) return own;
  const site = String(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .find((s) => /^https:\/\//i.test(s));
  return site || "https://nabsracing.com";
}

// --- subscriptions ------------------------------------------------------------
// Every message goes to an address the BROWSER chose, which makes the endpoint
// the one piece of member input this server will POST to. So it has to be a
// push service, and nothing else: anything else is somebody pointing the server
// at an address of their choosing. These are the services the browsers use —
// Google (Chrome, Android, Edge on Android, Opera, Samsung Internet), Mozilla
// (Firefox), Apple (Safari, every browser on an iPhone) and Microsoft (Edge).
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function isPushEndpoint(url) {
  let u;
  try {
    u = new URL(String(url || ""));
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  return PUSH_HOSTS.some((re) => re.test(u.hostname.toLowerCase()));
}

// The browser's PushSubscription as it arrives in a request body
// ({ endpoint, keys: { p256dh, auth } }), checked and flattened, or null.
export function cleanSubscription(input) {
  const endpoint = typeof input?.endpoint === "string" ? input.endpoint.trim() : "";
  const p256dh = typeof input?.keys?.p256dh === "string" ? input.keys.p256dh.trim() : "";
  const auth = typeof input?.keys?.auth === "string" ? input.keys.auth.trim() : "";
  if (!endpoint || endpoint.length > 2000 || !isPushEndpoint(endpoint)) return null;
  const key = fromB64u(p256dh);
  if (key.length !== 65 || key[0] !== 0x04) return null;
  if (fromB64u(auth).length !== 16) return null;
  return { endpoint, p256dh, auth };
}

// "Chrome on Android", "Safari on iPhone": enough for a member to tell their
// own devices apart in the list, nothing more is kept from the user agent.
export function deviceLabel(userAgent) {
  const ua = String(userAgent || "");
  const os = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/i.test(ua)
            ? "Mac"
            : /CrOS/i.test(ua)
              ? "ChromeOS"
              : /Linux/i.test(ua)
                ? "Linux"
                : null;
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /SamsungBrowser/i.test(ua)
        ? "Samsung Internet"
        : /Firefox|FxiOS/i.test(ua)
          ? "Firefox"
          : /Chrome|CriOS/i.test(ua)
            ? "Chrome"
            : /Safari/i.test(ua)
              ? "Safari"
              : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "A browser";
}

// Stores (or refreshes) one device. The same endpoint arriving again is the
// same device confirming it is still there, possibly signed in as somebody
// else now: it moves to whoever sent it. `discordId` is the account the member
// acts as (a second account's main one), `loginId` the account that signed in
// on the device, which is the one admin rights belong to.
export async function dbSaveSubscription(prisma, { discordId, loginId = null, subscription, device = null }) {
  const now = new Date().toISOString();
  await prisma.$executeRaw`
    INSERT INTO "PushSubscription"
      ("endpoint","discordId","loginId","p256dh","auth","device","createdAt","updatedAt","failures")
    VALUES (${subscription.endpoint}, ${discordId}, ${loginId || discordId}, ${subscription.p256dh},
            ${subscription.auth}, ${device}, ${now}, ${now}, 0)
    ON CONFLICT ("endpoint") DO UPDATE SET
      "discordId" = excluded."discordId",
      "loginId" = excluded."loginId",
      "p256dh" = excluded."p256dh",
      "auth" = excluded."auth",
      "device" = excluded."device",
      "updatedAt" = excluded."updatedAt",
      "failures" = 0`;
  const mine = await prisma.$queryRaw`
    SELECT "endpoint" FROM "PushSubscription" WHERE "discordId" = ${discordId} ORDER BY "updatedAt" DESC`;
  for (const old of mine.slice(PUSH_DEVICE_CAP)) {
    await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE "endpoint" = ${old.endpoint}`;
  }
}

// A member switching push off on one device. Scoped to them, so nobody can
// switch off somebody else's phone by knowing its endpoint.
export async function dbRemoveSubscription(prisma, discordId, endpoint) {
  const n = await prisma.$executeRaw`
    DELETE FROM "PushSubscription" WHERE "endpoint" = ${String(endpoint || "")} AND "discordId" = ${discordId}`;
  return Number(n || 0);
}

export async function dbListDevices(prisma, discordId) {
  const rows = await prisma.$queryRaw`
    SELECT "endpoint","device","createdAt","lastSuccessAt" FROM "PushSubscription"
    WHERE "discordId" = ${discordId} ORDER BY "updatedAt" DESC`;
  return rows.map((r) => ({
    endpoint: r.endpoint,
    device: r.device || "A browser",
    since: r.createdAt || null,
    lastDelivered: r.lastSuccessAt || null,
  }));
}

// Who an entry goes to: the recipient's devices for a personal entry, every
// device for a broadcast. Banned accounts get nothing, the same rule that
// treats their session as logged out (middleware/auth.js).
async function dbPushTargets(prisma, recipientId) {
  if (recipientId) {
    return prisma.$queryRaw`
      SELECT s."endpoint", s."p256dh", s."auth", s."discordId", s."loginId", m."pushPrefs" AS prefs
      FROM "PushSubscription" s
      JOIN "MemberAccount" m ON m."discordId" = s."discordId"
      LEFT JOIN "MemberAccount" l ON l."discordId" = s."loginId"
      WHERE s."discordId" = ${recipientId} AND m."banned" = 0 AND COALESCE(l."banned", 0) = 0`;
  }
  return prisma.$queryRaw`
    SELECT s."endpoint", s."p256dh", s."auth", s."discordId", s."loginId", m."pushPrefs" AS prefs
    FROM "PushSubscription" s
    JOIN "MemberAccount" m ON m."discordId" = s."discordId"
    LEFT JOIN "MemberAccount" l ON l."discordId" = s."loginId"
    WHERE m."banned" = 0 AND COALESCE(l."banned", 0) = 0`;
}

export async function readPushPrefs(prisma, discordId) {
  try {
    const rows = await prisma.$queryRaw`SELECT "pushPrefs" FROM "MemberAccount" WHERE "discordId" = ${discordId}`;
    return parsePushPrefs(rows[0]?.pushPrefs);
  } catch {
    return sanitizePushPrefs(null);
  }
}

export async function writePushPrefs(prisma, discordId, input) {
  const prefs = sanitizePushPrefs(input);
  await prisma.$executeRaw`
    UPDATE "MemberAccount" SET "pushPrefs" = ${JSON.stringify(prefs)} WHERE "discordId" = ${discordId}`;
  return prefs;
}

// A member deleting their account takes their devices and their choices with
// them (services/accountDeletionService.js).
export async function forgetPushFor(prisma, discordId) {
  if (!discordId) return;
  await prisma.$executeRaw`
    DELETE FROM "PushSubscription" WHERE "discordId" = ${discordId} OR "loginId" = ${discordId}`;
  await prisma.$executeRaw`UPDATE "MemberAccount" SET "pushPrefs" = NULL WHERE "discordId" = ${discordId}`;
}

// For the admin card: how many devices, how many people behind them.
export async function dbPushStats(prisma) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT COUNT(*) AS devices, COUNT(DISTINCT "discordId") AS members FROM "PushSubscription"`;
    return { devices: Number(rows[0]?.devices || 0), members: Number(rows[0]?.members || 0) };
  } catch {
    return { devices: 0, members: 0 };
  }
}

// --- the message ----------------------------------------------------------------
const clip = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

// Where tapping the notification goes: the bell entry's own link, in the form
// the service worker can open. A `tour:` link starts its walk-through through
// the address (?tour=, see components/Tour.jsx); an admin's off-site link is
// opened as it is; anything else lands on the home page rather than nowhere.
export function pushUrlFor(link) {
  const l = String(link || "").trim();
  if (!l) return "/";
  if (l.startsWith("tour:")) return `/?tour=${encodeURIComponent(l.slice(5))}`;
  if (l.startsWith("/") && !l.startsWith("//")) return l;
  if (/^https?:\/\//i.test(l)) return l;
  return "/";
}

// A phone shows one notification per tag. Each entry gets its own, except the
// reminders of one race: "race day" replaces "coming up" on the lock screen
// instead of stacking up beside it.
function pushTag(n) {
  const m = /^reminder:([^:]+):/.exec(n.dedupeKey || "");
  return m ? `reminder:${m[1]}` : `n:${n.id || n.dedupeKey || Date.now()}`;
}

// The JSON the service worker receives (public/sw.js). Kept well inside the
// 4 KB a push message can carry.
export function buildPushPayload(n) {
  return {
    title: clip(n.title, 120) || "NABS Racing",
    body: clip(n.body, 240),
    url: pushUrlFor(n.link),
    tag: pushTag(n),
    type: n.type || null,
  };
}

// --- delivery -----------------------------------------------------------------
async function markDelivered(prisma, endpoint) {
  await prisma.$executeRaw`
    UPDATE "PushSubscription" SET "lastSuccessAt" = ${new Date().toISOString()}, "failures" = 0
    WHERE "endpoint" = ${endpoint}`;
}

async function markFailed(prisma, endpoint) {
  await prisma.$executeRaw`UPDATE "PushSubscription" SET "failures" = "failures" + 1 WHERE "endpoint" = ${endpoint}`;
  await prisma.$executeRaw`
    DELETE FROM "PushSubscription" WHERE "endpoint" = ${endpoint} AND "failures" >= ${MAX_FAILURES}`;
}

async function dropDevice(prisma, endpoint) {
  await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE "endpoint" = ${endpoint}`;
}

async function deliver(prisma, targets, payload, { vapid, subject, ttl, urgency, send }) {
  const out = { sent: 0, failed: 0, removed: 0 };
  const queue = [...targets];
  async function worker() {
    while (queue.length) {
      const t = queue.shift();
      try {
        // Checked again on the way out, for rows stored before the check
        // existed or written by hand: the server only ever POSTs to a push
        // service.
        if (!isPushEndpoint(t.endpoint)) {
          await dropDevice(prisma, t.endpoint);
          out.removed++;
          continue;
        }
        const res = await send({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, {
          vapid,
          subject,
          ttl,
          urgency,
        });
        if (res.ok) {
          out.sent++;
          await markDelivered(prisma, t.endpoint);
        } else if (res.gone) {
          out.removed++;
          await dropDevice(prisma, t.endpoint);
        } else {
          out.failed++;
          await markFailed(prisma, t.endpoint);
        }
      } catch {
        // One device's bookkeeping failing must not cost the others their
        // message.
        out.failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return out;
}

// Push one bell entry to whoever should get it. `n` is the row as written
// ({ id, type, title, body, link, recipientId, dedupeKey }); `ttl` (seconds)
// and `urgency` come from the writer where it knows better than the default.
// `send` is replaceable for the tests.
export async function pushNotification(prisma, n, { ttl = DEFAULT_PUSH_TTL, urgency = "normal", send = sendWebPush } = {}) {
  const category = categoryOf(n?.type);
  if (!category) return { sent: 0, failed: 0, removed: 0 };
  const mode = await readPushMode(prisma);
  if (mode === "off") return { sent: 0, failed: 0, removed: 0 };

  let targets = await dbPushTargets(prisma, n.recipientId || null);
  if (mode === "admins") {
    const admins = await getAdminDiscordIds(prisma);
    targets = targets.filter((t) => admins.has(String(t.loginId || t.discordId)));
  }
  targets = targets.filter((t) => parsePushPrefs(t.prefs)[category]);
  if (!targets.length) return { sent: 0, failed: 0, removed: 0 };

  const vapid = await getVapidKeys(prisma);
  return deliver(prisma, targets, buildPushPayload(n), {
    vapid,
    subject: pushSubject(),
    ttl: Math.max(60, Math.round(ttl)),
    urgency,
    send,
  });
}

// The hand-off from the bell: after the entry is written, outside the request
// that wrote it. A member saving their RSVP must not wait for fifty POSTs to
// Google, and a push service that is down must never fail anything here.
export function queuePush(prisma, n, opts) {
  setImmediate(() => {
    pushNotification(prisma, n, opts).catch((e) => console.warn("[push]", e?.message || e));
  });
}

// "Send a test" from the settings page: one message to this member's own
// devices, whatever their categories say, so they can see it arrive.
export async function sendTestPush(prisma, discordId, { send = sendWebPush } = {}) {
  const rows = await prisma.$queryRaw`
    SELECT "endpoint","p256dh","auth" FROM "PushSubscription" WHERE "discordId" = ${discordId}`;
  if (!rows.length) return { sent: 0, failed: 0, removed: 0, devices: 0 };
  const vapid = await getVapidKeys(prisma);
  const out = await deliver(
    prisma,
    rows,
    {
      title: "Push notifications are on",
      body: "This is how the league reaches you: race reminders, results and anything addressed to you.",
      url: "/profile?tab=settings",
      tag: "push-test",
      type: "NEWS",
    },
    { vapid, subject: pushSubject(), ttl: 3600, urgency: "normal", send }
  );
  return { ...out, devices: rows.length };
}
