import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, requireUser, resolveDriverId } from "../middleware/auth.js";
import {
  dbCreateFeedback,
  dbGetFeedback,
  dbAddFeedbackReply,
  dbListFeedbackForSender,
  shapeFeedbackForSender,
  notifyAdminsOfFeedback,
  notifyAdminsOfReply,
} from "../lib/feedback.js";

// POST /api/feedback — the endpoint behind the site's Feedback button. Open to
// everyone (a visitor who hits a broken page is exactly who we want to hear
// from), so it carries its own small brake against someone hammering it.
//
// The two routes below it belong to the SENDER's side of the conversation: their
// own submissions with whatever the admins answered, and writing back. Both need
// a login, since an entry can only be tied to a person by their Discord account.

const router = Router();

// In-memory rate limit, same reasoning as the admin login's: it only has to
// make flooding the table impractical, not survive a restart.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 6;
const sentByIp = new Map(); // ip -> { count, first }

function tooMany(ip) {
  const rec = sentByIp.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) {
    sentByIp.delete(ip);
    return false;
  }
  return rec.count >= MAX_PER_WINDOW;
}

function record(ip) {
  const rec = sentByIp.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) sentByIp.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}

// The map would otherwise grow one entry per address forever on a long-running
// server. Cleared out lazily whenever it gets big; unref so it holds nothing open.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of sentByIp) if (now - rec.first > WINDOW_MS) sentByIp.delete(ip);
}, WINDOW_MS).unref();

router.post("/", optionalUser, async (req, res, next) => {
  try {
    const ip = req.ip || "unknown";
    if (tooMany(ip)) {
      return res.status(429).json({ error: "That's a lot of feedback at once. Try again in a while." });
    }

    const { kind, message, pageUrl, contact } = req.body || {};

    // Who wrote it, as far as we know. A signed-in member is identified by
    // their account; their CURRENT driver name is preferred over the snapshot
    // in the token (which can be weeks old).
    let discordId = null;
    let senderName = null;
    if (req.user) {
      discordId = req.user.discordId || null;
      senderName = req.user.driverName || req.user.discordName || null;
      try {
        const driverId = await resolveDriverId(prisma, req.user);
        if (driverId) {
          const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } });
          if (d?.name) senderName = d.name;
        }
      } catch {
        /* the token's name is good enough */
      }
    }

    const entry = await dbCreateFeedback(prisma, {
      kind,
      message,
      pageUrl,
      userAgent: req.headers["user-agent"] || null,
      discordId,
      senderName,
      // A logged-out sender may leave a way back; a signed-in one is reachable
      // through Discord already, so their field isn't even shown.
      contact: discordId ? null : contact,
    });
    record(ip);

    // Tell the admins' bell about it, but never make the sender wait for it.
    notifyAdminsOfFeedback(prisma, entry).catch(() => {});

    res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Everything this member has sent, with the admins' answers. Scoped to the
// discordId out of their own verified token — there is no way to ask for
// somebody else's, and nothing here is public.
router.get("/mine", requireUser, async (req, res, next) => {
  try {
    const items = await dbListFeedbackForSender(prisma, req.user.discordId);
    res.json({ items: items.map(shapeFeedbackForSender) });
  } catch (e) {
    next(e);
  }
});

// The sender writing back on their own thread. Rate-limited on the same counter
// as a new submission, and only ever on an entry that is theirs.
router.post("/:id/reply", requireUser, async (req, res, next) => {
  try {
    const ip = req.ip || "unknown";
    if (tooMany(ip)) {
      return res.status(429).json({ error: "That's a lot of messages at once. Try again in a while." });
    }
    const entry = await dbGetFeedback(prisma, req.params.id);
    // Same answer for "doesn't exist" and "isn't yours": whether a given id
    // belongs to somebody else is not something to confirm.
    if (!entry || !entry.discordId || entry.discordId !== req.user.discordId) {
      return res.status(404).json({ error: "Not found" });
    }
    // Not a way to start a conversation — writing in from nowhere would land in
    // the admin list under an entry they never opened. The Feedback button is
    // for that, and it's on every page.
    if (!entry.replies.some((r) => r.author === "ADMIN")) {
      return res.status(400).json({ error: "You can reply once the admins have answered." });
    }

    // Their CURRENT name, like a new submission does — the snapshot on the entry
    // can be seasons old.
    let authorName = req.user.driverName || req.user.discordName || entry.senderName || null;
    try {
      const driverId = await resolveDriverId(prisma, req.user);
      if (driverId) {
        const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } });
        if (d?.name) authorName = d.name;
      }
    } catch {
      /* the token's name is good enough */
    }

    const reply = await dbAddFeedbackReply(prisma, {
      feedbackId: entry.id,
      author: "SENDER",
      authorName,
      body: req.body?.body,
    });
    record(ip);
    notifyAdminsOfReply(prisma, entry, reply).catch(() => {});
    res.status(201).json({
      ok: true,
      item: shapeFeedbackForSender(await dbGetFeedback(prisma, entry.id)),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
