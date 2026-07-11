import { Router } from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import { writeFileSync, mkdirSync, appendFileSync, readFileSync, existsSync } from "fs";
import { join, extname, basename } from "path";
import prisma from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { parseAcRaceJson } from "../services/acJsonParser.js";
import { listRemoteResults, fetchRemoteResult } from "../services/emperorResults.js";
import { saveRaceResults } from "../services/raceWriter.js";
import { previewRaceImpact } from "../services/previewService.js";
import { getDriverRatings, RATING_DEFAULTS } from "../services/driverRatingsService.js";
import { getWebhookUrl, setWebhookUrl, announce, syncRaceToDiscord } from "../services/discordService.js";
import { resolveSeasonId, invalidatePrivateSeasonCache } from "../services/seasonService.js";
import { checkSeasonIntegrity } from "../services/integrityService.js";
import { createBackup, tryCreateBackup, listBackups, createFullBackupZip } from "../services/backupService.js";
import { SOCIAL_KEYS, readSocialLinks } from "./settings.js";
import {
  dbListDownloads, dbGetDownload, dbCreateDownload, dbUpdateDownload, dbDeleteDownload,
  dbListFolders, dbGetFolder, dbCreateFolder, dbUpdateFolder, dbDeleteFolder,
  listDiskFiles, statFile, fmtSize, shapeDownload, ensureDownloadsDir, DOWNLOADS_DIR,
} from "../lib/downloads.js";
import { stashIncoming, archiveCommitted } from "../lib/resultsArchive.js";
import { readRatingWeights, writeRatingWeights } from "../lib/ratingWeights.js";
import { readTrackInfo, writeTrackInfo } from "../lib/trackInfo.js";
import { normKey } from "../lib/trackKeys.js";
import { readRaceInfo, writeRaceInfo } from "../lib/raceInfo.js";
import { readWelcomeFaq, writeWelcomeFaq } from "../lib/welcomeFaq.js";
import { dbListMembers, dbGetMember, dbSetBanned, shapeMember } from "../lib/members.js";
import { dbLinkDrivers, dbUnlinkDriver, dbListPersons } from "../lib/persons.js";
import { getAdminDiscordIds, setDiscordAdmin } from "../lib/adminUsers.js";
import { UPLOADS_DIR, LOGS_DIR } from "../lib/dataDirs.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Downloads upload: the big AC files (tracks, cars, F1 2007…) can be gigabytes,
// so they must stream straight to disk in DOWNLOADS_DIR — buffering them in RAM
// (memoryStorage) would blow up the process. Used by the Admin "Downloads" tab
// so files can be added over the web on hosts where there's no SFTP access to
// the folder (e.g. Railway).
function safeUploadName(original) {
  const base =
    basename(original || "file")
      .replace(/[^A-Za-z0-9._()+-]+/g, "_")
      .replace(/^\.+/, "")
      .trim() || "file";
  // Never overwrite an existing file: append " (1)", " (2)", … before the ext.
  let name = base;
  const ext = extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  for (let i = 1; existsSync(join(DOWNLOADS_DIR, name)); i++) name = `${stem} (${i})${ext}`;
  return name;
}

const downloadUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        ensureDownloadsDir();
        cb(null, DOWNLOADS_DIR);
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => cb(null, safeUploadName(file.originalname)),
  }),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5 GB ceiling
});

// Uploaded team logos live under backend/uploads (served at /api/uploads/...),
// NOT in frontend/public: a production build serves a baked dist/, so files
// written into public/ at runtime would only appear after a rebuild. The
// seeded logos keep living at /teams/<id>.png inside the frontend bundle.
const TEAMS_DIR = join(UPLOADS_DIR, "teams");
const TRACKS_DIR = join(UPLOADS_DIR, "tracks");
const LOGO_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/svg+xml": ".svg" };
// A track key is a slug (letters/digits only) — validate before touching the FS.
const safeTrackKey = (k) => (normKey(k) === String(k || "").toLowerCase() && k ? k : null);

// All routes below require admin auth.
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// ACTIVITY LOG
// Every successful admin change is appended to a JSON-lines file, so there is
// always an answer to "what was changed, and when?". File-based on purpose:
// no schema migration needed, trivially greppable, survives DB restores.
// ---------------------------------------------------------------------------
const ACTIVITY_LOG = join(LOGS_DIR, "admin-activity.log");

router.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  res.on("finish", () => {
    if (res.statusCode >= 300) return; // only log successful changes
    try {
      mkdirSync(LOGS_DIR, { recursive: true });
      appendFileSync(
        ACTIVITY_LOG,
        JSON.stringify({ t: new Date().toISOString(), method: req.method, path: req.originalUrl.replace(/^\/api\/admin/, "") }) + "\n"
      );
    } catch {
      /* logging must never break the request */
    }
  });
  next();
});

// GET /api/admin/activity -> the latest admin actions, newest first.
router.get("/activity", (req, res) => {
  try {
    if (!existsSync(ACTIVITY_LOG)) return res.json({ entries: [] });
    const lines = readFileSync(ACTIVITY_LOG, "utf-8").trim().split("\n");
    const entries = lines.slice(-150).reverse().map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    res.json({ entries });
  } catch {
    res.json({ entries: [] });
  }
});

