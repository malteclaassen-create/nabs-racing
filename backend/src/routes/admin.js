import { Router } from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join, extname } from "path";
import { fileURLToPath } from "url";
import prisma from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { parseAcRaceJson } from "../services/acJsonParser.js";
import { listRemoteResults, fetchRemoteResult } from "../services/emperorResults.js";
import { saveRaceResults } from "../services/raceWriter.js";
import { previewRaceImpact } from "../services/previewService.js";
import { getWebhookUrl, setWebhookUrl, announce, syncRaceToDiscord } from "../services/discordService.js";
import { resolveSeasonId } from "../services/seasonService.js";
import { SOCIAL_KEYS, readSocialLinks } from "./settings.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Team logos are written into the frontend's public/teams folder so they are
// served at /teams/<file> (same place the seeded logos live).
const __dir = dirname(fileURLToPath(import.meta.url));
const TEAMS_DIR = join(__dir, "../../../frontend/public/teams");
const LOGO_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/svg+xml": ".svg" };

// All routes below require admin auth.
router.use(requireAdmin);

// Confirmed Driver-Market seat takeovers for races that haven't finished yet.
// Returned alongside a parsed import so the review table can pre-fill the
// "team this race" (subForTeam) column for reserves who were picked to sub.
async function getSeatTakeovers(prismaClient) {
  const offers = await prismaClient.seatOffer.findMany({
    where: { status: "FILLED", filledById: { not: null }, race: { isCompleted: false } },
    include: { team: true, filledBy: true, driver: true, race: true },
  });
  return offers.map((o) => ({
    reserveDriverId: o.filledById,
    reserveName: o.filledBy?.name || null,
    teamId: o.teamId,
    teamName: o.team?.name || null,
    forName: o.driver?.name || null,
    raceNumber: o.race?.number ?? null,
    track: o.race?.track || null,
  }));
}

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
    res.json({ ...parsed, seatTakeovers: await getSeatTakeovers(prisma) });
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
    res.json({ ...parsed, seatTakeovers: await getSeatTakeovers(prisma) });
  } catch (e) {
    if (e.message && e.message.startsWith("Invalid AC")) return res.status(400).json({ error: e.message });
    next(e);
  }
});

