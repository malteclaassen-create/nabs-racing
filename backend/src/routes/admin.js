import { Router } from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { parseAcRaceJson } from "../services/acJsonParser.js";
import { listRemoteResults, fetchRemoteResult } from "../services/emperorResults.js";
import { saveRaceResults } from "../services/raceWriter.js";
import { getWebhookUrl, setWebhookUrl, announce, syncRaceToDiscord } from "../services/discordService.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// All routes below require admin auth.
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// RACE IMPORT
// ---------------------------------------------------------------------------
// POST /api/admin/races/import  (multipart: file=<AC json>)
// Parses the JSON and returns a fuzzy-matched mapping for the admin to confirm.
// Does NOT persist anything yet.
router.post("/races/import", upload.single("file"), async (req, res, next) => {
  try {
    let json;
    if (req.file) {
      json = JSON.parse(req.file.buffer.toString("utf-8"));
    } else if (req.body && req.body.json) {
      json = typeof req.body.json === "string" ? JSON.parse(req.body.json) : req.body.json;
    } else {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const drivers = await prisma.driver.findMany({ orderBy: { name: "asc" } });
    const parsed = parseAcRaceJson(json, drivers);
    res.json(parsed);
  } catch (e) {
    if (e instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON file" });
    next(e);
  }
});

// GET /api/admin/results/remote?type=RACE
// Lists finished sessions available on the AC Server Manager (newest first).
router.get("/results/remote", async (req, res, next) => {
  try {
    const results = await listRemoteResults({ type: req.query.type || "RACE" });
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: `Could not reach the race server: ${e.message}` });
  }
});

// POST /api/admin/results/remote/import  { id }
// Downloads the chosen result JSON from the server and returns the same
// fuzzy-matched mapping as a manual file upload (nothing persisted yet).
router.post("/results/remote/import", async (req, res, next) => {
  try {
    const { id } = req.body || {};
    if (!id || !/^[A-Za-z0-9_]+$/.test(id)) return res.status(400).json({ error: "Valid result id required" });
    const json = await fetchRemoteResult(id);
    const drivers = await prisma.driver.findMany({ orderBy: { name: "asc" } });
    const parsed = parseAcRaceJson(json, drivers);
    res.json(parsed);
  } catch (e) {
    if (e.message && e.message.startsWith("Invalid AC")) return res.status(400).json({ error: e.message });
    next(e);
  }
});

// POST /api/admin/races/commit
// Body: { number, track, date?, results: [{driverId, position, status, subForTeamId, penaltyPositions}] }
// Creates or updates the race, then stores results + recomputes constructor scores.
router.post("/races/commit", async (req, res, next) => {
  try {
    const { number, track, date, results } = req.body || {};
    if (!number || !Array.isArray(results)) {
      return res.status(400).json({ error: "number and results[] required" });
    }

    let race = await prisma.race.findUnique({ where: { number: Number(number) } });
    if (!race) {
      race = await prisma.race.create({
        data: { number: Number(number), track: track || "Unknown", date: date ? new Date(date) : null },
      });
    } else {
      race = await prisma.race.update({
        where: { id: race.id },
        data: { track: track || race.track, date: date ? new Date(date) : race.date },
      });
    }

    await saveRaceResults(prisma, race.id, results);
    res.json({ ok: true, raceId: race.id, number: race.number });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// EDIT RESULTS
// ---------------------------------------------------------------------------
// PUT /api/admin/races/:id/results  { results: [...] }
router.put("/races/:id/results", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    const { results } = req.body || {};
    if (!Array.isArray(results)) return res.status(400).json({ error: "results[] required" });
    await saveRaceResults(prisma, race.id, results);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// DRIVERS
// ---------------------------------------------------------------------------
router.post("/drivers", async (req, res, next) => {
  try {
    const { id, name, discordName, teamId, tier, isActive } = req.body || {};
    if (!id || !name || !teamId || tier === undefined) {
      return res.status(400).json({ error: "id, name, teamId, tier required" });
    }
    const driver = await prisma.driver.create({
      data: {
        id,
        name,
        discordName: discordName || name,
        teamId,
        tier: Number(tier),
        isActive: isActive !== false,
      },
    });
    res.status(201).json(driver);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "Driver id already exists" });
    next(e);
  }
});

router.put("/drivers/:id", async (req, res, next) => {
  try {
    const { name, discordName, teamId, tier, isActive, photoUrl } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = name;
    if (discordName !== undefined) data.discordName = discordName;
    if (teamId !== undefined) data.teamId = teamId;
    if (tier !== undefined) data.tier = Number(tier);
    if (isActive !== undefined) data.isActive = isActive;
    if (photoUrl !== undefined) data.photoUrl = photoUrl || null;
    const driver = await prisma.driver.update({ where: { id: req.params.id }, data });
    res.json(driver);
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ error: "Driver not found" });
    next(e);
  }
});

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
// PUT /api/admin/settings/pin  { newPin }
router.put("/settings/pin", async (req, res, next) => {
  try {
    const { newPin } = req.body || {};
    if (!newPin || String(newPin).length < 4) {
      return res.status(400).json({ error: "newPin must be at least 4 characters" });
    }
    const hash = await bcrypt.hash(String(newPin), 10);
    await prisma.setting.upsert({
      where: { key: "admin_pin_hash" },
      update: { value: hash },
      create: { key: "admin_pin_hash", value: hash },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// DISCORD WEBHOOK + EVENTS
// ---------------------------------------------------------------------------
// GET current webhook config (returns whether one is set, masked)
router.get("/discord/webhook", async (req, res, next) => {
  try {
    const url = await getWebhookUrl(prisma);
    res.json({ configured: !!url, preview: url ? url.replace(/\/[^/]+$/, "/•••") : null });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/discord/webhook  { url }   ("" clears it)
router.put("/discord/webhook", async (req, res, next) => {
  try {
    const { url } = req.body || {};
    if (url && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) {
      return res.status(400).json({ error: "Not a valid Discord webhook URL" });
    }
    await setWebhookUrl(prisma, url || "");
    res.json({ ok: true, configured: !!url });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/discord/test  -> send a test message
router.post("/discord/test", async (req, res, next) => {
  try {
    const result = await announce(prisma, "✅ NABS Racing website is connected to this channel.");
    if (result.skipped) return res.status(400).json({ error: "No webhook configured" });
    if (!result.ok) return res.status(502).json({ error: result.reason || "Discord rejected the message" });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/events  { number, track, date }  -> create an upcoming race
router.post("/events", async (req, res, next) => {
  try {
    const { number, track, date } = req.body || {};
    if (!number || !track) return res.status(400).json({ error: "number and track required" });
    const race = await prisma.race.create({
      data: {
        number: Number(number),
        track,
        date: date ? new Date(date) : null,
        isCompleted: false,
      },
    });
    res.status(201).json(race);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "Round number already exists" });
    next(e);
  }
});

// POST /api/admin/events/:id/announce -> (re)post the event message to Discord
router.post("/events/:id/announce", async (req, res, next) => {
  try {
    const result = await syncRaceToDiscord(prisma, req.params.id);
    if (result.skipped) return res.status(400).json({ error: "No webhook configured" });
    if (!result.ok) return res.status(502).json({ error: result.reason || "Discord error" });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

export default router;
