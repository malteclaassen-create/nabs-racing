// Race control on the live page: the incident list, the stopped-car count and
// the contact threshold. Stewards and admins only (lib/stewards.js).
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, isAdminRequest } from "../middleware/auth.js";
import { isSteward } from "../lib/stewards.js";
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
  return !!req.user?.discordId && (await isSteward(prisma, req.user.discordId).catch(() => false));
}

async function gate(req, res, next) {
  if (await allowed(req)) return next();
  res.status(403).json({ error: "Race control is for stewards" });
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
    const incidents = await listIncidents(serverKey);
    res.json({
      ok: true,
      serverKey,
      minKmh,
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