// POST /api/admin/races/commit
// Body: { number, track, date?, results: [{driverId, position, status, subForTeamId, penaltySeconds, totalTimeMs}] }
// Creates or updates the race, then stores results + recomputes constructor scores.
router.post("/races/commit", async (req, res, next) => {
  try {
    const { number, track, date, results, seasonId } = req.body || {};
    if (!number || !Array.isArray(results)) {
      return res.status(400).json({ error: "number and results[] required" });
    }

    const targetSeasonId = seasonId || (await resolveSeasonId(prisma, undefined));
    let race = await prisma.race.findFirst({
      where: { number: Number(number), seasonId: targetSeasonId },
    });
    if (!race) {
      race = await prisma.race.create({
        data: {
          number: Number(number),
          track: track || "Unknown",
          date: date ? new Date(date) : null,
          seasonId: targetSeasonId,
        },
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

// POST /api/admin/races/preview
// Body: { raceId? , number?, results: [...], seasonId? }
// Computes the would-be round result + driver/constructor standings for the
// given (unsaved) results. Nothing is persisted.
router.post("/races/preview", async (req, res, next) => {
  try {
    const { raceId, number, results, season } = req.body || {};
    if (!Array.isArray(results)) return res.status(400).json({ error: "results[] required" });
    const seasonId = await resolveSeasonId(prisma, season);
    const preview = await previewRaceImpact(prisma, {
      seasonId,
      raceId: raceId || null,
      number: number ?? null,
      results,
    });
    res.json(preview);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// DRIVER MARKET — admin override
// Admins can swap in / remove the chosen reserve (e.g. a weak reserve shouldn't
// take a Tier-1 seat) or cancel an offer outright. The driver-facing flow lives
// in routes/market.js.
// ---------------------------------------------------------------------------

// POST /api/admin/market/:offerId/assign  { driverId | null }
// Force the chosen reserve for an offer; null clears it (back to OPEN).
router.post("/market/:offerId/assign", async (req, res, next) => {
  try {
    const offer = await prisma.seatOffer.findUnique({ where: { id: req.params.offerId } });
    if (!offer) return res.status(404).json({ error: "Offer not found" });

    const pickId = req.body?.driverId || null;
    if (pickId) {
      const reserve = await prisma.driver.findUnique({
        where: { id: pickId },
        include: { team: true },
      });
      if (!reserve) return res.status(404).json({ error: "Driver not found" });
      if (reserve.team?.tier !== 0) {
        return res.status(400).json({ error: "Only reserve drivers can fill a seat" });
      }
    }
    await prisma.seatOffer.update({
      where: { id: offer.id },
      data: { filledById: pickId, status: pickId ? "FILLED" : "OPEN" },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/market/:offerId -> remove any offer entirely.
router.delete("/market/:offerId", async (req, res, next) => {
  try {
    const offer = await prisma.seatOffer.findUnique({ where: { id: req.params.offerId } });
    if (!offer) return res.status(404).json({ error: "Offer not found" });
    await prisma.seatOffer.delete({ where: { id: offer.id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// SOCIAL LINKS (footer icons + the "Join Discord" button)
// ---------------------------------------------------------------------------

// GET /api/admin/social -> current social links for the editor.
router.get("/social", async (req, res, next) => {
  try {
    res.json(await readSocialLinks(prisma));
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/social  { discord, twitch, youtube, instagram, tiktok, x }
// Empty value clears (hides) that platform. Bare values get https:// prefixed.
router.put("/social", async (req, res, next) => {
  try {
    const body = req.body || {};
    for (const k of SOCIAL_KEYS) {
      let val = String(body[k] ?? "").trim();
      if (val && !/^https?:\/\//i.test(val)) val = `https://${val}`;
      await prisma.setting.upsert({
        where: { key: `social_${k}` },
        update: { value: val },
        create: { key: `social_${k}`, value: val },
      });
    }
    res.json(await readSocialLinks(prisma));
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
    const { id, name, discordName, teamId, tier, isActive, seasonId } = req.body || {};
    if (!id || !name || !teamId || tier === undefined) {
      return res.status(400).json({ error: "id, name, teamId, tier required" });
    }
    // Default to the season the chosen team belongs to (or the active season).
    let resolvedSeasonId = seasonId;
    if (!resolvedSeasonId) {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      resolvedSeasonId = team?.seasonId || (await resolveSeasonId(prisma, undefined));
    }
    const driver = await prisma.driver.create({
      data: {
        id,
        name,
        discordName: discordName || name,
        teamId,
        tier: Number(tier),
        isActive: isActive !== false,
        seasonId: resolvedSeasonId,
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

// POST /api/admin/events  { number?, track, date?, seasonId?, isSpecialEvent? }
// Creates an upcoming race (or a non-championship special event when
// isSpecialEvent is set; those have no round number).
router.post("/events", async (req, res, next) => {
  try {
    const { number, track, date, seasonId, isSpecialEvent } = req.body || {};
    if (!track) return res.status(400).json({ error: "track required" });
    if (!isSpecialEvent && !number) return res.status(400).json({ error: "number required" });
    const targetSeasonId = seasonId || (await resolveSeasonId(prisma, undefined));
    const race = await prisma.race.create({
      data: {
        number: isSpecialEvent ? null : Number(number),
        track,
        date: date ? new Date(date) : null,
        isCompleted: false,
        isSpecialEvent: !!isSpecialEvent,
        seasonId: targetSeasonId,
      },
    });
    res.status(201).json(race);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "Round number already exists in this season" });
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

// DELETE /api/admin/events/:id -> remove an upcoming race / special event.
// Refuses to delete a race that already has stored results.
router.delete("/events/:id", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { results: true } } },
    });
    if (!race) return res.status(404).json({ error: "Race not found" });
    if (race._count.results > 0) {
      return res.status(409).json({ error: "Race has results; edit them instead of deleting." });
    }
    await prisma.race.delete({ where: { id: race.id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// SEASONS
// ---------------------------------------------------------------------------
// GET /api/admin/seasons -> all seasons with content counts.
router.get("/seasons", async (req, res, next) => {
  try {
    const seasons = await prisma.season.findMany({
      orderBy: { number: "desc" },
      include: { _count: { select: { teams: true, drivers: true, races: true } } },
    });
    res.json(seasons);
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/seasons  { number, name, game? }
router.post("/seasons", async (req, res, next) => {
  try {
    const { number, name, game } = req.body || {};
    if (number === undefined || !name) return res.status(400).json({ error: "number and name required" });
    const season = await prisma.season.create({
      data: { number: Number(number), name, game: game || null },
    });
    res.status(201).json(season);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "A season with that number already exists" });
    next(e);
  }
});

// PUT /api/admin/seasons/:id  { number?, name?, game? }
router.put("/seasons/:id", async (req, res, next) => {
  try {
    const { number, name, game } = req.body || {};
    const data = {};
    if (number !== undefined) data.number = Number(number);
    if (name !== undefined) data.name = name;
    if (game !== undefined) data.game = game || null;
    const season = await prisma.season.update({ where: { id: req.params.id }, data });
    res.json(season);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "A season with that number already exists" });
    if (e.code === "P2025") return res.status(404).json({ error: "Season not found" });
    next(e);
  }
});

// POST /api/admin/seasons/:id/activate -> make this the active (public default) season.
router.post("/seasons/:id/activate", async (req, res, next) => {
  try {
    const season = await prisma.season.findUnique({ where: { id: req.params.id } });
    if (!season) return res.status(404).json({ error: "Season not found" });
    await prisma.$transaction([
      prisma.season.updateMany({ data: { isActive: false } }),
      prisma.season.update({ where: { id: season.id }, data: { isActive: true } }),
    ]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/seasons/:id/clone-teams  { fromSeasonId }
// Copies the teams of another season into this one as a starting point. New team
// ids are suffixed with the target season number to keep them globally unique.
router.post("/seasons/:id/clone-teams", async (req, res, next) => {
  try {
    const { fromSeasonId } = req.body || {};
    const target = await prisma.season.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: "Target season not found" });
    if (!fromSeasonId) return res.status(400).json({ error: "fromSeasonId required" });
    const sourceTeams = await prisma.team.findMany({ where: { seasonId: fromSeasonId } });
    if (sourceTeams.length === 0) return res.status(400).json({ error: "Source season has no teams" });

    let created = 0;
    for (const t of sourceTeams) {
      const newId = `${t.id}_s${target.number}`;
      const exists = await prisma.team.findUnique({ where: { id: newId } });
      if (exists) continue;
      await prisma.team.create({
        data: { id: newId, name: t.name, tier: t.tier, color: t.color, logoUrl: t.logoUrl, seasonId: target.id },
      });
      created++;
    }
    res.json({ ok: true, created });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// TEAMS
// ---------------------------------------------------------------------------
// POST /api/admin/teams  { id, name, tier, color, seasonId? }
router.post("/teams", async (req, res, next) => {
  try {
    const { id, name, tier, color, seasonId } = req.body || {};
    if (!id || !name || tier === undefined || !color) {
      return res.status(400).json({ error: "id, name, tier, color required" });
    }
    const targetSeasonId = seasonId || (await resolveSeasonId(prisma, undefined));
    const team = await prisma.team.create({
      data: { id, name, tier: Number(tier), color, seasonId: targetSeasonId },
    });
    res.status(201).json(team);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "Team id already exists" });
    next(e);
  }
});

// PUT /api/admin/teams/:id  { name?, tier?, color?, logoUrl? }
router.put("/teams/:id", async (req, res, next) => {
  try {
    const { name, tier, color, logoUrl } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = name;
    if (tier !== undefined) data.tier = Number(tier);
    if (color !== undefined) data.color = color;
    if (logoUrl !== undefined) data.logoUrl = logoUrl || null;
    const team = await prisma.team.update({ where: { id: req.params.id }, data });
    res.json(team);
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ error: "Team not found" });
    next(e);
  }
});

// POST /api/admin/teams/:id/logo  (multipart: file=<image>)
// Saves the image into the public teams folder and stores its path on the team.
router.post("/teams/:id/logo", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = LOGO_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Unsupported image type (use PNG, JPG, WEBP or SVG)" });
    const team = await prisma.team.findUnique({ where: { id: req.params.id } });
    if (!team) return res.status(404).json({ error: "Team not found" });

    mkdirSync(TEAMS_DIR, { recursive: true });
    const filename = `${team.id}${ext}`;
    writeFileSync(join(TEAMS_DIR, filename), req.file.buffer);
    // Cache-bust the URL so an updated logo shows immediately.
    const logoUrl = `/teams/${filename}?v=${Date.now()}`;
    await prisma.team.update({ where: { id: team.id }, data: { logoUrl } });
    res.json({ ok: true, logoUrl });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/teams/:id -> remove a team (only if it has no drivers/results).
router.delete("/teams/:id", async (req, res, next) => {
  try {
    const team = await prisma.team.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { drivers: true, results: true, constructorScores: true } } },
    });
    if (!team) return res.status(404).json({ error: "Team not found" });
    if (team._count.drivers > 0 || team._count.results > 0 || team._count.constructorScores > 0) {
      return res.status(409).json({ error: "Team still has drivers or results; reassign them first." });
    }
    await prisma.team.delete({ where: { id: team.id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
