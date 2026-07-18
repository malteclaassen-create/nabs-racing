import { Router } from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import { writeFileSync, mkdirSync, appendFileSync, readFileSync, existsSync } from "fs";
import { join, extname, basename } from "path";
import prisma from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { parseAcRaceJson, parseAcQualiJson } from "../services/acJsonParser.js";
import { listRemoteResults, fetchRemoteResult } from "../services/emperorResults.js";
import { saveRaceResults } from "../services/raceWriter.js";
import { previewRaceImpact } from "../services/previewService.js";
import { getDriverRatings, RATING_DEFAULTS } from "../services/driverRatingsService.js";
import { getWebhookUrl, setWebhookUrl, getResultsWebhookUrl, setResultsWebhookUrl, postToResultsChannel, announce, syncRaceToDiscord } from "../services/discordService.js";
import { buildResultsPost } from "../services/resultsPostService.js";
import { resolveSeasonId, invalidatePrivateSeasonCache } from "../services/seasonService.js";
import { checkSeasonIntegrity } from "../services/integrityService.js";
import { createBackup, tryCreateBackup, listBackups, createFullBackupZip } from "../services/backupService.js";
import { SOCIAL_KEYS, readSocialLinks, readLiveLinks, LIVE_LINK_DEFAULTS } from "./settings.js";
import { parseFormatNumber } from "../lib/raceFormat.js";
import { RACE_TYPES, writeRaceType } from "../lib/raceTypes.js";
import { writeSeasonHero, writeSeasonCar } from "../lib/seasonHero.js";
import { DRIVER_ROLES, writeDriverRole } from "../lib/driverRoles.js";
import { getTrafficStats } from "../lib/traffic.js";
import {
  dbListDownloads, dbGetDownload, dbCreateDownload, dbUpdateDownload, dbDeleteDownload, ensureReplaysFolder,
  dbListFolders, dbGetFolder, dbCreateFolder, dbUpdateFolder, dbDeleteFolder,
  listDiskFiles, statFile, fmtSize, shapeDownload, ensureDownloadsDir, DOWNLOADS_DIR,
} from "../lib/downloads.js";
import { stashIncoming, archiveCommitted } from "../lib/resultsArchive.js";
import { readRatingWeights, writeRatingWeights } from "../lib/ratingWeights.js";
import { readTrackInfo, writeTrackInfo } from "../lib/trackInfo.js";
import { readTrackCountries, writeTrackCountry, seedRaceCountry, staticCountryFor } from "../lib/raceCountries.js";
import { normKey } from "../lib/trackKeys.js";
import { readRaceInfo, writeRaceInfo } from "../lib/raceInfo.js";
import { readWelcomeFaq, writeWelcomeFaq } from "../lib/welcomeFaq.js";
import { dbListMembers, dbGetMember, dbSetBanned, shapeMember } from "../lib/members.js";
import { dbLinkDrivers, dbUnlinkDriver, dbListPersons, getLinkedDriverIds, getPersonGroups } from "../lib/persons.js";
import {
  dbListSeries, dbCreateSeries, dbUpdateSeries, dbActivateSeries, dbDeleteSeries,
  getSeriesById, resolveSeries, seasonIdsOfSeries, seasonSeriesMap, setSeasonSeries,
  writeSeriesLogo,
} from "../lib/series.js";
import { getAdminDiscordIds, setDiscordAdmin } from "../lib/adminUsers.js";
import {
  notifyResultsSaved, notifyDownloadAdded, notifySeatFilled, notifyCardUnlocksForSeason,
  readNotifySettings, writeNotifySettings, NOTIFY_DEFAULTS, REMINDER_OFFSETS,
  sendAttendancePing,
} from "../lib/notifications.js";
import { UPLOADS_DIR, LOGS_DIR } from "../lib/dataDirs.js";
import { LIVE_SERVERS, DEFAULT_SERVER_KEY, readLiveServerMap, writeLiveServerMap } from "../lib/liveServers.js";

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
const SEASONS_DIR = join(UPLOADS_DIR, "seasons");
const SERIES_DIR = join(UPLOADS_DIR, "series");
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
    const seasonId = await resolveSeasonId(prisma, req.query.season, { includePrivate: true, series: req.query.series });
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