// ---------------------------------------------------------------------------
// HEALTH: INTEGRITY CHECK + BACKUPS
// ---------------------------------------------------------------------------
// GET /api/admin/integrity?season=<number|id> -> full season consistency report.
router.get("/integrity", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, { includePrivate: true });
    if (!seasonId) return res.status(404).json({ error: "Season not found" });
    res.json(await checkSeasonIntegrity(prisma, seasonId));
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/backups -> list of snapshot files (newest first).
router.get("/backups", (req, res) => {
  res.json({ backups: listBackups() });
});

// POST /api/admin/backups -> create a manual snapshot now.
router.post("/backups", async (req, res, next) => {
  try {
    const backup = await createBackup(prisma, "manual");
    res.json({ ok: true, backup });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/backups/download -> full backup (DB snapshot + uploads) as a
// zip. This is the copy that belongs on ANOTHER machine — everything else in
// backend/backups/ lives on the same disk as the live database.
router.get("/backups/download", async (req, res, next) => {
  try {
    const { name, buffer } = await createFullBackupZip(prisma);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.send(buffer);
  } catch (e) {
    next(e);
  }
});

// Confirmed Driver-Market seat takeovers for races that haven't finished yet.
// Returned alongside a parsed import so the review table can pre-fill the
// "team this race" (subForTeam) column for reserves who were picked to sub.
async function getSeatTakeovers(prismaClient, seasonId) {
  const offers = await prismaClient.seatOffer.findMany({
    where: {
      status: "FILLED",
      filledById: { not: null },
      race: { isCompleted: false, ...(seasonId ? { seasonId } : {}) },
    },
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

    // Match only against the target season's roster — with several seasons in
    // the DB, same-named drivers of old seasons must never be suggested.
    const seasonId = await resolveSeasonId(prisma, req.query.season, { includePrivate: true });
    const drivers = await prisma.driver.findMany({ where: { seasonId }, orderBy: { name: "asc" } });
    const parsed = parseAcRaceJson(json, drivers);
    // Keep the raw JSON so the round's telemetry can be recomputed later; the
    // key comes back with the parse and is moved into place on commit.
    const archiveKey = stashIncoming(json);
    res.json({ ...parsed, archiveKey, seatTakeovers: await getSeatTakeovers(prisma, seasonId) });
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
    const { id, season } = req.body || {};
    if (!id || !/^[A-Za-z0-9_]+$/.test(id)) return res.status(400).json({ error: "Valid result id required" });
    const json = await fetchRemoteResult(id);
    const seasonId = await resolveSeasonId(prisma, season, { includePrivate: true });
    const drivers = await prisma.driver.findMany({ where: { seasonId }, orderBy: { name: "asc" } });
    const parsed = parseAcRaceJson(json, drivers);
    const archiveKey = stashIncoming(json);
    res.json({ ...parsed, archiveKey, seatTakeovers: await getSeatTakeovers(prisma, seasonId) });
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
    const { number, track, date, results, seasonId, archiveKey } = req.body || {};
    if (!number || !Array.isArray(results)) {
      return res.status(400).json({ error: "number and results[] required" });
    }

    const targetSeasonId = seasonId || (await resolveSeasonId(prisma, undefined, { includePrivate: true }));
    let race = await prisma.race.findFirst({
      where: { number: Number(number), seasonId: targetSeasonId },
      include: { _count: { select: { results: true } } },
    });

    // Overwrite guard: committing over a round that already has stored results
    // replaces them entirely. Require an explicit confirmation from the UI.
    if (race && race._count.results > 0 && !req.body.overwrite) {
      return res.status(409).json({
        error: `Round ${race.number} already has ${race._count.results} stored results. Confirm to overwrite them.`,
        needsConfirm: true,
      });
    }

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

    // Automatic pre-save snapshot: one file-copy away from undoing a mistake.
    await tryCreateBackup(prisma, `before-import-r${race.number}`);
    await saveRaceResults(prisma, race.id, results);
    // Move the raw JSON into its season folder so this round's telemetry can be
    // recomputed later. Best-effort: never fails the commit.
    if (archiveKey) {
      const season = await prisma.season.findUnique({ where: { id: targetSeasonId } });
      archiveCommitted(archiveKey, {
        seasonNumber: season?.number ?? null,
        raceNumber: race.number,
        track: race.track,
      });
    }
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
    const seasonId = await resolveSeasonId(prisma, season, { includePrivate: true });
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

// POST /api/admin/ratings/preview
// Body: { weights?: { band, fullXpShare, rtg, pac, rac, aha }, season? }
// Returns the driver ratings computed with the supplied weights (or the defaults
// when omitted), plus the defaults so the tuning panel can initialise itself.
// Read-only — nothing is persisted.
router.post("/ratings/preview", async (req, res, next) => {
  try {
    const { weights, season } = req.body || {};
    const seasonId = await resolveSeasonId(prisma, season, { includePrivate: true });
    const ratings = seasonId ? await getDriverRatings(prisma, seasonId, weights || {}) : [];
    const saved = await readRatingWeights(prisma);
    res.json({ defaults: RATING_DEFAULTS, saved, ratings });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/ratings/weights -> { defaults, saved }
router.get("/ratings/weights", async (req, res, next) => {
  try {
    res.json({ defaults: RATING_DEFAULTS, saved: await readRatingWeights(prisma) });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/ratings/weights  { weights | null }
// Persists the weights the public ratings use; null clears back to defaults.
router.put("/ratings/weights", async (req, res, next) => {
  try {
    const saved = await writeRatingWeights(prisma, req.body?.weights ?? null);
    res.json({ ok: true, saved });
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
    // Automatic pre-save snapshot: one file-copy away from undoing a mistake.
    await tryCreateBackup(prisma, `before-edit-r${race.number ?? "x"}`);
    await saveRaceResults(prisma, race.id, results);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/races/:id/driver-of-the-day  { driverId | null, pickedBy? }
// Sets (or clears) the fan-favourite pick for a race. The driver must have a
// result row in that race. `pickedBy` records who made the call (the league's
// streamer decides each round). Written via raw SQL (new columns).
router.put("/races/:id/driver-of-the-day", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    const { driverId, pickedBy } = req.body || {};
    if (driverId) {
      const has = await prisma.raceResult.findFirst({ where: { raceId: race.id, driverId } });
      if (!has) return res.status(400).json({ error: "That driver has no result in this race" });
    }
    // The picker only means something alongside a pick; clearing the pick
    // clears the name too.
    const by = driverId && typeof pickedBy === "string" && pickedBy.trim() ? pickedBy.trim().slice(0, 80) : null;
    await prisma.$executeRawUnsafe(
      `UPDATE "Race" SET "driverOfTheDayId" = ?, "driverOfTheDayBy" = ? WHERE "id" = ?`,
      driverId || null,
      by,
      race.id
    );
    res.json({ ok: true, driverOfTheDayId: driverId || null, driverOfTheDayBy: by });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// DRIVERS
// ---------------------------------------------------------------------------
// Driver ids are permanent technical handles — generated from the name (slug,
// uniquified with a numeric suffix) so the admin never has to invent one.
async function uniqueDriverId(name) {
  const base =
    String(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ||
    "driver";
  let id = base;
  for (let i = 2; await prisma.driver.findUnique({ where: { id } }); i++) id = `${base}_${i}`;
  return id;
}

router.post("/drivers", async (req, res, next) => {
  try {
    const { id, name, discordName, teamId, tier, isActive, seasonId } = req.body || {};
    if (!name || !teamId || tier === undefined) {
      return res.status(400).json({ error: "name, teamId, tier required" });
    }
    // Explicit id still wins (scripted imports); otherwise derive from the name.
    const driverId = String(id || "").trim() || (await uniqueDriverId(name));
    // Default to the season the chosen team belongs to (or the active season).
    let resolvedSeasonId = seasonId;
    if (!resolvedSeasonId) {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      resolvedSeasonId = team?.seasonId || (await resolveSeasonId(prisma, undefined, { includePrivate: true }));
    }
    const driver = await prisma.driver.create({
      data: {
        id: driverId,
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
// MEMBERS (Discord login accounts)
// Every Discord account that has ever logged in — linked to a roster driver or
// not. The admin can link/unlink accounts by hand and ban accounts entirely.
// ---------------------------------------------------------------------------
// GET /api/admin/members -> { members: [...], unclaimed: [...] }
//   members   = all login accounts, each with the driver row it's linked to
//               (the ACTIVE season's row when one exists, else the newest).
//   unclaimed = active-season drivers nobody has logged in as yet.
router.get("/members", async (req, res, next) => {
  try {
    const [rows, drivers, activeSeason, adminIds] = await Promise.all([
      dbListMembers(prisma),
      prisma.driver.findMany({ include: { team: true, season: true } }),
      prisma.season.findFirst({ where: { isActive: true } }),
      getAdminDiscordIds(prisma),
    ]);
    const shapeDriver = (d) =>
      d && {
        id: d.id,
        name: d.name,
        discordName: d.discordName,
        tier: d.tier,
        team: d.team ? { id: d.team.id, name: d.team.name, color: d.team.color } : null,
        seasonId: d.seasonId,
        seasonName: d.season?.name || null,
        isActiveSeason: !!activeSeason && d.seasonId === activeSeason.id,
      };
    const members = rows.map((r) => {
      const m = shapeMember(r);
      const linked = drivers.filter((d) => d.discordUserId === m.discordId);
      // Prefer the active season's row; else the most recent season's.
      const driver =
        linked.find((d) => activeSeason && d.seasonId === activeSeason.id) ||
        linked.sort((a, b) => (b.season?.number ?? 0) - (a.season?.number ?? 0))[0] ||
        null;
      return { ...m, driver: shapeDriver(driver), isAdmin: adminIds.has(String(m.discordId)) };
    });
    const unclaimed = drivers
      .filter((d) => activeSeason && d.seasonId === activeSeason.id && !d.discordUserId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(shapeDriver);
    res.json({ members, unclaimed });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/members/:discordId/ban { banned, reason? }
router.post("/members/:discordId/ban", async (req, res, next) => {
  try {
    const { banned, reason } = req.body || {};
    const existing = await dbGetMember(prisma, req.params.discordId);
    if (!existing) return res.status(404).json({ error: "Account not found" });
    const row = await dbSetBanned(prisma, req.params.discordId, !!banned, reason || null);
    res.json({ ok: true, member: shapeMember(row) });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/members/:discordId/admin { isAdmin }
// Grant or revoke admin access for a Discord account. On their next request /
// login they gain (or lose) the admin area without needing the PIN. Takes effect
// live (the admin write-gate re-checks this set on every request).
router.post("/members/:discordId/admin", async (req, res, next) => {
  try {
    const { isAdmin } = req.body || {};
    const existing = await dbGetMember(prisma, req.params.discordId);
    if (!existing) return res.status(404).json({ error: "Account not found" });
    await setDiscordAdmin(prisma, req.params.discordId, !!isAdmin);
    res.json({ ok: true, isAdmin: !!isAdmin });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/members/:discordId/link { driverId }
// Hand-links an account to a roster driver (e.g. when the name matcher failed).
// The unique discordUserId moves: any other driver row holding it is cleared.
router.post("/members/:discordId/link", async (req, res, next) => {
  try {
    const { driverId } = req.body || {};
    if (!driverId) return res.status(400).json({ error: "driverId required" });
    const [account, driver] = await Promise.all([
      dbGetMember(prisma, req.params.discordId),
      prisma.driver.findUnique({ where: { id: driverId } }),
    ]);
    if (!account) return res.status(404).json({ error: "Account not found" });
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    await prisma.$transaction([
      prisma.driver.updateMany({
        where: { discordUserId: req.params.discordId },
        data: { discordUserId: null },
      }),
      prisma.driver.update({
        where: { id: driverId },
        data: { discordUserId: req.params.discordId, discordAvatar: account.avatarUrl ?? undefined },
      }),
    ]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/members/:discordId/create-driver { name?, teamId }
// One-step onboarding for someone who logged in but isn't on the roster at all:
// creates a new driver on the chosen team (tier + season follow the team) and
// links the account to it in the same go. Name defaults to the Discord display
// name; the driver id is a slug of the name (uniquified if taken).
router.post("/members/:discordId/create-driver", async (req, res, next) => {
  try {
    const account = await dbGetMember(prisma, req.params.discordId);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const { teamId } = req.body || {};
    if (!teamId) return res.status(400).json({ error: "teamId required" });
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) return res.status(404).json({ error: "Team not found" });

    const name = String(req.body?.name || account.displayName || account.username).trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const id = await uniqueDriverId(name);

    const [, driver] = await prisma.$transaction([
      // discordUserId is unique — clear any row that still holds it.
      prisma.driver.updateMany({
        where: { discordUserId: req.params.discordId },
        data: { discordUserId: null },
      }),
      prisma.driver.create({
        data: {
          id,
          name,
          discordName: account.username,
          teamId: team.id,
          tier: team.tier,
          seasonId: team.seasonId,
          discordUserId: req.params.discordId,
          discordAvatar: account.avatarUrl ?? null,
        },
      }),
    ]);
    res.status(201).json({ ok: true, driver });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/members/:discordId/unlink
router.post("/members/:discordId/unlink", async (req, res, next) => {
  try {
    await prisma.driver.updateMany({
      where: { discordUserId: req.params.discordId },
      data: { discordUserId: null },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// CROSS-SEASON PERSON LINKS
// Group a person's per-season Driver rows so career stats aggregate and archive
// tables show the person's current name with a "raced as <old>" note.
// ---------------------------------------------------------------------------
const personNorm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// GET /api/admin/persons -> { persons: [{personId, drivers:[...]}], candidates }
// candidates = same-normalized-name driver rows spanning >1 season, not yet linked.
router.get("/persons", async (req, res, next) => {
  try {
    const [groups, drivers, seasons] = await Promise.all([
      dbListPersons(prisma),
      prisma.driver.findMany({ include: { season: { select: { number: true, name: true } }, team: { select: { name: true } } } }),
      prisma.season.findMany({ select: { id: true, number: true } }),
    ]);
    const byId = new Map(drivers.map((d) => [d.id, d]));
    const shape = (d) =>
      d && {
        id: d.id,
        name: d.name,
        seasonId: d.seasonId,
        seasonNumber: d.season?.number ?? null,
        seasonName: d.season?.name ?? null,
        teamName: d.team?.name ?? null,
      };
    const linkedIds = new Set(groups.flatMap((g) => g.driverIds));
    const persons = groups
      .map((g) => ({
        personId: g.personId,
        drivers: g.driverIds.map((id) => shape(byId.get(id))).filter(Boolean).sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0)),
      }))
      .filter((p) => p.drivers.length);

    // Suggestions: names that appear in more than one season and aren't linked.
    const byName = new Map();
    for (const d of drivers) {
      if (linkedIds.has(d.id)) continue;
      const key = personNorm(d.name);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(d);
    }
    const candidates = [];
    for (const rows of byName.values()) {
      const seasonsSpanned = new Set(rows.map((r) => r.seasonId));
      if (rows.length > 1 && seasonsSpanned.size > 1) {
        candidates.push(rows.map(shape).sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0)));
      }
    }
    // Compact roster (all seasons) for the manual two-step linker.
    const allDrivers = drivers
      .map(shape)
      .sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0) || a.name.localeCompare(b.name));
    res.json({ persons, candidates, drivers: allDrivers });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/persons/link { driverIds: [...] }
router.post("/persons/link", async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.driverIds) ? req.body.driverIds.filter(Boolean) : [];
    if (ids.length < 2) return res.status(400).json({ error: "Pick at least two driver rows to link" });
    const found = await prisma.driver.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) return res.status(400).json({ error: "One or more driver ids don't exist" });
    const personId = await dbLinkDrivers(prisma, ids);
    res.json({ ok: true, personId });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/persons/link-auto
// Links every "same normalized name in more than one season" suggestion in one
// go — the same groups the GET above lists as candidates. Only unambiguous
// groups are linked: when one season holds TWO rows with that name, nobody can
// tell which row is the person, so that group stays a manual job.
router.post("/persons/link-auto", async (req, res, next) => {
  try {
    const [groups, drivers] = await Promise.all([
      dbListPersons(prisma),
      prisma.driver.findMany({ select: { id: true, name: true, seasonId: true } }),
    ]);
    const linkedIds = new Set(groups.flatMap((g) => g.driverIds));
    const byName = new Map();
    for (const d of drivers) {
      if (linkedIds.has(d.id)) continue;
      const key = personNorm(d.name);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(d);
    }
    let linked = 0;
    let skippedAmbiguous = 0;
    for (const rows of byName.values()) {
      const seasonsSpanned = new Set(rows.map((r) => r.seasonId));
      if (rows.length < 2 || seasonsSpanned.size < 2) continue;
      if (seasonsSpanned.size !== rows.length) {
        skippedAmbiguous++;
        continue;
      }
      await dbLinkDrivers(prisma, rows.map((r) => r.id));
      linked++;
    }
    res.json({ ok: true, linked, skippedAmbiguous });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/persons/unlink { driverId }
router.post("/persons/unlink", async (req, res, next) => {
  try {
    const { driverId } = req.body || {};
    if (!driverId) return res.status(400).json({ error: "driverId required" });
    await dbUnlinkDriver(prisma, driverId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
// GET /api/admin/security -> launch-checklist check: are the shipped dev
// defaults (seed PIN "nabs2026", fallback JWT secret) still in use? The admin
// UI shows a red banner until both are changed.
router.get("/security", async (req, res, next) => {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: "admin_pin_hash" } });
    const pinIsDefault = setting ? await bcrypt.compare("nabs2026", setting.value) : false;
    const jwtIsDefault = !process.env.JWT_SECRET || process.env.JWT_SECRET === "dev-secret-change-me";
    res.json({ pinIsDefault, jwtIsDefault });
  } catch (e) {
    next(e);
  }
});

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
    const targetSeasonId = seasonId || (await resolveSeasonId(prisma, undefined, { includePrivate: true }));
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

// PUT /api/admin/events/:id  { track?, date? }
// Edit a race's details AFTER the fact — e.g. rename the raw AC track id
// ("acu_cota_2021") to a display name ("COTA") once the round is imported.
// Works for completed rounds too; results and scoring are untouched.
router.put("/events/:id", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    const { track, date } = req.body || {};
    const data = {};
    if (track !== undefined) {
      if (!String(track).trim()) return res.status(400).json({ error: "Track name cannot be empty" });
      data.track = String(track).trim();
    }
    if (date !== undefined) data.date = date ? new Date(date) : null;
    const updated = await prisma.race.update({ where: { id: race.id }, data });
    res.json({ ok: true, race: { id: updated.id, number: updated.number, track: updated.track, date: updated.date } });
  } catch (e) {
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
    const [seasons, raw] = await Promise.all([
      prisma.season.findMany({
        orderBy: { number: "desc" },
        include: { _count: { select: { teams: true, drivers: true, races: true } } },
      }),
      // teamDropWorst / teamDropMode / isPublic aren't in the generated client yet -> raw read.
      prisma.$queryRawUnsafe(`SELECT "id", "teamDropWorst", "teamDropMode", "isPublic" FROM "Season"`).catch(() => []),
    ]);
    const rawById = new Map(raw.map((r) => [r.id, r]));
    res.json(
      seasons.map((s) => {
        const extra = rawById.get(s.id) || {};
        return {
          ...s,
          teamDropWorst: extra.teamDropWorst == null ? null : Number(extra.teamDropWorst),
          teamDropMode: extra.teamDropMode === "rounds" ? "rounds" : null,
          isPublic: extra.isPublic == null ? true : !!Number(extra.isPublic),
        };
      })
    );
  } catch (e) {
    next(e);
  }
});

// Validate the admin-supplied scoring fields and add them to `data`.
// dropWorst: integer 0..10 (0 = every round counts).
// pointsTable: array of non-negative integers for P1..Pn (max 40 entries),
//              or null / [] to fall back to the league default table.
// Returns an error string, or null when everything checked out.
function applyScoringInput(body, data) {
  if (body.dropWorst !== undefined) {
    const n = Number(body.dropWorst);
    if (!Number.isInteger(n) || n < 0 || n > 10) {
      return "dropWorst must be a whole number between 0 and 10";
    }
    data.dropWorst = n;
  }
  if (body.pointsTable !== undefined) {
    const raw = body.pointsTable;
    if (raw === null || (Array.isArray(raw) && raw.length === 0)) {
      data.pointsTable = null; // back to the league default
    } else {
      if (!Array.isArray(raw) || raw.length > 40) {
        return "pointsTable must be a list of up to 40 point values";
      }
      const nums = raw.map(Number);
      if (nums.some((v) => !Number.isInteger(v) || v < 0 || v > 1000)) {
        return "pointsTable may only contain whole numbers from 0 to 1000";
      }
      data.pointsTable = JSON.stringify(nums);
    }
  }
  return null;
}

// teamDropWorst / isPublic live in columns the generated client may not know
// yet, so they're written via raw SQL after the prisma create/update instead of
// through `data`. Returns { error?, teamDropWorst?, isPublic? } where a present
// key means "write this value" (teamDropWorst null = legacy inheritance).
function parseSeasonRawFields(body) {
  const out = {};
  if (body.teamDropWorst !== undefined) {
    const raw = body.teamDropWorst;
    if (raw === null || raw === "") out.teamDropWorst = null; // legacy inheritance
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 24) {
        return { error: "Team dropped rounds must be a whole number between 0 and 24, or blank" };
      }
      out.teamDropWorst = n;
    }
  }
  if (body.teamDropMode !== undefined) {
    const m = body.teamDropMode;
    if (m === null || m === "" || m === "results") out.teamDropMode = null; // default: single-driver results
    else if (m === "rounds") out.teamDropMode = "rounds"; // whole team rounds (sheet style)
    else return { error: "teamDropMode must be 'results', 'rounds' or blank" };
  }
  if (body.isPublic !== undefined) out.isPublic = body.isPublic ? 1 : 0;
  return out;
}

// Apply the raw-SQL season fields to a season id (no-op when none supplied).
async function writeSeasonRawFields(seasonId, raw) {
  if (raw.teamDropWorst !== undefined) {
    await prisma.$executeRawUnsafe(`UPDATE "Season" SET "teamDropWorst" = ? WHERE "id" = ?`, raw.teamDropWorst, seasonId);
  }
  if (raw.teamDropMode !== undefined) {
    await prisma.$executeRawUnsafe(`UPDATE "Season" SET "teamDropMode" = ? WHERE "id" = ?`, raw.teamDropMode, seasonId);
  }
  if (raw.isPublic !== undefined) {
    await prisma.$executeRawUnsafe(`UPDATE "Season" SET "isPublic" = ? WHERE "id" = ?`, raw.isPublic, seasonId);
    invalidatePrivateSeasonCache();
  }
}


// POST /api/admin/seasons  { number, name, game?, dropWorst?, pointsTable? }
router.post("/seasons", async (req, res, next) => {
  try {
    const { number, name, game } = req.body || {};
    if (number === undefined || !name) return res.status(400).json({ error: "number and name required" });
    const data = { number: Number(number), name, game: game || null };
    const scoringError = applyScoringInput(req.body || {}, data);
    if (scoringError) return res.status(400).json({ error: scoringError });
    const raw = parseSeasonRawFields(req.body || {});
    if (raw.error) return res.status(400).json({ error: raw.error });
    const season = await prisma.season.create({ data });
    // New seasons are created PRIVATE by default (hidden until the admin
    // publishes them), unless the request explicitly set isPublic.
    if (raw.isPublic === undefined) raw.isPublic = 0;
    await writeSeasonRawFields(season.id, raw);
    res.status(201).json(season);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "A season with that number already exists" });
    next(e);
  }
});

// PUT /api/admin/seasons/:id  { number?, name?, game?, dropWorst?, pointsTable? }
router.put("/seasons/:id", async (req, res, next) => {
  try {
    const { number, name, game } = req.body || {};
    const data = {};
    if (number !== undefined) data.number = Number(number);
    if (name !== undefined) data.name = name;
    if (game !== undefined) data.game = game || null;
    const scoringError = applyScoringInput(req.body || {}, data);
    if (scoringError) return res.status(400).json({ error: scoringError });
    const raw = parseSeasonRawFields(req.body || {});
    if (raw.error) return res.status(400).json({ error: raw.error });
    const season = await prisma.season.update({ where: { id: req.params.id }, data });
    await writeSeasonRawFields(season.id, raw);
    res.json(season);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "A season with that number already exists" });
    if (e.code === "P2025") return res.status(404).json({ error: "Season not found" });
    next(e);
  }
});

// DELETE /api/admin/seasons/:id[?force=1] -> remove a season.
// The ACTIVE season can never be deleted. An empty season is removed straight
// away. A season that still holds teams/drivers/races requires the explicit
// force flag (the UI asks the admin to type the season's name first) — then
// everything belonging to it is removed, right after an automatic DB backup.
// If the backup fails, the deletion is aborted.
router.delete("/seasons/:id", async (req, res, next) => {
  try {
    const season = await prisma.season.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { teams: true, drivers: true, races: true } } },
    });
    if (!season) return res.status(404).json({ error: "Season not found" });
    if (season.isActive) return res.status(409).json({ error: "The active season cannot be deleted" });

    const { teams, drivers, races } = season._count;
    const hasContent = teams > 0 || drivers > 0 || races > 0;
    if (hasContent && !req.query.force) {
      return res.status(409).json({
        error: `${season.name} still holds ${teams} team(s), ${drivers} driver(s) and ${races} race(s). Deleting removes ALL of it.`,
        needsConfirm: true,
      });
    }

    if (hasContent) {
      // Safety net first: this wipes real data.
      await createBackup(prisma, `before-delete-${season.name}`);
      await prisma.$transaction([
        // Races first: results, constructor scores, RSVPs and seat offers
        // (with their interests) cascade off them.
        prisma.race.deleteMany({ where: { seasonId: season.id } }),
        prisma.driver.deleteMany({ where: { seasonId: season.id } }),
        prisma.team.deleteMany({ where: { seasonId: season.id } }),
        prisma.season.delete({ where: { id: season.id } }),
      ]);
    } else {
      await prisma.season.delete({ where: { id: season.id } });
    }
    res.json({ ok: true, deleted: { teams, drivers, races } });
  } catch (e) {
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
    // An active season is always public — publishing it is the whole point.
    await prisma.$executeRawUnsafe(`UPDATE "Season" SET "isPublic" = 1 WHERE "id" = ?`, season.id);
    invalidatePrivateSeasonCache();
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

// POST /api/admin/seasons/:id/clone-roster  { fromSeasonId }
// Copies teams AND drivers of another season into this one — the one-click
// starting point for a new season. Ids get a season suffix to stay globally
// unique; drivers keep name/discord/country/photo but start with a clean
// season (no results). Safe to re-run: existing ids are skipped.
router.post("/seasons/:id/clone-roster", async (req, res, next) => {
  try {
    const { fromSeasonId } = req.body || {};
    const target = await prisma.season.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: "Target season not found" });
    if (!fromSeasonId) return res.status(400).json({ error: "fromSeasonId required" });
    if (fromSeasonId === target.id) return res.status(400).json({ error: "Source and target season are the same" });
    const [sourceTeams, sourceDrivers] = await Promise.all([
      prisma.team.findMany({ where: { seasonId: fromSeasonId } }),
      prisma.driver.findMany({ where: { seasonId: fromSeasonId } }),
    ]);
    if (sourceTeams.length === 0) return res.status(400).json({ error: "Source season has no teams" });

    const suffix = `_s${target.number}`;
    let teamsCreated = 0;
    const teamIdMap = new Map(); // old id -> new id
    for (const t of sourceTeams) {
      const newId = `${t.id}${suffix}`;
      teamIdMap.set(t.id, newId);
      const exists = await prisma.team.findUnique({ where: { id: newId } });
      if (exists) continue;
      await prisma.team.create({
        data: { id: newId, name: t.name, tier: t.tier, color: t.color, logoUrl: t.logoUrl, seasonId: target.id },
      });
      teamsCreated++;
    }

    let driversCreated = 0;
    for (const d of sourceDrivers) {
      const newId = `${d.id}${suffix}`;
      const newTeamId = teamIdMap.get(d.teamId);
      if (!newTeamId) continue; // driver of a team that wasn't cloned
      const exists = await prisma.driver.findUnique({ where: { id: newId } });
      if (exists) continue;
      await prisma.driver.create({
        data: {
          id: newId,
          name: d.name,
          discordName: d.discordName,
          teamId: newTeamId,
          tier: d.tier,
          isActive: d.isActive,
          seasonId: target.id,
          // Identity travels with the person; per-season stats start fresh.
          country: d.country,
          photoUrl: d.photoUrl,
          discordAvatar: d.discordAvatar,
          bio: d.bio,
          number: d.number,
          socials: d.socials,
        },
      });
      driversCreated++;
    }
    res.json({ ok: true, teamsCreated, driversCreated });
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
    const targetSeasonId = seasonId || (await resolveSeasonId(prisma, undefined, { includePrivate: true }));
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
    const logoUrl = `/api/uploads/teams/${filename}?v=${Date.now()}`;
    await prisma.team.update({ where: { id: team.id }, data: { logoUrl } });
    res.json({ ok: true, logoUrl });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// TRACK INFO — admin-editable fun facts + custom map image per circuit, layered
// on top of the computed track history (routes/tracks.js).
// ---------------------------------------------------------------------------
router.get("/tracks/:key/info", async (req, res, next) => {
  try {
    const key = safeTrackKey(req.params.key);
    if (!key) return res.status(400).json({ error: "Invalid track key" });
    res.json(await readTrackInfo(prisma, key));
  } catch (e) {
    next(e);
  }
});

router.put("/tracks/:key/info", async (req, res, next) => {
  try {
    const key = safeTrackKey(req.params.key);
    if (!key) return res.status(400).json({ error: "Invalid track key" });
    const saved = await writeTrackInfo(prisma, key, req.body?.content ?? req.body ?? {});
    res.json({ ok: true, content: saved });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/tracks/:key/map  (multipart: file=<image>) — custom track map.
router.post("/tracks/:key/map", upload.single("file"), async (req, res, next) => {
  try {
    const key = safeTrackKey(req.params.key);
    if (!key) return res.status(400).json({ error: "Invalid track key" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = LOGO_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Unsupported image type (use PNG, JPG, WEBP or SVG)" });
    mkdirSync(TRACKS_DIR, { recursive: true });
    const filename = `${key}${ext}`;
    writeFileSync(join(TRACKS_DIR, filename), req.file.buffer);
    const mapImageUrl = `/api/uploads/tracks/${filename}?v=${Date.now()}`;
    const current = await readTrackInfo(prisma, key);
    const saved = await writeTrackInfo(prisma, key, { ...current, mapImageUrl });
    res.json({ ok: true, mapImageUrl, content: saved });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/tracks/:key/map -> clear the custom map image.
router.delete("/tracks/:key/map", async (req, res, next) => {
  try {
    const key = safeTrackKey(req.params.key);
    if (!key) return res.status(400).json({ error: "Invalid track key" });
    const current = await readTrackInfo(prisma, key);
    const saved = await writeTrackInfo(prisma, key, { ...current, mapImageUrl: null });
    res.json({ ok: true, content: saved });
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

// --- Downloads (self-hosted AC resources) ---------------------------------
// The admin drops big files into backend/downloads/ on the server, then
// registers each here with its metadata. `diskFiles` surfaces what's actually
// on disk (registered or not) so the admin can pick a file and spot orphans.

// GET /api/admin/downloads -> { downloads: [...], folders: [...], diskFiles: [...] }
router.get("/downloads", async (req, res, next) => {
  try {
    const rows = await dbListDownloads(prisma);
    const downloads = rows.map((r) => {
      const st = statFile(r.fileName);
      return {
        ...shapeDownload(r),
        fileExists: r.externalUrl ? true : st.exists,
        size: st.size,
        sizeText: fmtSize(st.size),
      };
    });
    const registered = new Set(downloads.map((d) => d.fileName).filter(Boolean));
    const diskFiles = listDiskFiles().map((f) => ({ ...f, registered: registered.has(f.fileName) }));
    res.json({ downloads, folders: await dbListFolders(prisma), diskFiles });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/downloads/upload  (multipart: file=<any>)
// Streams a file straight into backend/downloads/ so it can be registered below.
// Nothing is added to the catalogue here — the admin still fills in the metadata.
router.post("/downloads/upload", downloadUpload.single("file"), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const size = req.file.size;
    res.json({ ok: true, fileName: req.file.filename, size, sizeText: fmtSize(size) });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/downloads -> create a catalogue entry.
router.post("/downloads", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: "Title is required" });
    if (!b.fileName && !b.externalUrl) return res.status(400).json({ error: "Pick a file or give an external link" });
    if (b.folderId && !(await dbGetFolder(prisma, b.folderId))) {
      return res.status(400).json({ error: "That folder no longer exists" });
    }
    const created = await dbCreateDownload(prisma, b);
    res.json({ ok: true, download: shapeDownload(created) });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/downloads/:id -> update (merges over the existing row).
router.patch("/downloads/:id", async (req, res, next) => {
  try {
    const existing = await dbGetDownload(prisma, req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const merged = { ...shapeDownload(existing), ...(req.body || {}) };
    const updated = await dbUpdateDownload(prisma, req.params.id, merged);
    res.json({ ok: true, download: shapeDownload(updated) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/downloads/:id -> remove the catalogue entry (leaves the
// file on disk untouched, so this is non-destructive to data).
router.delete("/downloads/:id", async (req, res, next) => {
  try {
    await dbDeleteDownload(prisma, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- Download folders -------------------------------------------------------
// Folders group the catalogue on the public page (Tracks, Cars, one folder per
// event...). Deleting a folder unfiles its downloads; it never deletes files.

router.post("/download-folders", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Folder name is required" });
    const folder = await dbCreateFolder(prisma, {
      name,
      description: String(req.body?.description || "").trim() || null,
      sortOrder: Number(req.body?.sortOrder) || 0,
    });
    res.json({ ok: true, folder });
  } catch (e) {
    next(e);
  }
});

router.patch("/download-folders/:id", async (req, res, next) => {
  try {
    const existing = await dbGetFolder(prisma, req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const merged = { ...existing, ...(req.body || {}) };
    merged.name = String(merged.name || "").trim();
    if (!merged.name) return res.status(400).json({ error: "Folder name is required" });
    merged.description = String(merged.description || "").trim() || null;
    res.json({ ok: true, folder: await dbUpdateFolder(prisma, req.params.id, merged) });
  } catch (e) {
    next(e);
  }
});

router.delete("/download-folders/:id", async (req, res, next) => {
  try {
    await dbDeleteFolder(prisma, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- Race Info page content -------------------------------------------------
// The public Race Info page (rule cards, sporting regulations, footnotes) is
// editable here; while nothing is saved the frontend shows its built-in
// defaults. PUT { content: null } clears the override.

router.get("/race-info", async (req, res, next) => {
  try {
    res.json({ content: await readRaceInfo(prisma) });
  } catch (e) {
    next(e);
  }
});

router.put("/race-info", async (req, res, next) => {
  try {
    const content = await writeRaceInfo(prisma, req.body?.content ?? null);
    res.json({ ok: true, content });
  } catch (e) {
    next(e);
  }
});

// --- Welcome-page FAQ -------------------------------------------------------
// The public newcomer FAQ is editable here; while nothing is saved the frontend
// shows its built-in, season-aware defaults. PUT { content: null } clears it.

router.get("/welcome-faq", async (req, res, next) => {
  try {
    res.json({ content: await readWelcomeFaq(prisma) });
  } catch (e) {
    next(e);
  }
});

router.put("/welcome-faq", async (req, res, next) => {
  try {
    const content = await writeWelcomeFaq(prisma, req.body?.content ?? null);
    res.json({ ok: true, content });
  } catch (e) {
    next(e);
  }
});

export default router;
