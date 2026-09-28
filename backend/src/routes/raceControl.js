// Race control: the pairing code on the site, and the line the game app uses to
// get collisions (RACE-CONTROL.md has the format for the app).
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, isAdminRequest } from "../middleware/auth.js";
import {
  isRaceControl,
  codeFor,
  newCode,
  discordIdForCode,
  markAppSeen,
  appStatus,
  tooManyMisses,
  noteMiss,
} from "../lib/raceControl.js";
import { feedCursor, waitForFeed } from "../services/liveIncidents.js";

const router = Router();

// Longest the app's question is held open when nothing happens. Under CSP's
// own 30 s receive timeout, with room to spare.
const MAX_WAIT_S = 25;
const DEFAULT_WAIT_S = 20;

// Who is asking, and may they. A PIN admin is allowed but has nobody to pair.
router.get("/me", optionalUser, async (req, res, next) => {
  try {
    const discordId = req.user?.discordId || null;
    const member = discordId ? await isRaceControl(prisma, discordId) : false;
    const allowed = member || isAdminRequest(req);
    res.json({
      allowed,
      canPair: member,
      code: member ? await codeFor(prisma, discordId) : null,
      app: member ? appStatus(discordId) : null,
    });
  } catch (e) {
    next(e);
  }
});

// A new code; the old one stops working at once.
router.post("/code", optionalUser, async (req, res, next) => {
  try {
    const discordId = req.user?.discordId;
    if (!discordId || !(await isRaceControl(prisma, discordId))) {
      return res.status(403).json({ error: "Only race control members get a code. Sign in with Discord." });
    }
    res.json({ ok: true, code: await newCode(prisma, discordId) });
  } catch (e) {
    next(e);
  }
});

// The game app. Long polling: "anything after N?" is answered at once when
// there is, otherwise held until a collision comes in or `wait` seconds pass.
// No `after` = "where are we", answered straight away with the current cursor.
router.get("/app/next", async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const ip = req.ip || "?";
    if (tooManyMisses(ip)) return res.status(429).json({ ok: false, error: "Too many wrong codes, try again later" });
    const code = req.get("X-Race-Control-Code") || req.query.code;
    const discordId = await discordIdForCode(prisma, code);
    if (!discordId) {
      noteMiss(ip);
      return res.status(401).json({ ok: false, error: "Unknown code" });
    }
    markAppSeen(discordId);

    const after = Number(req.query.after);
    const cursorNow = feedCursor();
    if (!Number.isFinite(after) || after < 0 || after > cursorNow) {
      return res.json({ ok: true, cursor: cursorNow, collisions: [] });
    }
    const waitS = Math.min(MAX_WAIT_S, Math.max(0, Number(req.query.wait) || DEFAULT_WAIT_S));
    let gone = false;
    // The RESPONSE closing before we answered is the app hanging up (the
    // request's own "close" fires as soon as it has been read).
    const events = await waitForFeed(after, waitS * 1000, (cancel) =>
      res.on("close", () => {
        if (res.writableFinished) return;
        gone = true;
        cancel();
      })
    );
    if (gone || res.writableEnded) return;
    markAppSeen(discordId);
    res.json({
      ok: true,
      cursor: events.length ? events[events.length - 1].seq : Math.max(after, feedCursor()),
      collisions: events,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
