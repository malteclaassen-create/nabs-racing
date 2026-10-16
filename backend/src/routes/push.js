// ---------------------------------------------------------------------------
// Push notifications, the member's side (lib/push.js has the why). Everything
// here is about the signed-in member's own devices and choices; the league's
// switch is in the admin routes (PUT /api/admin/push).
//
//   GET    /api/push              available? + the key to subscribe with +
//                                 this member's categories and devices
//   POST   /api/push/subscribe    store this device's subscription
//   POST   /api/push/unsubscribe  forget one of this member's devices
//   PUT    /api/push/prefs        which categories get pushed
//   POST   /api/push/test         one message to this member's devices
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireUser, loginDiscordId } from "../middleware/auth.js";
import {
  PUSH_CATEGORIES,
  cleanSubscription,
  dbListDevices,
  dbRemoveSubscription,
  dbSaveSubscription,
  deviceLabel,
  getVapidKeys,
  pushAvailableTo,
  readPushMode,
  readPushPrefs,
  sendTestPush,
  writePushPrefs,
} from "../lib/push.js";

const router = Router();
router.use(requireUser);

// The categories as the settings page lists them: no type keys, those are the
// server's business.
const CATEGORIES = PUSH_CATEGORIES.map(({ key, label, help }) => ({ key, label, help }));

// Not available is an answer, not an error: the page simply shows nothing.
async function available(req) {
  return pushAvailableTo(await readPushMode(prisma), req.isAdminRequest === true);
}

router.get("/", async (req, res, next) => {
  try {
    if (!(await available(req))) return res.json({ available: false });
    const [keys, prefs, devices] = await Promise.all([
      getVapidKeys(prisma),
      readPushPrefs(prisma, req.user.discordId),
      dbListDevices(prisma, req.user.discordId),
    ]);
    res.json({ available: true, publicKey: keys.publicKey, categories: CATEGORIES, prefs, devices });
  } catch (e) {
    next(e);
  }
});

router.post("/subscribe", async (req, res, next) => {
  try {
    if (!(await available(req))) return res.status(403).json({ error: "Push notifications are not switched on yet." });
    const subscription = cleanSubscription(req.body?.subscription);
    if (!subscription) {
      return res.status(400).json({ error: "This browser's push service is not one the site can send to." });
    }
    await dbSaveSubscription(prisma, {
      discordId: req.user.discordId,
      loginId: loginDiscordId(req.user),
      subscription,
      device: deviceLabel(req.headers["user-agent"]),
    });
    res.json({ ok: true, devices: await dbListDevices(prisma, req.user.discordId) });
  } catch (e) {
    next(e);
  }
});

// Allowed while the feature is off too: switching push OFF must always work.
router.post("/unsubscribe", async (req, res, next) => {
  try {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
    if (!endpoint) return res.status(400).json({ error: "Which device?" });
    await dbRemoveSubscription(prisma, req.user.discordId, endpoint);
    res.json({ ok: true, devices: await dbListDevices(prisma, req.user.discordId) });
  } catch (e) {
    next(e);
  }
});

router.put("/prefs", async (req, res, next) => {
  try {
    res.json({ ok: true, prefs: await writePushPrefs(prisma, req.user.discordId, req.body?.prefs) });
  } catch (e) {
    next(e);
  }
});

// One test per member per half minute: it is a button, and a button gets
// pressed five times when the first message is slow to show up.
const lastTest = new Map();
const TEST_EVERY_MS = 30_000;

router.post("/test", async (req, res, next) => {
  try {
    if (!(await available(req))) return res.status(403).json({ error: "Push notifications are not switched on yet." });
    const me = req.user.discordId;
    const at = lastTest.get(me) || 0;
    if (Date.now() - at < TEST_EVERY_MS) {
      return res.status(429).json({ error: "A test is on its way. Give it half a minute before sending another." });
    }
    lastTest.set(me, Date.now());
    const out = await sendTestPush(prisma, me);
    if (!out.devices) return res.status(400).json({ error: "Push isn't on for any of your devices yet." });
    res.json({ ok: true, ...out, devices: await dbListDevices(prisma, me) });
  } catch (e) {
    next(e);
  }
});

export default router;