// Enrich a season roster with each driver's stored Steam GUID so the parser can
// do GUID-first matching. Read raw: the running dev server holds the generated
// client lock, so `findMany` may not expose Driver.steamId until a restart, but
// the column exists (migration + ensureAppSchema). Best-effort — on a fresh DB
// without the column yet, matching simply falls back to names.
async function attachSteamIds(drivers) {
  if (!drivers.length) return drivers;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "steamId" FROM "Driver" WHERE "id" IN (${drivers.map(() => "?").join(", ")})`,
      ...drivers.map((d) => d.id)
    );
    const byId = new Map(rows.map((r) => [r.id, r.steamId ?? null]));
    for (const d of drivers) d.steamId = byId.get(d.id) ?? null;
  } catch {
    for (const d of drivers) d.steamId = d.steamId ?? null;
  }
  return drivers;
}

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
    // the DB, same-named drivers of old seasons must never be suggested. The
    // series param pins the lookup to the series the admin is editing, so an
    // import can never silently land in the wrong series.
    const seasonId = await resolveSeasonId(prisma, req.query.season, { includePrivate: true, series: req.query.series });
    const drivers = await attachSteamIds(await prisma.driver.findMany({ where: { seasonId }, orderBy: { name: "asc" } }));
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
    const { id, season, series } = req.body || {};
    if (!id || !/^[A-Za-z0-9_]+$/.test(id)) return res.status(400).json({ error: "Valid result id required" });
    const json = await fetchRemoteResult(id);
    const seasonId = await resolveSeasonId(prisma, season, { includePrivate: true, series });
    const drivers = await attachSteamIds(await prisma.driver.findMany({ where: { seasonId }, orderBy: { name: "asc" } }));
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
    const { number, track, date, results, seasonId, archiveKey, raceId } = req.body || {};
    if (!Array.isArray(results)) {
      return res.status(400).json({ error: "results[] required" });
    }
    // Target: a round NUMBER (championship, may be created on the fly) or an
    // EXISTING race by id — that's how training/special sessions get their
    // results (they carry no round number). isSpecialEvent stays untouched, so
    // a training race can never leak into the standings via an import.
    if (!raceId && !number) {
      return res.status(400).json({ error: "number (championship round) or raceId (training/event) required" });
    }

    // Explicit seasonId wins; the fallback resolves the active season of the
    // series the admin is editing (never a foreign series' active season).
    const targetSeasonId =
      seasonId || (await resolveSeasonId(prisma, undefined, { includePrivate: true, series: req.body?.series }));
    let race = raceId
      ? await prisma.race.findFirst({
          where: { id: String(raceId) },
          include: { _count: { select: { results: true } } },
        })
      : await prisma.race.findFirst({
          where: { number: Number(number), seasonId: targetSeasonId },
          include: { _count: { select: { results: true } } },
        });
    if (raceId && !race) return res.status(404).json({ error: "Race not found" });

    // Overwrite guard: committing over a round that already has stored results
    // replaces them entirely. Require an explicit confirmation from the UI.
    if (race && race._count.results > 0 && !req.body.overwrite) {
      return res.status(409).json({
        error: `${race.number != null ? `Round ${race.number}` : race.track} already has ${race._count.results} stored results. Confirm to overwrite them.`,
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
      await seedRaceCountry(prisma, race.id, race.track);
    } else {
      const renamed = track && track !== race.track;
      race = await prisma.race.update({
        where: { id: race.id },
        data: { track: track || race.track, date: date ? new Date(date) : race.date },
      });
      if (renamed) await seedRaceCountry(prisma, race.id, race.track);
    }

    // Automatic pre-save snapshot: one file-copy away from undoing a mistake.
    await tryCreateBackup(prisma, `before-import-${race.number != null ? `r${race.number}` : "training"}`);
    const saveSummary = await saveRaceResults(prisma, race.id, results);
    // Bell notification (deduped per race, so re-imports stay silent).
    if (results.length) notifyResultsSaved(prisma, race);
    // New results can tip a driver over a card-unlock threshold (and the finale
    // seals titles) — reconcile the season's linked drivers' bells.
    if (results.length) notifyCardUnlocksForSeason(prisma, race.seasonId);
    // Move the raw JSON into its season folder so this round's telemetry can be
    // recomputed later. Best-effort: never fails the commit.
    if (archiveKey) {
      const season = await prisma.season.findUnique({ where: { id: race.seasonId || targetSeasonId } });
      archiveCommitted(archiveKey, {
        seasonNumber: season?.number ?? null,
        raceNumber: race.number,
        track: race.track,
      });
    }
    // Steam GUID capture is best-effort; any confirmed mapping that would have
    // changed an already-stored steamId (mis-map or shared account) is reported
    // here rather than silently overwritten, so the admin can look into it.
    res.json({
      ok: true,
      raceId: race.id,
      number: race.number,
      steamIdConflicts: saveSummary?.steamIdConflicts || [],
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/races/:id/quali  (multipart: file=<AC QUALIFY json>)
// Attaches a qualifying classification to an EXISTING race: parses the QUALIFY
// JSON, auto-matches entrants against the race's season roster (Steam GUID
// first, fuzzy name as fallback), stores the classification as a blob on the
// race and each matched driver's best lap in RaceResult.qualiTimeMs. Unmatched
// entrants stay in the classification under their AC name (they may have
// qualified but never started). Re-uploading replaces the previous quali.
router.post("/races/:id/quali", upload.single("file"), async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });

    let json;
    if (req.file) {
      json = JSON.parse(req.file.buffer.toString("utf-8"));
    } else if (req.body && req.body.remoteId) {
      // Pull the QUALIFY session straight from the AC Server Manager (same
      // source as the remote race import).
      if (!/^[A-Za-z0-9_]+$/.test(String(req.body.remoteId))) {
        return res.status(400).json({ error: "Valid result id required" });
      }
      json = await fetchRemoteResult(String(req.body.remoteId));
    } else if (req.body && req.body.json) {
      json = typeof req.body.json === "string" ? JSON.parse(req.body.json) : req.body.json;
    } else {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const drivers = await attachSteamIds(
      await prisma.driver.findMany({ where: { seasonId: race.seasonId }, orderBy: { name: "asc" } })
    );
    const parsed = parseAcQualiJson(json, drivers);

    const nameOf = new Map(drivers.map((d) => [d.id, d.name]));
    // The three sector times of each entrant's BEST lap, looked up in the
    // session's raw lap list (the classification itself only carries the
    // total). Keyed by AC name; missing/imcomplete laps simply have none.
    const sectorsByName = new Map();
    for (const r of json.Result || []) {
      if (!r?.DriverGuid || !Number.isFinite(r.BestLap) || r.BestLap <= 0) continue;
      const lap = (json.Laps || []).find(
        (l) =>
          l.DriverGuid === r.DriverGuid &&
          l.LapTime === r.BestLap &&
          Array.isArray(l.Sectors) &&
          l.Sectors.length === 3 &&
          l.Sectors.every((s) => s > 0)
      );
      if (lap) sectorsByName.set(r.DriverName, lap.Sectors);
    }
    const blob = {
      track: parsed.track ?? null,
      date: parsed.date ?? null,
      entries: parsed.entries.map((e) => ({
        position: e.position,
        driverId: e.suggestedDriverId,
        // Snapshot the matched roster name (or the raw AC name) so the tab can
        // render even if the roster row is renamed/removed later.
        name: e.suggestedDriverId ? nameOf.get(e.suggestedDriverId) : e.acDriverName,
        acDriverName: e.acDriverName,
        bestLapMs: e.bestLapMs,
        sectors: sectorsByName.get(e.acDriverName) ?? null,
        carModel: e.carModel,
        matchedBy: e.matchedBy,
      })),
    };

    await prisma.$executeRawUnsafe(
      `UPDATE "Race" SET "qualiJson" = ? WHERE "id" = ?`,
      JSON.stringify(blob),
      race.id
    );

    // Best-effort: matched entrants who also have a stored race result get
    // their qualiTimeMs set (feeds the ratings' gap-to-pole later). Cleared
    // first so a re-upload never leaves stale laps behind.
    try {
      await prisma.$executeRawUnsafe(`UPDATE "RaceResult" SET "qualiTimeMs" = NULL WHERE "raceId" = ?`, race.id);
      for (const e of blob.entries) {
        if (e.driverId && e.bestLapMs != null) {
          await prisma.$executeRawUnsafe(
            `UPDATE "RaceResult" SET "qualiTimeMs" = ? WHERE "raceId" = ? AND "driverId" = ?`,
            e.bestLapMs,
            race.id,
            e.driverId
          );
        }
      }
    } catch (e) {
      console.error("qualiTimeMs write skipped:", e.message);
    }

    res.json({
      ok: true,
      raceId: race.id,
      entries: blob.entries.length,
      matched: blob.entries.filter((e) => e.driverId).length,
      unmatched: blob.entries.filter((e) => !e.driverId).map((e) => e.acDriverName),
    });
  } catch (e) {
    if (e instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON file" });
    if (e.message && e.message.startsWith("Invalid AC")) return res.status(400).json({ error: e.message });
    next(e);
  }
});

// DELETE /api/admin/races/:id/quali — remove a race's qualifying classification.
router.delete("/races/:id/quali", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    await prisma.$executeRawUnsafe(`UPDATE "Race" SET "qualiJson" = NULL WHERE "id" = ?`, race.id);
    await prisma
      .$executeRawUnsafe(`UPDATE "RaceResult" SET "qualiTimeMs" = NULL WHERE "raceId" = ?`, race.id)
      .catch(() => {});
    res.json({ ok: true });
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
    const seasonId = await resolveSeasonId(prisma, season, { includePrivate: true, series: req.body?.series });
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
// Body: { weights?: { band, bands, window, exp, rtg, pac, rac, aha }, season? }
// Returns the driver ratings computed with the supplied weights (or the defaults
// when omitted), plus the defaults so the tuning panel can initialise itself.
// Read-only — nothing is persisted.
router.post("/ratings/preview", async (req, res, next) => {
  try {
    const { weights, season } = req.body || {};
    const seasonId = await resolveSeasonId(prisma, season, { includePrivate: true, series: req.body?.series });
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
// NOTIFICATION SETTINGS (the nav-bar bell)
// League-wide: which events notify, who hears about seat offers, and when the
// race reminders go out. One Setting blob — see lib/notifications.js.
// ---------------------------------------------------------------------------

// GET /api/admin/notification-settings -> { settings, defaults, reminderOffsets }
router.get("/notification-settings", async (req, res, next) => {
  try {
    res.json({
      settings: await readNotifySettings(prisma),
      defaults: NOTIFY_DEFAULTS,
      reminderOffsets: REMINDER_OFFSETS,
    });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/notification-settings  { settings } -> sanitized + saved.
router.put("/notification-settings", async (req, res, next) => {
  try {
    res.json({ ok: true, settings: await writeNotifySettings(prisma, req.body?.settings) });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/races/:id/attendance-ping -> broadcast a manual "please
// answer the attendance" nudge for one upcoming race. Repeatable on purpose.
router.post("/races/:id/attendance-ping", async (req, res) => {
  try {
    await sendAttendancePing(prisma, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Failed to send" });
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
// Works on completed races too — this is how the admin corrects the takeover
// record after the fact (the driver-facing pick locks at race completion).
router.post("/market/:offerId/assign", async (req, res, next) => {
  try {
    const offer = await prisma.seatOffer.findUnique({
      where: { id: req.params.offerId },
      include: { race: { select: { seasonId: true } } },
    });
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
      // A seat is filled from the RACE's season's reserve pool — a same-named
      // row from another season would poison the import pre-fill ids.
      if (offer.race?.seasonId && reserve.seasonId !== offer.race.seasonId) {
        return res.status(400).json({ error: "That driver belongs to another season's roster" });
      }
    }
    await prisma.seatOffer.update({
      where: { id: offer.id },
      data: { filledById: pickId, status: pickId ? "FILLED" : "OPEN" },
    });
    // Tell the picked reserve personally (needs their linked Discord id).
    if (pickId) {
      const reserve = await prisma.driver.findUnique({ where: { id: pickId } });
      notifySeatFilled(prisma, { offerId: offer.id, raceId: offer.raceId, reserve });
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/market/history?season=N -> every seat offer of the season,
// grouped per race (completed rounds included) — the after-the-fact record of
// who stood in for whom. `confirmedInResult` says whether the takeover is
// actually reflected in the stored race result (the authoritative data):
// true/false once the race has results, null while it hasn't run.
router.get("/market/history", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, { includePrivate: true, series: req.query.series });
    const offers = await prisma.seatOffer.findMany({
      where: { race: { seasonId } },
      include: {
        race: { include: { _count: { select: { results: true } } } },
        team: true,
        driver: true,
        filledBy: true,
        interests: { include: { driver: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    // One results lookup for all filled offers, to flag confirmed takeovers.
    const filled = offers.filter((o) => o.filledById);
    const results = filled.length
      ? await prisma.raceResult.findMany({
          where: { OR: filled.map((o) => ({ raceId: o.raceId, driverId: o.filledById })) },
          select: { raceId: true, driverId: true, subForTeamId: true },
        })
      : [];
    const resultKey = new Map(results.map((r) => [`${r.raceId}:${r.driverId}`, r]));

    const byRace = new Map();
    for (const o of offers) {
      if (!byRace.has(o.raceId)) {
        byRace.set(o.raceId, {
          id: o.race.id,
          number: o.race.number,
          track: o.race.track,
          date: o.race.date,
          isCompleted: o.race.isCompleted,
          hasResults: o.race._count.results > 0,
          offers: [],
        });
      }
      const result = o.filledById ? resultKey.get(`${o.raceId}:${o.filledById}`) : null;
      byRace.get(o.raceId).offers.push({
        id: o.id,
        status: o.status,
        createdAt: o.createdAt,
        team: { id: o.team.id, name: o.team.name, color: o.team.color },
        offeredBy: { driverId: o.driver.id, name: o.driver.name },
        filledBy: o.filledBy ? { driverId: o.filledBy.id, name: o.filledBy.name } : null,
        interests: o.interests.map((i) => i.driver.name),
        confirmedInResult:
          o.race._count.results > 0 && o.filledById
            ? !!result && result.subForTeamId === o.teamId
            : null,
      });
    }
    const races = [...byRace.values()].sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
    res.json({ races });
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
// TRAFFIC (admin Traffic tab) — the self-hosted visit counter's numbers.
// ---------------------------------------------------------------------------
router.get("/traffic", async (req, res, next) => {
  try {
    res.json(await getTrafficStats(prisma));
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
// LIVE TIMING PAGE LINKS (external "Full live timing" + "Join in Content Manager")
// ---------------------------------------------------------------------------

// GET /api/admin/live-links -> the raw stored values plus the effective ones, so
// the editor can show the live-timing default it falls back to when left blank.
router.get("/live-links", async (req, res, next) => {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: ["live_timing_url", "live_cm_join_url"] } },
    });
    const get = (k) => rows.find((r) => r.key === k)?.value || "";
    res.json({
      liveTimingUrl: get("live_timing_url"),
      cmJoinUrl: get("live_cm_join_url"),
      defaults: LIVE_LINK_DEFAULTS,
    });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/live-links  { liveTimingUrl, cmJoinUrl }
// Empty live-timing URL falls back to the server-manager default; empty CM link
// hides that button. Bare values get https:// prefixed (CM's acstuff.ru scheme
// links are left untouched).
router.put("/live-links", async (req, res, next) => {
  try {
    const body = req.body || {};
    const clean = (v) => {
      let val = String(v ?? "").trim();
      if (val && !/^[a-z]+:\/\//i.test(val)) val = `https://${val}`;
      return val;
    };
    const map = { live_timing_url: clean(body.liveTimingUrl), live_cm_join_url: clean(body.cmJoinUrl) };
    for (const [key, value] of Object.entries(map)) {
      await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    res.json(await readLiveLinks(prisma));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// LIVE RACE SERVERS (which server each series' live page follows)
// ---------------------------------------------------------------------------

// GET /api/admin/live-servers -> the configured race servers, every series,
// and the current series → server assignment (missing entry = first server).
router.get("/live-servers", async (req, res, next) => {
  try {
    const [series, map] = await Promise.all([dbListSeries(prisma), readLiveServerMap(prisma)]);
    res.json({
      servers: LIVE_SERVERS.map((s) => ({ key: s.key, name: s.name, origin: s.origin })),
      defaultKey: DEFAULT_SERVER_KEY,
      series: series.map((s) => ({ slug: s.slug, name: s.name })),
      map,
    });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/live-servers  { map: { seriesSlug: serverKey } }
// Takes effect for newly opened live pages/sockets (a viewer mid-session picks
// it up on their next reconnect or reload).
router.put("/live-servers", async (req, res, next) => {
  try {
    const map = await writeLiveServerMap(prisma, req.body?.map || {});
    res.json({ ok: true, map });
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
    // Bell notification (deduped per race: only the FIRST save of this round
    // pings the members, edits stay silent).
    if (results.length) notifyResultsSaved(prisma, race);
    if (results.length) notifyCardUnlocksForSeason(prisma, race.seasonId);
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
    // Default to the season the chosen team belongs to (or the active season
    // of the series the admin is editing).
    let resolvedSeasonId = seasonId;
    if (!resolvedSeasonId) {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      resolvedSeasonId =
        team?.seasonId ||
        (await resolveSeasonId(prisma, undefined, { includePrivate: true, series: req.body?.series }));
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

// GET /api/admin/driver-db?series= — the series' all-time driver DATABASE:
// one entry per PERSON across every season (person links first, same name as
// fallback), with identity, last team/season and career starts. Powers the
// roster builder's search fields: build a new season by picking people from
// here instead of cloning a whole roster of maybe-no-shows.
router.get("/driver-db", async (req, res, next) => {
  try {
    const series = await resolveSeries(prisma, req.query.series, { includePrivate: true });
    if (!series) return res.status(404).json({ error: "Series not found" });
    // seasonIdsOfSeries returns {id, number} rows — we only need the ids here.
    const seasonIds = (await seasonIdsOfSeries(prisma, series.id)).map((s) => s.id ?? s);
    const [drivers, persons] = await Promise.all([
      prisma.driver.findMany({
        where: { seasonId: { in: seasonIds } },
        include: { team: { select: { name: true } }, season: { select: { number: true } } },
      }),
      getPersonGroups(prisma),
    ]);
    // steamId is a raw column the generated client may not know — attach raw.
    await attachSteamIds(drivers);
    // Career starts per row (DNS excluded) — summed per person below.
    const startRows = await prisma.raceResult.groupBy({
      by: ["driverId"],
      where: { driverId: { in: drivers.map((d) => d.id) }, status: { not: "DNS" } },
      _count: { driverId: true },
    });
    const startsById = new Map(startRows.map((r) => [r.driverId, r._count.driverId]));

    const groups = new Map(); // person key -> rows (newest season first)
    for (const d of drivers) {
      const key = persons.byDriver.get(d.id) || `name:${d.name.trim().toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }
    const entries = [...groups.entries()].map(([key, rows]) => {
      rows.sort((a, b) => (b.season?.number ?? 0) - (a.season?.number ?? 0));
      const newest = rows[0];
      return {
        key,
        name: newest.name,
        country: newest.country || null,
        photoUrl: newest.photoUrl || newest.discordAvatar || null,
        steamId: rows.find((r) => r.steamId)?.steamId || null,
        discordUserId: rows.find((r) => r.discordUserId)?.discordUserId || null,
        sourceDriverId: newest.id,
        lastSeasonNumber: newest.season?.number ?? null,
        lastTeamName: newest.team?.name ?? null,
        starts: rows.reduce((s, r) => s + (startsById.get(r.id) || 0), 0),
        // Which seasons the person already has a row in (the builder greys
        // those out for the season being edited).
        rows: rows.map((r) => ({ seasonNumber: r.season?.number ?? null, driverId: r.id })),
      };
    });
    entries.sort((a, b) => b.starts - a.starts || a.name.localeCompare(b.name));
    res.json({ entries });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/drivers/from-db { sourceDriverId, teamId } — put a person
// from the database into a team of the team's season: a fresh row cloned from
// their newest identity (photo, flag, number, Steam ID for import matching),
// person-linked to the source so career stats and seals carry over. The
// Discord id is NOT copied (unique across seasons; it moves on login or via
// the Drivers tab, same as always).
router.post("/drivers/from-db", async (req, res, next) => {
  try {
    const { sourceDriverId, teamId } = req.body || {};
    if (!sourceDriverId || !teamId) return res.status(400).json({ error: "sourceDriverId and teamId required" });
    const [source, team] = await Promise.all([
      prisma.driver.findUnique({ where: { id: sourceDriverId } }),
      prisma.team.findUnique({ where: { id: teamId }, include: { season: { select: { id: true, number: true } } } }),
    ]);
    if (!source) return res.status(404).json({ error: "Source driver not found" });
    if (!team?.season) return res.status(404).json({ error: "Team not found" });
    await attachSteamIds([source]);

    // Already on this season's roster (any linked row, or a same-name row)?
    const linked = await getLinkedDriverIds(prisma, source.id);
    const clash = await prisma.driver.findFirst({
      where: {
        seasonId: team.season.id,
        OR: [{ id: { in: linked } }, { name: { equals: source.name } }],
      },
      include: { team: { select: { name: true } } },
    });
    if (clash) {
      return res.status(409).json({ error: `${clash.name} is already on this season's roster (${clash.team?.name || "no team"}).` });
    }

    let id = `${source.id.replace(/_s\d+$/, "")}_s${team.season.number}`;
    if (await prisma.driver.findUnique({ where: { id } })) id = await uniqueDriverId(source.name);
    const driver = await prisma.driver.create({
      data: {
        id,
        name: source.name,
        discordName: source.discordName,
        teamId: team.id,
        tier: team.tier,
        isActive: true,
        seasonId: team.season.id,
        country: source.country,
        photoUrl: source.photoUrl,
        discordAvatar: source.discordAvatar,
        bio: source.bio,
        number: source.number,
        socials: source.socials,
      },
    });
    // Steam ID for import auto-matching — a raw column (ensureAppSchema), so
    // it's written raw after the create. The source row may predate GUID
    // capture, so ANY of the person's linked rows can donate theirs. A
    // same-season duplicate just stays empty (the import captures it again).
    let steamId = source.steamId || null;
    if (!steamId && linked.length) {
      const rows = await prisma
        .$queryRawUnsafe(
          `SELECT "steamId" FROM "Driver" WHERE "id" IN (${linked.map(() => "?").join(",")}) AND "steamId" IS NOT NULL LIMIT 1`,
          ...linked
        )
        .catch(() => []);
      steamId = rows[0]?.steamId || null;
    }
    // Unlinked archive rows of the same name can donate too (the database
    // groups by name when no person link exists yet).
    if (!steamId) {
      const rows = await prisma
        .$queryRawUnsafe(
          `SELECT "steamId" FROM "Driver" WHERE lower("name") = lower(?) AND "steamId" IS NOT NULL LIMIT 1`,
          source.name
        )
        .catch(() => []);
      steamId = rows[0]?.steamId || null;
    }
    if (steamId) {
      await prisma
        .$executeRawUnsafe(`UPDATE "Driver" SET "steamId" = ? WHERE "id" = ?`, steamId, driver.id)
        .catch(() => {});
    }
    await dbLinkDrivers(prisma, [source.id, driver.id]);
    res.status(201).json({ ...driver, teamName: team.name });
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "A driver with this Steam ID already exists in that season." });
    next(e);
  }
});

router.put("/drivers/:id", async (req, res, next) => {
  try {
    const { name, discordName, teamId, tier, isActive, photoUrl, discordUserId, role, hideFromStandings } = req.body || {};
    // Special league role ('safety' = safety car driver, "" clears). Raw-SQL
    // column, so it's written after the prisma update below.
    if (role !== undefined && role !== "" && role !== null && !DRIVER_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be empty or one of: ${DRIVER_ROLES.join(", ")}` });
    }
    const data = {};
    if (name !== undefined) data.name = name;
    if (discordName !== undefined) data.discordName = discordName;
    if (teamId !== undefined) data.teamId = teamId;
    if (tier !== undefined) data.tier = Number(tier);
    if (isActive !== undefined) data.isActive = isActive;
    if (photoUrl !== undefined) data.photoUrl = photoUrl || null;
    // The driver's Discord user id (the long number). Login links by exact id,
    // and the results post pings <@id> — so pre-filling it here gives drivers
    // who never signed in a working login link AND real mentions. "" clears.
    //
    // The id is unique across ALL seasons (it sits on one row per person and
    // moves on login). So when another row already holds it: if that row is
    // person-linked to this driver (same human, e.g. their last-season row),
    // MOVE the id over — that's the season-start case and always what the
    // admin means. Any other holder is a real conflict and gets named.
    if (discordUserId !== undefined) {
      const v = String(discordUserId || "").trim();
      if (v && !/^\d{15,21}$/.test(v)) {
        return res.status(400).json({ error: "A Discord user ID is a 17-20 digit number (Discord: enable Developer Mode, right-click the user, Copy User ID)" });
      }
      if (v) {
        const holder = await prisma.driver.findUnique({
          where: { discordUserId: v },
          include: { season: { select: { name: true } } },
        });
        if (holder && holder.id !== req.params.id) {
          const samePerson = (await getLinkedDriverIds(prisma, req.params.id)).includes(holder.id);
          if (!samePerson) {
            return res.status(409).json({
              error:
                `That Discord ID is already on ${holder.name}` +
                (holder.season?.name ? ` (${holder.season.name})` : "") +
                ". If that's the same person, link the two entries under Members → Same person across seasons first; saving here then moves the ID over.",
            });
          }
          await prisma.driver.update({ where: { id: holder.id }, data: { discordUserId: null } });
        }
      }
      data.discordUserId = v || null;
    }
    // A role-only change arrives with an empty prisma patch — just read the row.
    const driver = Object.keys(data).length
      ? await prisma.driver.update({ where: { id: req.params.id }, data })
      : await prisma.driver.findUnique({ where: { id: req.params.id } });
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    // Saving a Discord ID makes it count in EVERY season: the ID itself lives
    // on this one row (unique), but all of the person's other season rows are
    // person-linked automatically — same Steam ID or same name, as long as no
    // OTHER Discord account has claimed them. Login handover, results-post
    // mentions and career stats then follow the person everywhere without
    // re-entering the ID per season. Best-effort: a linking hiccup must never
    // fail the save itself.
    if (data.discordUserId) {
      try {
        const own = [driver];
        await attachSteamIds(own);
        const steamId = own[0].steamId || null;
        const twins = await prisma.$queryRawUnsafe(
          `SELECT "id", "discordUserId" FROM "Driver"
            WHERE "id" != ?
              AND (lower("name") = lower(?)${steamId ? ` OR "steamId" = ?` : ""})`,
          driver.id,
          driver.name,
          ...(steamId ? [steamId] : [])
        );
        const already = new Set(await getLinkedDriverIds(prisma, driver.id));
        const fresh = twins
          .filter((t) => !already.has(t.id) && (!t.discordUserId || t.discordUserId === data.discordUserId))
          .map((t) => t.id);
        if (fresh.length) await dbLinkDrivers(prisma, [driver.id, ...fresh]);
      } catch {
        /* best-effort */
      }
    }
    if (role !== undefined) {
      driver.role = await writeDriverRole(prisma, driver.id, role);
    }
    // Hide from the public driver standings (raw-SQL column). An explicit value
    // wins; reactivating a driver clears the flag so nobody ends up active but
    // invisible.
    const hideVal =
      hideFromStandings !== undefined ? (hideFromStandings ? 1 : 0) : isActive === true ? 0 : null;
    if (hideVal !== null) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Driver" SET "hideFromStandings" = ? WHERE "id" = ?`,
        hideVal,
        driver.id
      );
      driver.hideFromStandings = !!hideVal;
    }
    res.json(driver);
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ error: "Driver not found" });
    if (e.code === "P2002") return res.status(409).json({ error: "That Discord ID is already linked to another driver" });
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
    const [rows, drivers, activeSeasons, primarySeason, adminIds] = await Promise.all([
      dbListMembers(prisma),
      prisma.driver.findMany({ include: { team: true, season: true } }),
      // One active season PER SERIES since the series model — a roster row on
      // any of them counts as "current" here.
      prisma.season.findMany({ where: { isActive: true }, select: { id: true } }),
      // The primary series' active season, preferred when a person has current
      // rows in several series.
      resolveSeasonId(prisma, undefined, { includePrivate: true }).then((id) =>
        id ? { id } : null
      ),
      getAdminDiscordIds(prisma),
    ]);
    const activeIds = new Set(activeSeasons.map((s) => s.id));
    const shapeDriver = (d) =>
      d && {
        id: d.id,
        name: d.name,
        discordName: d.discordName,
        tier: d.tier,
        team: d.team ? { id: d.team.id, name: d.team.name, color: d.team.color } : null,
        seasonId: d.seasonId,
        seasonName: d.season?.name || null,
        isActiveSeason: activeIds.has(d.seasonId),
      };
    const members = rows.map((r) => {
      const m = shapeMember(r);
      const linked = drivers.filter((d) => d.discordUserId === m.discordId);
      // Prefer the primary series' active row, then any active season's row,
      // else the most recent season's.
      const driver =
        linked.find((d) => primarySeason && d.seasonId === primarySeason.id) ||
        linked.find((d) => activeIds.has(d.seasonId)) ||
        linked.sort((a, b) => (b.season?.number ?? 0) - (a.season?.number ?? 0))[0] ||
        null;
      return { ...m, driver: shapeDriver(driver), isAdmin: adminIds.has(String(m.discordId)) };
    });
    // Drivers an account can be linked to: no stored Discord ID, OR an ID that
    // no known login account carries — i.e. an admin-entered ID that might be
    // a typo. Linking such a driver simply replaces the wrong ID with the real
    // one, so a mistyped entry is one click away from being corrected once the
    // person actually logs in. Every series' active roster is listed.
    const knownIds = new Set(rows.map((r) => String(r.discordId)));
    const unclaimed = drivers
      .filter(
        (d) =>
          activeIds.has(d.seasonId) &&
          (!d.discordUserId || !knownIds.has(String(d.discordUserId)))
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({ ...shapeDriver(d), preEnteredId: d.discordUserId || null }));
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

// Clusters of driver rows that plausibly belong to one person. Rows connect
// when they share a normalized display name OR Discord handle — the handle
// usually survives a rename ("mtimmis" replaced "Timmy 'Bunker' Gilmore" as
// display name, but the Discord name stayed), so photos and the current name
// can follow the person into old seasons without manual work. Already-linked
// rows keep their group together, letting a newly matched old row attach to
// the group it belongs to. Returns { linkable, ambiguous }: a cluster is
// ambiguous when it would merge two DIFFERENT existing groups (an admin may
// have split those on purpose), or when one season holds two rows that aren't
// already linked to each other — nobody can tell which row is the person.
// Those stay manual jobs.
function buildPersonClusters(drivers, groups) {
  const parent = new Map(drivers.map((d) => [d.id, d.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const firstByKey = new Map();
  for (const d of drivers) {
    for (const key of [personNorm(d.name), personNorm(d.discordName)]) {
      if (!key) continue;
      if (firstByKey.has(key)) union(d.id, firstByKey.get(key));
      else firstByKey.set(key, d.id);
    }
  }
  const personOf = new Map();
  for (const g of groups) {
    const present = g.driverIds.filter((id) => parent.has(id));
    for (const id of present) personOf.set(id, g.personId);
    for (let i = 1; i < present.length; i++) union(present[0], present[i]);
  }
  const byRoot = new Map();
  for (const d of drivers) {
    const r = find(d.id);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(d);
  }
  const linkable = [];
  const ambiguous = [];
  for (const rows of byRoot.values()) {
    if (rows.length < 2) continue;
    const personIds = new Set(rows.map((d) => personOf.get(d.id)).filter(Boolean));
    const hasUnlinked = rows.some((d) => !personOf.get(d.id));
    if (!hasUnlinked && personIds.size <= 1) continue; // fully linked already
    // Two rows in ONE season with nothing else is the deliberate same-season
    // merge feature — that call stays with the admin.
    if (new Set(rows.map((d) => d.seasonId)).size < 2) continue;
    let amb = personIds.size > 1;
    if (!amb) {
      const bySeason = new Map();
      for (const d of rows) {
        if (!bySeason.has(d.seasonId)) bySeason.set(d.seasonId, []);
        bySeason.get(d.seasonId).push(d);
      }
      for (const seasonRows of bySeason.values()) {
        if (seasonRows.length < 2) continue;
        const pids = new Set(seasonRows.map((d) => personOf.get(d.id) || null));
        if (pids.size > 1 || pids.has(null)) {
          amb = true;
          break;
        }
      }
    }
    (amb ? ambiguous : linkable).push(rows);
  }
  return { linkable, ambiguous };
}

// GET /api/admin/persons -> { persons: [{personId, drivers:[...]}], candidates }
// candidates = clusters sharing a display name or Discord handle across
// seasons that aren't fully linked yet.
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
    const persons = groups
      .map((g) => ({
        personId: g.personId,
        drivers: g.driverIds.map((id) => shape(byId.get(id))).filter(Boolean).sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0)),
      }))
      .filter((p) => p.drivers.length);

    // Suggestions: clusters that share a display name OR Discord handle across
    // seasons and aren't fully linked yet (see buildPersonClusters). A cluster
    // may include an existing group — linking it pulls the new rows in.
    // Ambiguous clusters are listed too (flagged), so the admin can settle
    // them by hand; the auto-link button skips them.
    const { linkable, ambiguous } = buildPersonClusters(drivers, groups);
    const shapeCluster = (rows, amb) => ({
      ambiguous: amb,
      drivers: rows.map(shape).sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0)),
    });
    const candidates = [
      ...linkable.map((rows) => shapeCluster(rows, false)),
      ...ambiguous.map((rows) => shapeCluster(rows, true)),
    ];
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
// Links every candidate cluster the GET above lists, in one go — rows that
// share a display name OR Discord handle across seasons (see
// buildPersonClusters). Ambiguous clusters (a duplicate row inside one season,
// or two existing groups that would merge) stay manual jobs.
router.post("/persons/link-auto", async (req, res, next) => {
  try {
    const [groups, drivers] = await Promise.all([
      dbListPersons(prisma),
      prisma.driver.findMany({ select: { id: true, name: true, discordName: true, seasonId: true } }),
    ]);
    const { linkable, ambiguous } = buildPersonClusters(drivers, groups);
    for (const rows of linkable) {
      await dbLinkDrivers(prisma, rows.map((r) => r.id));
    }
    res.json({ ok: true, linked: linkable.length, skippedAmbiguous: ambiguous.length });
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

// GET current RESULTS-channel webhook config (separate from the events one).
router.get("/discord/results-webhook", async (req, res, next) => {
  try {
    const url = await getResultsWebhookUrl(prisma);
    res.json({ configured: !!url, preview: url ? url.replace(/\/[^/]+$/, "/•••") : null });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/discord/results-webhook  { url }   ("" clears it)
router.put("/discord/results-webhook", async (req, res, next) => {
  try {
    const { url } = req.body || {};
    if (url && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) {
      return res.status(400).json({ error: "Not a valid Discord webhook URL" });
    }
    await setResultsWebhookUrl(prisma, url || "");
    res.json({ ok: true, configured: !!url });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/races/:id/results-post -> { text } — a generated draft of the
// Discord results message for this round (the admin edits it before posting).
router.get("/races/:id/results-post", async (req, res, next) => {
  try {
    const text = await buildResultsPost(prisma, req.params.id);
    if (text == null) return res.status(404).json({ error: "Race not found or has no results yet" });
    res.json({ text });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/races/:id/results-post { content } -> send the (possibly
// edited) message to the results-channel webhook.
router.post("/races/:id/results-post", async (req, res, next) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "Message is empty" });
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    const result = await postToResultsChannel(prisma, content);
    if (result.skipped) return res.status(400).json({ error: "No results webhook configured" });
    if (!result.ok) return res.status(502).json({ error: result.reason || "Discord rejected the message" });
    res.json({ ok: true, messages: result.messages });
  } catch (e) {
    next(e);
  }
});

// Validate the optional announcement fields shared by create & edit below:
// info (free text for rules/mods), qualiMinutes, raceLaps. Returns { error }
// or { info?, qualiMinutes?, raceLaps? } with only the supplied keys set.
function parseEventExtras(body) {
  const out = {};
  if (body.info !== undefined) {
    const info = String(body.info || "").trim();
    if (info.length > 1500) return { error: "Details must be 1500 characters or fewer" };
    out.info = info || null;
  }
  const quali = parseFormatNumber(body.qualiMinutes, "Qualifying minutes", 240);
  if (quali.error) return { error: quali.error };
  if (quali.ok) out.qualiMinutes = quali.value;
  const laps = parseFormatNumber(body.raceLaps, "Race laps", 999);
  if (laps.error) return { error: laps.error };
  if (laps.ok) out.raceLaps = laps.value;
  return out;
}

// qualiMinutes/raceLaps live outside the generated client -> raw write.
async function writeRaceFormat(raceId, extras) {
  if (extras.qualiMinutes !== undefined) {
    await prisma.$executeRawUnsafe(`UPDATE "Race" SET "qualiMinutes" = ? WHERE "id" = ?`, extras.qualiMinutes, raceId);
  }
  if (extras.raceLaps !== undefined) {
    await prisma.$executeRawUnsafe(`UPDATE "Race" SET "raceLaps" = ? WHERE "id" = ?`, extras.raceLaps, raceId);
  }
}

// POST /api/admin/events  { number?, track, date?, seasonId?, type?,
//                           isSpecialEvent?, info?, qualiMinutes?, raceLaps? }
// Creates an upcoming race. `type` picks what it is: CHAMPIONSHIP (scored
// round, needs a number), TRAINING (practice session — no number, not scored,
// RSVP works) or SPECIAL (special event). The legacy isSpecialEvent flag still
// works as an alias for SPECIAL. The optional extras feed the Discord
// announcement and the site's upcoming-race panels.
router.post("/events", async (req, res, next) => {
  try {
    const { number, track, date, seasonId, isSpecialEvent } = req.body || {};
    if (!track) return res.status(400).json({ error: "track required" });
    const type = req.body?.type || (isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
    if (!RACE_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${RACE_TYPES.join(", ")}` });
    }
    const isChampionship = type === "CHAMPIONSHIP";
    if (isChampionship && !number) return res.status(400).json({ error: "number required" });
    const extras = parseEventExtras(req.body || {});
    if (extras.error) return res.status(400).json({ error: extras.error });
    const targetSeasonId =
      seasonId || (await resolveSeasonId(prisma, undefined, { includePrivate: true, series: req.body?.series }));
    const race = await prisma.race.create({
      data: {
        number: isChampionship ? Number(number) : null,
        track,
        date: date ? new Date(date) : null,
        isCompleted: false,
        // Derived flag every scoring read filters on: TRAINING carries it too,
        // so a session can never sneak into standings or round numbering.
        isSpecialEvent: !isChampionship,
        seasonId: targetSeasonId,
        info: extras.info ?? null,
      },
    });
    await seedRaceCountry(prisma, race.id, race.track);
    race.type = await writeRaceType(prisma, race.id, type);
    await writeRaceFormat(race.id, extras);
    res.status(201).json(race);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "Round number already exists in this season" });
    next(e);
  }
});

// PUT /api/admin/events/:id  { track?, date?, type?, number?, info?,
//                              qualiMinutes?, raceLaps? }
// Edit a race's details AFTER the fact — e.g. rename the raw AC track id
// ("acu_cota_2021") to a display name ("COTA") once the round is imported.
// Works for completed rounds too; results and scoring are untouched. Changing
// the type re-derives number/isSpecialEvent: switching to CHAMPIONSHIP needs a
// round number, switching away clears it.
router.put("/events/:id", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    const { track, date, type, number } = req.body || {};
    const extras = parseEventExtras(req.body || {});
    if (extras.error) return res.status(400).json({ error: extras.error });
    const data = {};
    if (track !== undefined) {
      if (!String(track).trim()) return res.status(400).json({ error: "Track name cannot be empty" });
      data.track = String(track).trim();
    }
    if (date !== undefined) data.date = date ? new Date(date) : null;
    if (extras.info !== undefined) data.info = extras.info;
    if (type !== undefined) {
      if (!RACE_TYPES.includes(type)) {
        return res.status(400).json({ error: `type must be one of: ${RACE_TYPES.join(", ")}` });
      }
      if (type === "CHAMPIONSHIP") {
        const n = number !== undefined ? Number(number) : race.number;
        if (!n) return res.status(400).json({ error: "A championship round needs a round number" });
        data.number = n;
      } else {
        // A race with stored results keeps its identity — retyping it would
        // silently pull its points out of the standings.
        const count = await prisma.raceResult.count({ where: { raceId: race.id } });
        if (count > 0) {
          return res.status(409).json({ error: "This race has stored results and must stay a championship round" });
        }
        data.number = null;
      }
    } else if (number !== undefined && race.number != null) {
      const n = Number(number);
      if (!n) return res.status(400).json({ error: "Round number cannot be empty" });
      data.number = n;
    }
    const updated = await prisma.race.update({ where: { id: race.id }, data });
    if (data.track && data.track !== race.track) await seedRaceCountry(prisma, race.id, updated.track);
    if (type !== undefined) updated.type = await writeRaceType(prisma, race.id, type);
    await writeRaceFormat(race.id, extras);
    // The Discord post mirrors these details — keep an already-announced
    // message in sync without the admin having to hit Announce again.
    if (race.discordMessageId) syncRaceToDiscord(prisma, race.id).catch(() => {});
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
// Refuses to delete a race that already has stored results, UNLESS ?force=1
// (the Edit-Results editor's explicit "delete this race" action): then an
// automatic backup is written first and the round goes away with everything
// attached to it — results, constructor scores, RSVPs, seat offers. Standings
// recompute themselves from the remaining rounds. Replay downloads pointing at
// the race survive; they just lose their race link.
// DELETE /api/admin/races/:id/results — wipe ONLY the stored results of a
// round: the race itself (date, track, sign-ups, quali) stays on the calendar
// as if the results were never imported. Standings recalculate without it.
// A backup is written first, exactly like the full delete.
router.delete("/races/:id/results", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { results: true } } },
    });
    if (!race) return res.status(404).json({ error: "Race not found" });
    if (race._count.results === 0) {
      return res.status(409).json({ error: "This race has no stored results." });
    }
    await tryCreateBackup(prisma, `before-clear-results-r${race.number ?? "x"}`);
    await prisma.$transaction([
      prisma.raceResult.deleteMany({ where: { raceId: race.id } }),
      prisma.constructorRaceScore.deleteMany({ where: { raceId: race.id } }),
      // Back to "not run yet": the calendar card flips to upcoming and the
      // fan-favourite pick belongs to the deleted classification.
      prisma.race.update({ where: { id: race.id }, data: { isCompleted: false } }),
    ]);
    await prisma
      .$executeRawUnsafe(
        `UPDATE "Race" SET "driverOfTheDayId" = NULL, "driverOfTheDayBy" = NULL WHERE "id" = ?`,
        race.id
      )
      .catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete("/events/:id", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { results: true } } },
    });
    if (!race) return res.status(404).json({ error: "Race not found" });
    const force = req.query.force === "1" || req.query.force === "true";
    if (race._count.results > 0 && !force) {
      return res.status(409).json({ error: "Race has results; edit them instead of deleting." });
    }
    if (race._count.results > 0) {
      await tryCreateBackup(prisma, `before-delete-r${race.number ?? "x"}`);
    }
    // Raw column without a foreign key (see lib/downloads.js) — unlink by hand.
    // .catch: the Download table is created lazily and may not exist yet.
    await prisma
      .$executeRawUnsafe(`UPDATE "Download" SET "raceId" = NULL WHERE "raceId" = ?`, race.id)
      .catch(() => {});
    await prisma.race.delete({ where: { id: race.id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// SERIES
// The level above seasons: several independent championships in one deploy.
// The slug (URL identity) is set once at creation and never changes — renames
// only touch the display name, so shared /s/<slug>/ links keep working.
// ---------------------------------------------------------------------------
// GET /api/admin/series -> all series (private included) with season counts.
router.get("/series", async (req, res, next) => {
  try {
    const [series, bySeries] = await Promise.all([
      dbListSeries(prisma, { includePrivate: true }),
      seasonSeriesMap(prisma),
    ]);
    const counts = new Map();
    for (const sid of bySeries.values()) counts.set(sid, (counts.get(sid) || 0) + 1);
    res.json(series.map((s) => ({ ...s, seasonCount: counts.get(s.id) || 0 })));
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/series  { name, game?, description?, accentColor? }
// The slug is derived from the name once and then frozen.
router.post("/series", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const series = await dbCreateSeries(prisma, {
      name,
      slug: req.body?.slug,
      game: req.body?.game,
      description: req.body?.description,
      accentColor: req.body?.accentColor,
    });
    res.status(201).json(series);
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/series/:id  { name?, game?, description?, order?, isPublic?, accentColor? }
// The slug is deliberately NOT editable (bookmarked URLs must keep working).
router.put("/series/:id", async (req, res, next) => {
  try {
    const existing = await getSeriesById(prisma, req.params.id);
    if (!existing) return res.status(404).json({ error: "Series not found" });
    if (req.body?.name !== undefined && !String(req.body.name).trim()) {
      return res.status(400).json({ error: "Series name cannot be empty" });
    }
    // Hiding the ACTIVE (primary) series would blank the public site.
    if (req.body?.isPublic === false && existing.isActive) {
      return res.status(409).json({ error: "The active series cannot be hidden — activate another series first" });
    }
    const series = await dbUpdateSeries(prisma, req.params.id, req.body || {});
    res.json(series);
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/series/:id/activate -> make this the primary series ("/"
// redirects here). Forced public, exactly one active at a time.
router.post("/series/:id/activate", async (req, res, next) => {
  try {
    const series = await getSeriesById(prisma, req.params.id);
    if (!series) return res.status(404).json({ error: "Series not found" });
    await dbActivateSeries(prisma, series.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/series/:id[?force=1] -> remove a series.
// The ACTIVE series and the last remaining series can never be deleted. An
// empty series goes right away; one that still holds seasons requires the
// explicit force flag — then every season (with all its teams/drivers/races)
// is removed, right after an automatic DB backup. Backup failure aborts.
router.delete("/series/:id", async (req, res, next) => {
  try {
    const [series, all] = await Promise.all([
      getSeriesById(prisma, req.params.id),
      dbListSeries(prisma, { includePrivate: true }),
    ]);
    if (!series) return res.status(404).json({ error: "Series not found" });
    if (series.isActive) return res.status(409).json({ error: "The active series cannot be deleted" });
    if (all.length <= 1) return res.status(409).json({ error: "The last series cannot be deleted" });

    const seasons = await seasonIdsOfSeries(prisma, series.id);
    if (seasons.length && !req.query.force) {
      return res.status(409).json({
        error: `${series.name} still holds ${seasons.length} season(s) with all their teams, drivers and races. Deleting removes ALL of it.`,
        needsConfirm: true,
      });
    }

    if (seasons.length) {
      // Safety net first: this wipes real data.
      await createBackup(prisma, `before-delete-series-${series.slug}`);
      for (const s of seasons) {
        await prisma.$transaction([
          // Races first: results, constructor scores, RSVPs and seat offers
          // (with their interests) cascade off them.
          prisma.race.deleteMany({ where: { seasonId: s.id } }),
          prisma.driver.deleteMany({ where: { seasonId: s.id } }),
          prisma.team.deleteMany({ where: { seasonId: s.id } }),
          prisma.season.delete({ where: { id: s.id } }),
        ]);
      }
    }
    await dbDeleteSeries(prisma, series.id);
    res.json({ ok: true, deletedSeasons: seasons.length });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/series/:id/logo  (multipart: file=<image>)
// Uploads (or replaces) this series' dark-mode logo mark (the nav wordmark on
// dark backgrounds). Light mode always uses the shared logo-light.png — a
// plain black mark reads fine on any series' colour, so it has no override.
// An upload works with no file-system access (Railway has none), unlike the
// /logo-dark-<slug>.png drop-in convention it replaces, which silently failed
// whenever a series' real slug differed from the one a file was named after.
router.post("/series/:id/logo", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = LOGO_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Unsupported image type (use PNG, WEBP or SVG)" });
    const series = await getSeriesById(prisma, req.params.id);
    if (!series) return res.status(404).json({ error: "Series not found" });

    mkdirSync(SERIES_DIR, { recursive: true });
    const filename = `${series.id}${ext}`;
    writeFileSync(join(SERIES_DIR, filename), req.file.buffer);
    // Cache-bust the URL so an updated logo shows immediately.
    const logoDarkUrl = `/api/uploads/series/${filename}?v=${Date.now()}`;
    await writeSeriesLogo(prisma, series.id, logoDarkUrl);
    res.json({ ok: true, logoDarkUrl });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/series/:id/logo -> clear the override (back to the shared
// default logo-dark.png).
router.delete("/series/:id/logo", async (req, res, next) => {
  try {
    const series = await getSeriesById(prisma, req.params.id);
    if (!series) return res.status(404).json({ error: "Series not found" });
    await writeSeriesLogo(prisma, series.id, null);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// SEASONS
// ---------------------------------------------------------------------------
// GET /api/admin/seasons[?series=<slug>] -> seasons with content counts —
// scoped to one series when asked (the admin UI edits one series at a time),
// otherwise all of them (each row says which series it belongs to).
router.get("/seasons", async (req, res, next) => {
  try {
    const [seasons, raw, bySeries, allSeries] = await Promise.all([
      prisma.season.findMany({
        orderBy: { number: "desc" },
        include: { _count: { select: { teams: true, drivers: true, races: true } } },
      }),
      // teamDropWorst / teamDropMode / isPublic / isAnnounced / heroImageUrl
      // aren't in the generated client yet -> raw read.
      prisma.$queryRawUnsafe(`SELECT "id", "teamDropWorst", "teamDropMode", "isPublic", "isAnnounced", "heroImageUrl", "carImageUrl" FROM "Season"`).catch(() => []),
      seasonSeriesMap(prisma),
      dbListSeries(prisma, { includePrivate: true }),
    ]);
    const rawById = new Map(raw.map((r) => [r.id, r]));
    const seriesById = new Map(allSeries.map((s) => [s.id, s]));
    let filterSeriesId = null;
    if (req.query.series !== undefined && req.query.series !== "") {
      const target = await resolveSeries(prisma, req.query.series, { includePrivate: true });
      if (!target) return res.json([]);
      filterSeriesId = target.id;
    }
    res.json(
      seasons
        .filter((s) => !filterSeriesId || bySeries.get(s.id) === filterSeriesId)
        .map((s) => {
          const extra = rawById.get(s.id) || {};
          const seriesId = bySeries.get(s.id) || null;
          const series = seriesId ? seriesById.get(seriesId) : null;
          return {
            ...s,
            seriesId,
            seriesName: series?.name || null,
            seriesSlug: series?.slug || null,
            teamDropWorst: extra.teamDropWorst == null ? null : Number(extra.teamDropWorst),
            teamDropMode: extra.teamDropMode === "rounds" ? "rounds" : null,
            isPublic: extra.isPublic == null ? true : !!Number(extra.isPublic),
            isAnnounced: !!Number(extra.isAnnounced ?? 0),
            heroImageUrl: extra.heroImageUrl || null,
            carImageUrl: extra.carImageUrl || null,
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
  if (body.isAnnounced !== undefined) out.isAnnounced = body.isAnnounced ? 1 : 0;
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
  if (raw.isAnnounced !== undefined) {
    await prisma.$executeRawUnsafe(`UPDATE "Season" SET "isAnnounced" = ? WHERE "id" = ?`, raw.isAnnounced, seasonId);
  }
}


// Season numbers are unique PER SERIES now. The DB enforces it via the
// composite index, but the seriesId is written in a second raw step (the
// generated client doesn't know the column), so check up front for a clean
// error instead of a failed raw UPDATE halfway through.
async function seasonNumberTaken(seriesId, number, exceptSeasonId = null) {
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT "id" FROM "Season" WHERE "seriesId" = ? AND "number" = ?`,
      seriesId,
      Number(number)
    )
    .catch(() => []);
  return rows.some((r) => r.id !== exceptSeasonId);
}

// POST /api/admin/seasons  { number, name, game?, series?, dropWorst?, pointsTable? }
// `series` (a slug) says which series the season belongs to — default: the
// series the admin is editing / the active one.
router.post("/seasons", async (req, res, next) => {
  try {
    const { number, name, game } = req.body || {};
    if (number === undefined || !name) return res.status(400).json({ error: "number and name required" });
    const series = await resolveSeries(prisma, req.body?.series, { includePrivate: true });
    if (!series) return res.status(400).json({ error: "Unknown series" });
    if (await seasonNumberTaken(series.id, number)) {
      return res.status(409).json({ error: `A season with that number already exists in ${series.name}` });
    }
    const data = { number: Number(number), name, game: game || null };
    const scoringError = applyScoringInput(req.body || {}, data);
    if (scoringError) return res.status(400).json({ error: scoringError });
    const raw = parseSeasonRawFields(req.body || {});
    if (raw.error) return res.status(400).json({ error: raw.error });
    const season = await prisma.season.create({ data });
    await setSeasonSeries(prisma, season.id, series.id);
    // New seasons are created PRIVATE by default (hidden until the admin
    // publishes them), unless the request explicitly set isPublic.
    if (raw.isPublic === undefined) raw.isPublic = 0;
    await writeSeasonRawFields(season.id, raw);
    res.status(201).json({ ...season, seriesId: series.id, seriesSlug: series.slug });
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "A season with that number already exists in this series" });
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
    if (number !== undefined) {
      // Numbers are unique per series — check against THIS season's series.
      const bySeries = await seasonSeriesMap(prisma);
      const seriesId = bySeries.get(req.params.id) || null;
      if (seriesId && (await seasonNumberTaken(seriesId, number, req.params.id))) {
        return res.status(409).json({ error: "A season with that number already exists in this series" });
      }
    }
    const season = await prisma.season.update({ where: { id: req.params.id }, data });
    await writeSeasonRawFields(season.id, raw);
    res.json(season);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "A season with that number already exists in this series" });
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

// POST /api/admin/seasons/:id/activate -> make this the active (public
// default) season OF ITS SERIES. The invariant is "max. one active season per
// series" — activating the GT series' season never deactivates the F1 one.
router.post("/seasons/:id/activate", async (req, res, next) => {
  try {
    const season = await prisma.season.findUnique({ where: { id: req.params.id } });
    if (!season) return res.status(404).json({ error: "Season not found" });
    const bySeries = await seasonSeriesMap(prisma);
    const seriesId = bySeries.get(season.id) || null;
    if (seriesId) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Season" SET "isActive" = 0 WHERE "seriesId" = ? AND "id" != ?`,
        seriesId,
        season.id
      );
    } else {
      // Unmigrated row (no series yet): fall back to the old global behaviour.
      await prisma.season.updateMany({ where: { id: { not: season.id } }, data: { isActive: false } });
    }
    await prisma.season.update({ where: { id: season.id }, data: { isActive: true } });
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

// POST /api/admin/seasons/:id/hero  (multipart: file=<image>)
// Uploads (or replaces) the season's Home/Welcome main-card photo. Works
// without file-system access (Railway has none), unlike the static
// /heroes/s<number>.jpg drop-in convention it overrides for seasons that use it.
router.post("/seasons/:id/hero", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = LOGO_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Unsupported image type (use PNG, JPG or WEBP)" });
    const season = await prisma.season.findUnique({ where: { id: req.params.id } });
    if (!season) return res.status(404).json({ error: "Season not found" });

    mkdirSync(SEASONS_DIR, { recursive: true });
    const filename = `${season.id}${ext}`;
    writeFileSync(join(SEASONS_DIR, filename), req.file.buffer);
    // Cache-bust the URL so an updated photo shows immediately.
    const heroImageUrl = `/api/uploads/seasons/${filename}?v=${Date.now()}`;
    await writeSeasonHero(prisma, season.id, heroImageUrl);
    res.json({ ok: true, heroImageUrl });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/seasons/:id/hero -> clear the override (falls back to the
// static /heroes/s<number>.jpg drop-in convention, then /hero.jpg).
router.delete("/seasons/:id/hero", async (req, res, next) => {
  try {
    const season = await prisma.season.findUnique({ where: { id: req.params.id } });
    if (!season) return res.status(404).json({ error: "Season not found" });
    await writeSeasonHero(prisma, season.id, null);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/seasons/:id/car  (multipart: file=<image>)
// Uploads (or replaces) the season's car image, shown in the "coming soon"
// hero panel. Same mechanics as the hero photo above.
router.post("/seasons/:id/car", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = LOGO_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Unsupported image type (use PNG, JPG or WEBP)" });
    const season = await prisma.season.findUnique({ where: { id: req.params.id } });
    if (!season) return res.status(404).json({ error: "Season not found" });

    mkdirSync(SEASONS_DIR, { recursive: true });
    const filename = `${season.id}-car${ext}`;
    writeFileSync(join(SEASONS_DIR, filename), req.file.buffer);
    const carImageUrl = `/api/uploads/seasons/${filename}?v=${Date.now()}`;
    await writeSeasonCar(prisma, season.id, carImageUrl);
    res.json({ ok: true, carImageUrl });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/seasons/:id/car -> clear the override (falls back to the
// static /cars/s<number>.jpg convention; without that the panel just stays away).
router.delete("/seasons/:id/car", async (req, res, next) => {
  try {
    const season = await prisma.season.findUnique({ where: { id: req.params.id } });
    if (!season) return res.status(404).json({ error: "Season not found" });
    await writeSeasonCar(prisma, season.id, null);
    res.json({ ok: true });
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
    const targetSeasonId =
      seasonId || (await resolveSeasonId(prisma, undefined, { includePrivate: true, series: req.body?.series }));
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
    const [info, countries] = await Promise.all([readTrackInfo(prisma, key), readTrackCountries(prisma)]);
    // Effective flag country: admin-stored code on the races, else the static
    // circuit table. countrySource tells the UI whether it's an override.
    res.json({
      ...info,
      country: countries[key] || staticCountryFor(key) || null,
      countryStored: countries[key] || null,
    });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/tracks/:key/country { country: "gb" | null } — set the flag
// country of every race at this circuit, across all seasons.
router.put("/tracks/:key/country", async (req, res, next) => {
  try {
    const key = safeTrackKey(req.params.key);
    if (!key) return res.status(400).json({ error: "Invalid track key" });
    const updated = await writeTrackCountry(prisma, key, req.body?.country ?? null);
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(400).json({ error: e.message });
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

// Shared validation for create & update: a race-linked entry (replay) must
// point at a real race, and lands in the auto-created "Replays" folder unless
// the admin picked a folder themselves.
async function prepareDownloadInput(b) {
  if (b.raceId) {
    const race = await prisma.race.findUnique({ where: { id: b.raceId } });
    if (!race) return { error: "That race no longer exists" };
    if (!b.folderId) b.folderId = (await ensureReplaysFolder(prisma)).id;
  }
  if (b.folderId && !(await dbGetFolder(prisma, b.folderId))) {
    return { error: "That folder no longer exists" };
  }
  return { ok: true };
}

// POST /api/admin/downloads -> create a catalogue entry.
router.post("/downloads", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: "Title is required" });
    if (!b.fileName && !b.externalUrl) return res.status(400).json({ error: "Pick a file or give an external link" });
    const check = await prepareDownloadInput(b);
    if (check.error) return res.status(400).json({ error: check.error });
    const created = await dbCreateDownload(prisma, b);
    const shaped = shapeDownload(created);
    // Bell notification for the members (skipped for unpublished entries).
    notifyDownloadAdded(prisma, shaped);
    res.json({ ok: true, download: shaped });
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
    const check = await prepareDownloadInput(merged);
    if (check.error) return res.status(400).json({ error: check.error });
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
