// ---------------------------------------------------------------------------
// The nav-bar bell, member-only (broadcasts are league-internal news like new
// downloads, and personal rows are tied to the Discord id anyway). The nav
// polls /count once a minute; the full list loads when the bell is opened,
// which also marks everything seen.
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireUser } from "../middleware/auth.js";
import {
  dbListNotificationsFor,
  dbUnreadCount,
  dbMarkNotificationsSeen,
  ensureRaceReminders,
} from "../lib/notifications.js";

const router = Router();
router.use(requireUser);

// GET /api/notifications -> { items, unread }
router.get("/", async (req, res, next) => {
  try {
    await ensureRaceReminders(prisma);
    const [items, unread] = await Promise.all([
      dbListNotificationsFor(prisma, req.user.discordId),
      dbUnreadCount(prisma, req.user.discordId),
    ]);
    res.json({ items, unread });
  } catch (e) {
    next(e);
  }
});

// GET /api/notifications/count -> { unread } (the cheap 60s poll)
router.get("/count", async (req, res, next) => {
  try {
    await ensureRaceReminders(prisma);
    res.json({ unread: await dbUnreadCount(prisma, req.user.discordId) });
  } catch (e) {
    next(e);
  }
});

// POST /api/notifications/seen -> everything up to now counts as read.
router.post("/seen", async (req, res, next) => {
  try {
    await dbMarkNotificationsSeen(prisma, req.user.discordId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
