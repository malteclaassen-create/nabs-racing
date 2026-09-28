// Race control on the live page: contacts for the map, the stopped cars, who is
// off track and the contact threshold. Race control and admins only
// (lib/raceControl.js).
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, isAdminRequest } from "../middleware/auth.js";
import { isRaceControl } from "../lib/raceControl.js";
import { resolveServerKey } from "../lib/liveServers.js";
import { publicDriverId, getDemoIncidents } from "../services/liveTiming.js";
import {
  listIncidents,
  stoppedNow,
  offTrackNow,
  sessionOf,
  setIncidentStatus,
  getMinKmh,
  setMinKmh,
} from "../services/liveIncidents.js";

const router = Router();

async function allowed(req) {
  if (isAdminRequest(req)) return true;
  return !!req.user?.discordId && (await isRaceControl(prisma, req.user.discordId).catch(() => false));
}

async function gate(req, res, next) {
  if (await allowed(req)) return next();
  res.status(403).json({ error: "This is for race control" });
}

function who(req) {
  return req.user?.discordName || req.user?.username || req.user?.discordId || (isAdminRequest(req) ? "admin" : null);
}

// Does this viewer get the race control button at all? Never an error.
router.get("/access", optionalUser, async (req, res) => {
  res.json({ allowed: await allowed(req) });
});

router.get("/", optionalUser, gate, async (req, res, next) => {
  try {
    const minKmh = await getMinKmh();
    const demo = req.query.demo === "1" ? "race" : req.query.demo === "practice" ? "practice" : null;
    if (demo) {
      const d = getDemoIncidents(demo);
      if (d) return res.json({ ok: true, demo: true, minKmh, ...d });
    }
    const serverKey = await resolveServerKey(prisma, { series: req.query.series, server: req.query.server });
    // After the first load the board only asks for what changed since its
    // last answer (`after`, the cursor it was given), so a long race does not
    // mean re-sending every contact of the evening every two seconds.
    const after = Number(req.query.after);
    const changedAfter = Number.isFinite(after) && after > 0 ? after : null;
    // Five seconds of overlap: rows are written a moment after they are
    // stamped, and one landing between our read and the stamp would otherwise
    // be skipped for good. The page merges by id, so a repeat costs nothing.
    const cursor = Date.now() - 5000;
    const incidents = await listIncidents(serverKey, { changedAfter });
    res.json({
      ok: true,
      serverKey,
      minKmh,
      cursor,
      partial: changedAfter != null,
      session: sessionOf(serverKey),
      // Public pseudonyms only, the same ids the board uses, so the page can
      // tie an incident to a car on the map.
      stopped: stoppedNow(serverKey).map((s) => ({ ...s, guid: publicDriverId(s.guid) })),
      offTrack: offTrackNow(serverKey).map((o) => ({ ...o, guid: publicDriverId(o.guid) })),
      incidents: incidents.map((i) => ({
        ...i,
        driverGuid: publicDriverId(i.driverGuid),
        otherGuid: i.otherGuid ? publicDriverId(i.otherGuid) : null,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", optionalUser, gate, async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (!["open", "done"].includes(status)) return res.status(400).json({ error: "status must be open or done" });
    const n = await setIncidentStatus(String(req.params.id), status, who(req));
    if (!n) return res.status(404).json({ error: "No such incident" });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.put("/settings", optionalUser, gate, async (req, res, next) => {
  try {
    const n = Number(req.body?.minKmh);
    if (!Number.isFinite(n) || n < 0 || n > 300) return res.status(400).json({ error: "Pick a speed between 0 and 300 km/h" });
    res.json({ ok: true, minKmh: await setMinKmh(n) });
  } catch (e) {
    next(e);
  }
});

export default router;
