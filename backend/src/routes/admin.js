import { Router } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import bcrypt from "bcryptjs";
import { writeFileSync, mkdirSync, appendFileSync, readFileSync, existsSync, unlinkSync, readdirSync, statSync, openSync, readSync, closeSync, fstatSync } from "fs";
import { join, extname, basename, dirname } from "path";
import { fileURLToPath } from "url";
import prisma from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { isSafeId, safeUploadPath } from "../lib/safeUpload.js";
import { parseAcRaceJson, parseAcQualiJson } from "../services/acJsonParser.js";
import { listRemoteResults, fetchRemoteResult } from "../services/emperorResults.js";
import { saveRaceResults } from "../services/raceWriter.js";
import { previewRaceImpact } from "../services/previewService.js";
import { getDriverRatings, RATING_DEFAULTS } from "../services/driverRatingsService.js";
// The entry-list answer that follows a seat, shared with the driver-facing
// market routes so an admin override and a driver's own pick write the same row.
import { setSeatRsvp, readAnnounce, ANNOUNCE_KEY } from "./market.js";
import { getWebhookUrl, setWebhookUrl, getResultsRoleId, getResultsWebhookUrl, setResultsRoleId, setResultsWebhookUrl, postToResultsChannel, announce, syncRaceToDiscord } from "../services/discordService.js";
import { buildResultsPost, buildStandingsPost, buildConstructorsPost } from "../services/resultsPostService.js";
import { resolveSeasonId, invalidatePrivateSeasonCache } from "../services/seasonService.js";
import { checkSeasonIntegrity } from "../services/integrityService.js";
import { createBackup, tryCreateBackup, listBackups, streamFullBackupZip, deleteBackup, pruneBackupsTo } from "../services/backupService.js";
import { memoryReport, writeHeapSnapshotFile } from "../services/memoryDiagnostics.js";
import { SOCIAL_KEYS, readSocialLinks, readLiveLinks, LIVE_LINK_DEFAULTS } from "./settings.js";
import { parseFormatNumber } from "../lib/raceFormat.js";
import { parseHighlightsUrl, writeRaceHighlights } from "../lib/raceHighlights.js";
import { writeRaceHero } from "../lib/raceHero.js";
import { RACE_TYPES, writeRaceType, readRaceTypes } from "../lib/raceTypes.js";
import { writeSeasonHero, writeSeasonCar } from "../lib/seasonHero.js";
import { DRIVER_ROLES, writeDriverRole } from "../lib/driverRoles.js";
import { getTrafficStats } from "../lib/traffic.js";
import { leagueSince, setLeagueSince } from "../lib/leagueStats.js";
import {
  dbListDownloads, dbGetDownload, dbCreateDownload, dbUpdateDownload, dbDeleteDownload, ensureReplaysFolder,
  dbListFolders, dbGetFolder, dbCreateFolder, dbUpdateFolder, dbDeleteFolder,
  listDiskFiles, statFile, fmtSize, shapeDownload, ensureDownloadsDir, DOWNLOADS_DIR,
  deleteStoredFile, listOrphanFiles,
} from "../lib/downloads.js";
import { stashIncoming, archiveCommitted } from "../lib/resultsArchive.js";
import { readRatingWeights, writeRatingWeights } from "../lib/ratingWeights.js";
import { invalidateRatingHistoryCache } from "../services/ratingHistoryService.js";
import { invalidateCardRatingCache } from "../services/cardRatingService.js";
import { invalidateRecordsCache } from "../services/recordsService.js";
import { readTrackInfo, writeTrackInfo } from "../lib/trackInfo.js";
import { readTeamArt, writeTeamArt, writeTeamCountry, ART_KINDS, readCarFraming, writeCarFraming } from "../lib/teamArt.js";
import {
  dbListReports, dbGetReport, dbMessages, dbViewers, dbDecideReport, dbAddMessage,
  dbDecidedForRace, dbAddViewer, dbRemoveViewer, dbDeleteReport, REPORT_DECIDED, dbAttachments,
  dbThreadVoices, readFileRetentionDays, writeFileRetentionDays, RETENTION_CHOICES,
} from "../lib/reports.js";
import { sweepReportFiles } from "../services/reportHousekeeping.js";
import { serveAttachment, saveAttachment, attachmentUpload, removeAttachmentFiles } from "../lib/reportFiles.js";
import { readTrackCountries, writeTrackCountry, seedRaceCountry, staticCountryFor } from "../lib/raceCountries.js";
import { normKey } from "../lib/trackKeys.js";
import { readRaceInfo, writeRaceInfo } from "../lib/raceInfo.js";
import { readWelcomeFaq, writeWelcomeFaq } from "../lib/welcomeFaq.js";
import {
  dbListFeedback,
  dbGetFeedback,
  dbUpdateFeedback,
  dbDeleteFeedback,
  dbAddFeedbackReply,
  notifySenderOfReply,
} from "../lib/feedback.js";
import {
  dbListMembers, dbGetMember, dbSetBanned, dbClearRaceRequest, shapeMember, applyMemberSteamId,
} from "../lib/members.js";
import { isIndividualSteamId } from "./steamAuth.js";
import { ensureReservePool } from "../lib/reservePool.js";
import {
  dbLinkDrivers, dbUnlinkDriver, dbListPersons, getLinkedDriverIds, getPersonGroups,
  getNameOverrides, discordIdsForDrivers,
} from "../lib/persons.js";
import {
  dbListSeries, dbCreateSeries, dbUpdateSeries, dbActivateSeries, dbDeleteSeries,
  getSeriesById, resolveSeries, seasonIdsOfSeries, seasonSeriesMap, setSeasonSeries,
  writeSeriesLogo,
} from "../lib/series.js";
import { getAdminDiscordIds, setDiscordAdmin } from "../lib/adminUsers.js";
import { getStewardDiscordIds, setSteward } from "../lib/stewards.js";
import {
  notifyResultsSaved, notifyRacePhotosAdded, notifyDownloadAdded, notifySeatFilled, notifyCardUnlocksForSeason,
  readNotifySettings, writeNotifySettings, NOTIFY_DEFAULTS, REMINDER_OFFSETS,
  sendAttendancePing, dbCreateNotification,
} from "../lib/notifications.js";
import {
  readFeedConfig, writeFeedConfig, readPosts, writePosts,
  resolveChannelId, fetchChannelVideos, lookupPost, downloadImage, extractUrls,
} from "../lib/socialFeed.js";
import { ATTENDANCE_STATES, readAttendanceOverrides, writeAttendanceOverride } from "../lib/attendanceGate.js";
import { writeHiddenRace } from "../lib/attendanceHidden.js";
import { MAX_PHOTOS, readRacePhotos, writeRacePhotos, racePhotoUrl } from "../lib/racePhotos.js";
import { sessionStartForRound } from "../lib/raceContacts.js";
// DOWNLOADS_DIR arrives via lib/downloads.js above.
import { UPLOADS_DIR, LOGS_DIR, BACKUPS_DIR, RESULTS_ARCHIVE_DIR } from "../lib/dataDirs.js";
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
// Cover images for social cards the platform gives us no thumbnail for.
const SOCIAL_DIR = join(UPLOADS_DIR, "social");
// Race-night photo galleries (one folder for all rounds; the file name carries
// the race it belongs to, and the Setting blob is the actual index).
const RACES_DIR = join(UPLOADS_DIR, "races");
// Cars and wide wordmarks for the shareable result graphic (lib/teamArt.js).
const TEAM_ART_DIR = join(UPLOADS_DIR, "team-art");
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

// The log only ever grows and the view below only ever shows its newest lines,
// so it is read from the end: a chunk off the tail, grown fourfold until it
// holds enough lines or the whole file has been covered. Same lines, same order, but
// the request no longer pulls the entire history onto the heap.
function readTailLines(path, wantLines) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    let chunk = 64 * 1024;
    for (;;) {
      const start = Math.max(0, size - chunk);
      const buf = Buffer.alloc(size - start);
      // readSync may come back short; keep going, a truncated tail would hide
      // the newest entries.
      let filled = 0;
      while (filled < buf.length) {
        const n = readSync(fd, buf, filled, buf.length - filled, start + filled);
        if (!n) break;
        filled += n;
      }
      let text = buf.subarray(0, filled).toString("utf-8");
      if (start > 0) {
        // A chunk starting mid-file also starts mid-line, and possibly mid
        // UTF-8 character (an umlaut in a driver name would decode to garbage).
        // Everything up to the first newline is therefore dropped; only a chunk
        // that reaches byte 0 keeps its first line.
        const nl = text.indexOf("\n");
        text = nl === -1 ? "" : text.slice(nl + 1).replace(/\s+$/, "");
      } else {
        text = text.trim();
      }
      const lines = text.split("\n");
      if (lines.length >= wantLines || start === 0) return lines;
      chunk *= 4;
    }
  } finally {
    closeSync(fd);
  }
}

// GET /api/admin/activity -> the latest admin actions, newest first.
router.get("/activity", (req, res) => {
  try {
    if (!existsSync(ACTIVITY_LOG)) return res.json({ entries: [] });
    const lines = readTailLines(ACTIVITY_LOG, 150);
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

// GET /api/admin/memory -> live memory breakdown (total vs JS heap vs native
// buffers) plus the live-timing internals. The Health tab's "Server memory"
// card; the same report is also written to the logs every 5 minutes (see
// services/memoryDiagnostics.js for why it exists and the baseline numbers).
router.get("/memory", (_req, res) => {
  res.json(memoryReport());
});

// GET /api/admin/memory/heap-snapshot -> full V8 heap snapshot as a download.
// Writing it BLOCKS the whole site for a few seconds (the admin UI warns), and
// the file is deleted right after it has been streamed out — it is roughly
// heap-sized and has no business staying on the capped volume.
router.get("/memory/heap-snapshot", (req, res, next) => {
  try {
    const snap = writeHeapSnapshotFile();
    res.download(snap.path, snap.name, () => {
      try {
        unlinkSync(snap.path);
      } catch {
        /* the next snapshot sweeps leftovers anyway */
      }
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/backups -> list of snapshot files (newest first).
router.get("/backups", (req, res) => {
  res.json({ backups: listBackups() });
});

// POST /api/admin/backups/prune { keep } -> delete every snapshot but the
// newest `keep`. The admin's broom for "the old ones can go" — the automatic
// 40-file cap stays untouched.
router.post("/backups/prune", (req, res) => {
  const removed = pruneBackupsTo(req.body?.keep ?? 5);
  res.json({ ok: true, removed, backups: listBackups() });
});

// DELETE /api/admin/backups/:file -> delete one snapshot by name.
router.delete("/backups/:file", (req, res) => {
  if (!deleteBackup(req.params.file)) return res.status(404).json({ error: "No such backup" });
  res.json({ ok: true, backups: listBackups() });
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

// ---------------------------------------------------------------------------
// STORAGE OVERVIEW
// What is actually on the disk, area by area — asked for when the race photo
// galleries arrived: "how much space are the photos eating?". On Railway all
// of this lives on the mounted volume, whose size is capped, so the answer
// matters beyond curiosity.
// ---------------------------------------------------------------------------

// Total bytes + file count of a directory tree. Sync on purpose: these trees
// are a few hundred files at most (the big AC downloads are the exception, and
// even a thousand stat calls are milliseconds), and the admin taps this once.
function dirUsage(dir) {
  let bytes = 0;
  let files = 0;
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        const sub = dirUsage(p);
        bytes += sub.bytes;
        files += sub.files;
      } else {
        bytes += st.size;
        files += 1;
      }
    }
  } catch {
    /* a missing folder is simply empty */
  }
  return { bytes, files };
}

// The SQLite file behind DATABASE_URL ("file:./dev.db" resolves relative to
// backend/prisma, where the schema lives). Null when it can't be found — the
// overview then just leaves the database row out rather than guessing.
function databaseFileSize() {
  try {
    const url = process.env.DATABASE_URL || "";
    if (!url.startsWith("file:")) return null;
    const raw = url.slice(5);
    const prismaDir = join(dirname(fileURLToPath(import.meta.url)), "../../prisma");
    const p = raw.startsWith("/") || /^[A-Za-z]:/.test(raw) ? raw : join(prismaDir, raw);
    return statSync(p).size;
  } catch {
    return null;
  }
}

// GET /api/admin/storage -> { areas: [{ key, label, bytes, files }], databaseBytes }
router.get("/storage", async (_req, res, next) => {
  try {
    // The uploads folder split by what lives in each subfolder, so "the race
    // photos" is its own line instead of hiding inside one uploads number.
    const UPLOAD_AREAS = [
      ["races", "Race photos"],
      ["avatars", "Driver photos"],
      ["teams", "Team logos"],
      ["seasons", "Season images"],
      ["series", "Series logos"],
      ["tracks", "Track maps"],
      ["social", "Social covers"],
      ["cards", "Card photos"],
    ];
    const areas = [];
    const seen = new Set(UPLOAD_AREAS.map(([key]) => key));
    for (const [key, label] of UPLOAD_AREAS) {
      areas.push({ key: `uploads/${key}`, label, ...dirUsage(join(UPLOADS_DIR, key)) });
    }
    // A future upload folder this list doesn't know yet still gets counted,
    // under its own name — the overview must never quietly omit disk usage.
    try {
      for (const name of readdirSync(UPLOADS_DIR)) {
        if (seen.has(name) || !statSync(join(UPLOADS_DIR, name)).isDirectory()) continue;
        areas.push({ key: `uploads/${name}`, label: `Uploads: ${name}`, ...dirUsage(join(UPLOADS_DIR, name)) });
      }
    } catch {
      /* no uploads folder yet */
    }
    areas.push({ key: "downloads", label: "Downloads (AC files)", ...dirUsage(DOWNLOADS_DIR) });
    areas.push({ key: "backups", label: "Backups", ...dirUsage(BACKUPS_DIR) });
    areas.push({ key: "results-archive", label: "Raw result files", ...dirUsage(RESULTS_ARCHIVE_DIR) });
    areas.push({ key: "logs", label: "Logs", ...dirUsage(LOGS_DIR) });
    res.json({ areas, databaseBytes: databaseFileSize() });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/backups/download -> full backup (DB snapshot + uploads) as a
// zip, streamed while it's being built (see streamFullBackupZip for why).
// This is the copy that belongs on ANOTHER machine — everything else in
// backend/backups/ lives on the same disk as the live database.
router.get("/backups/download", async (req, res, next) => {
  try {
    await streamFullBackupZip(prisma, res);
  } catch (e) {
    // Once bytes are on the wire a clean error reply is no longer possible —
    // cut the stream so the browser reports a failed download instead of
    // saving a silently truncated zip.
    if (res.headersSent) res.destroy();
    else next(e);
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
    const byId = new Map();
    // Chunked: one placeholder per driver would run into SQLite's 999-variable
    // limit once the all-seasons roster grows past it (it is in the hundreds
    // already, one more season per year).
    for (let i = 0; i < drivers.length; i += 400) {
      const chunk = drivers.slice(i, i + 400);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "id", "steamId" FROM "Driver" WHERE "id" IN (${chunk.map(() => "?").join(", ")})`,
        ...chunk.map((d) => d.id)
      );
      for (const r of rows) byId.set(r.id, r.steamId ?? null);
    }
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
    // New weights bend every replayed curve — drop the cached histories and
    // the frozen card values computed from them.
    invalidateRatingHistoryCache();
    invalidateCardRatingCache();
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
    const previous = offer.filledById;
    await prisma.seatOffer.update({
      where: { id: offer.id },
      data: { filledById: pickId, status: pickId ? "FILLED" : "OPEN" },
    });
    // The entry list has to follow the seat. Being given a car IS the answer to
    // "are you on the grid", and the admin builds that grid from this very
    // list — a stand-in who sat in nobody's column was the one person on track
    // the list did not know about. Taking the seat away takes the answer with
    // it, back to no answer rather than to declined.
    if (previous && previous !== pickId) await setSeatRsvp(prisma, offer.raceId, previous, false);
    if (pickId) await setSeatRsvp(prisma, offer.raceId, pickId, true);
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

// GET  /api/admin/market/announce -> { openCount, announcedCount, at }
// POST /api/admin/market/announce -> point every reserve at the open seats
//
// The nudge on the members' side (the count beside Attendance, the line above
// the bottom of the attendance page, the ring around the free seats) used to
// fire on its own the moment a seat row existed. That is the site deciding to
// chase seventy-eight people, and it is not the site's decision: a seat can be
// open because the round is weeks away, or because the swap is half agreed
// somewhere else and the admin wants a word first.
//
// So it waits here. Pressing this writes down which seats are being announced
// and when, and the members' side only lights up for those. Pressing it again
// later is a fresh stamp, which is how you chase the same seat twice without
// the site doing it behind your back.
router.get("/market/announce", async (req, res, next) => {
  try {
    const openIds = await openOfferIds();
    const announced = await readAnnounce(prisma);
    res.json({
      openCount: openIds.length,
      // Only the ones that are still open — an announcement for a seat that has
      // since been filled is not something waiting to be repeated.
      announcedCount: openIds.filter((id) => announced.ids.includes(id)).length,
      at: announced.at || null,
    });
  } catch (e) {
    next(e);
  }
});

router.post("/market/announce", async (req, res, next) => {
  try {
    const ids = await openOfferIds();
    const value = JSON.stringify({ at: new Date().toISOString(), ids });
    await prisma.setting.upsert({
      where: { key: ANNOUNCE_KEY },
      update: { value },
      create: { key: ANNOUNCE_KEY, value },
    });
    res.json({ ok: true, count: ids.length });
  } catch (e) {
    next(e);
  }
});

// Every seat currently going begging on a race that has not been run.
async function openOfferIds() {
  const rows = await prisma.seatOffer.findMany({
    where: { status: "OPEN", race: { isCompleted: false, isSpecialEvent: false } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// POST /api/admin/market  { raceId, driverId, filledById? }
// Enter a swap that was agreed somewhere else.
//
// Most of these deals happen on Discord: somebody says they cannot make Friday,
// somebody else says they will take it, done. Until now the only way to get
// that onto the site was to ask the two of them to repeat the whole dance here,
// which nobody does, so the entry list and the grid quietly disagreed. An admin
// can now write down what was agreed: whose seat it is, and who is taking it.
//
// It goes through the same rows as a seat offered on the site, so everything
// downstream (the takeover record, the import pre-fill, the entry list) cannot
// tell the difference and does not have to.
router.post("/market", async (req, res, next) => {
  try {
    const { raceId, driverId, filledById } = req.body || {};
    const race = await prisma.race.findUnique({ where: { id: String(raceId || "") } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    if (race.isSpecialEvent) {
      return res.status(400).json({ error: "Only championship rounds have a driver market" });
    }
    const driver = await prisma.driver.findUnique({
      where: { id: String(driverId || "") },
      include: { team: true },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    if (driver.seasonId !== race.seasonId) {
      return res.status(400).json({ error: "That driver belongs to another season's roster" });
    }
    if (driver.team?.tier !== 1 && driver.team?.tier !== 2) {
      return res.status(400).json({ error: "Only a full-time driver has a seat to give up" });
    }

    let reserve = null;
    if (filledById) {
      reserve = await prisma.driver.findUnique({ where: { id: String(filledById) }, include: { team: true } });
      if (!reserve) return res.status(404).json({ error: "Reserve not found" });
      if (reserve.team?.tier !== 0) return res.status(400).json({ error: "Only reserve drivers can fill a seat" });
      if (reserve.seasonId !== race.seasonId) {
        return res.status(400).json({ error: "That reserve belongs to another season's roster" });
      }
      if (reserve.id === driver.id) return res.status(400).json({ error: "That is the same driver" });
    }

    const offer = await prisma.seatOffer.upsert({
      where: { raceId_driverId: { raceId: race.id, driverId: driver.id } },
      update: { status: reserve ? "FILLED" : "OPEN", filledById: reserve?.id || null, teamId: driver.teamId },
      create: {
        raceId: race.id,
        driverId: driver.id,
        teamId: driver.teamId,
        status: reserve ? "FILLED" : "OPEN",
        filledById: reserve?.id || null,
      },
      include: { team: true },
    });

    // Both answers, exactly as the driver-facing routes write them.
    await prisma.raceRsvp
      .upsert({
        where: { raceId_driverId: { raceId: race.id, driverId: driver.id } },
        update: { status: "DECLINED" },
        create: { raceId: race.id, driverId: driver.id, status: "DECLINED" },
      })
      .catch(() => {});
    if (reserve) await setSeatRsvp(prisma, race.id, reserve.id, true);

    // No seat-offered fan-out: this is a done deal being written down, not a
    // seat going begging. The reserve is told, because being entered into a
    // race by somebody else is worth hearing about.
    if (reserve) notifySeatFilled(prisma, { offerId: offer.id, raceId: race.id, reserve });
    try {
      await syncRaceToDiscord(prisma, race.id);
    } catch {
      /* Discord is a mirror of this, not the record of it */
    }
    res.json({ ok: true, offerId: offer.id });
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
    // `since` rides along with the social links because it belongs with the
    // Discord invite: both are "who the league is" rather than race data, and
    // the landing page reads them together (see lib/leagueStats.js).
    res.json({ ...(await readSocialLinks(prisma)), since: await leagueSince(prisma) });
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
    if ("since" in body) await setLeagueSince(prisma, body.since);
    res.json({ ...(await readSocialLinks(prisma)), since: await leagueSince(prisma) });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// SOCIAL WALL (the cards on the home page)
// The channel links above say where to find us; this says what we posted.
// See lib/socialFeed.js for why YouTube is automatic and the rest is not.
// ---------------------------------------------------------------------------

// GET /api/admin/social-feed -> config + every stored post, newest first, plus
// what the YouTube channel currently returns, so the editor can show the admin
// exactly which videos will appear before anything is saved.
router.get("/social-feed", async (req, res, next) => {
  try {
    const [config, posts] = await Promise.all([readFeedConfig(prisma), readPosts(prisma)]);
    const channelVideos = config.youtubeChannelId ? await fetchChannelVideos(config.youtubeChannelId) : [];
    res.json({ config, posts, channelVideos: channelVideos.slice(0, 6) });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/social-feed  { config } — saves the settings and, when the
// channel URL changed, resolves it to the UC… id the RSS feed needs. A URL we
// can't resolve is saved anyway (so the typo stays visible in the field) and
// reported back, rather than silently dropped.
router.put("/social-feed", async (req, res, next) => {
  try {
    const incoming = req.body?.config || req.body || {};
    const current = await readFeedConfig(prisma);
    const url = String(incoming.youtubeChannelUrl || "").trim();
    let channelId = current.youtubeChannelId;
    let channelError = null;
    if (!url) {
      channelId = "";
    } else if (url !== current.youtubeChannelUrl || !channelId) {
      channelId = (await resolveChannelId(url)) || "";
      if (!channelId) channelError = "Couldn't read a channel from that link. Open the channel on YouTube and copy the address from the browser bar.";
    }
    const config = await writeFeedConfig(prisma, { ...incoming, youtubeChannelId: channelId });
    const channelVideos = config.youtubeChannelId ? await fetchChannelVideos(config.youtubeChannelId, { force: true }) : [];
    res.json({ config, channelError, channelVideos: channelVideos.slice(0, 6) });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/social-feed/lookup { url } -> title/thumbnail we can read for
// that link, so adding a post is "paste, check, save" instead of typing it all.
router.post("/social-feed/lookup", async (req, res, next) => {
  try {
    res.json(await lookupPost(req.body?.url));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Take our own copy of a card's picture. Instagram and TikTok both hand out
// links that expire within days (see lib/socialFeed.js), so a card pointing at
// one goes blank on its own. Best-effort: a picture we can't fetch just leaves
// the card on the platform's link, which the admin can still replace by hand.
// Mutates `post`: writes the local cover URL and, for a platform that told us
// nothing about the post's shape, the shape read out of the picture itself.
async function mirrorCover(post) {
  if (!post?.thumbUrl || !isSafeId(post.id)) return null;
  const img = await downloadImage(post.thumbUrl);
  if (!img) return null;
  mkdirSync(SOCIAL_DIR, { recursive: true });
  const filename = `${post.id}${img.ext}`;
  const dest = safeUploadPath(SOCIAL_DIR, filename);
  if (!dest) return null;
  writeFileSync(dest, img.buffer);
  // Instagram publishes no dimensions, so the cover's own are all we get — and
  // they're what makes a Reel stand up instead of lying down.
  if (!post.aspect && img.width && img.height) post.aspect = img.width / img.height;
  post.coverUrl = `/api/uploads/social/${filename}?v=${Date.now()}`;
  return post.coverUrl;
}

// POST /api/admin/social-feed/posts { post } -> add a card.
router.post("/social-feed/posts", async (req, res, next) => {
  try {
    const posts = await readPosts(prisma);
    const incoming = req.body?.post || req.body || {};
    // Ask the platform for anything the caller didn't bring. The editor already
    // does this through /lookup so the admin can see it first, but the route
    // must not DEPEND on that: a post added without it would otherwise be a
    // bare link with no picture and no words.
    let found = {};
    if (!incoming.thumbUrl || !incoming.title || !incoming.postedAt) {
      try {
        found = await lookupPost(incoming.url);
      } catch {
        /* an unreadable link is still allowed as a hand-written card */
      }
    }
    const post = {
      ...incoming,
      id: undefined,
      title: incoming.title || found.title || "",
      thumbUrl: incoming.thumbUrl || found.thumbUrl || null,
      embedUrl: incoming.embedUrl || found.embedUrl || null,
      aspect: incoming.aspect || found.aspect || null,
      // Cards are ordered by date. Only Instagram tells us when a post went up,
      // so anything else counts as posted now unless the admin dated it —
      // otherwise every hand-added post would sink to the bottom of the wall.
      postedAt: incoming.postedAt || found.postedAt || new Date().toISOString(),
    };
    let saved = await writePosts(prisma, [post, ...posts]);
    if (saved.length === posts.length) return res.status(400).json({ error: "That link can't be shown as a card" });
    // The card now has an id, so its picture has somewhere to live.
    const cover = await mirrorCover(saved[0]);
    if (cover) saved = await writePosts(prisma, saved);
    res.json({ ok: true, posts: saved, cover: !!cover });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/social-feed/posts/bulk { text } -> add a whole batch at once.
// Instagram and TikTok publish nothing we could subscribe to (their profile
// pages hand out no list of posts, by their own design), so the links have to
// come from a person. This is that job made cheap: paste a week's worth in one
// go, prose around them is fine, and pasting the same batch twice is harmless
// because a link already on the wall is skipped rather than doubled.
const BULK_AT_ONCE = 4; // how many we ask the platforms about in parallel

router.post("/social-feed/posts/bulk", async (req, res, next) => {
  try {
    const urls = extractUrls(req.body?.text ?? req.body?.urls);
    if (!urls.length) return res.status(400).json({ error: "No links found in what you pasted" });

    const existing = await readPosts(prisma);
    const known = new Set(existing.map((p) => p.url));
    const results = [];
    const fresh = [];

    // In small groups: each link costs the platform a request or three, and
    // firing twenty at once is both rude and a good way to get rate-limited.
    const todo = urls.filter((url) => {
      if (!known.has(url)) return true;
      results.push({ url, status: "duplicate" });
      return false;
    });
    for (let i = 0; i < todo.length; i += BULK_AT_ONCE) {
      const batch = todo.slice(i, i + BULK_AT_ONCE);
      const looked = await Promise.all(
        batch.map((url) => lookupPost(url).catch((e) => ({ url, error: e.message })))
      );
      for (const found of looked) {
        if (found.error) {
          results.push({ url: found.url, status: "failed", error: found.error });
          continue;
        }
        fresh.push({ ...found, postedAt: found.postedAt || new Date().toISOString() });
      }
    }

    // Newest additions on top, then everything that was already there.
    let saved = await writePosts(prisma, [...fresh, ...existing]);
    const added = saved.filter((p) => fresh.some((f) => f.url === p.url));
    // Ids exist now, so each picture has somewhere to live.
    for (const p of added) await mirrorCover(p);
    saved = await writePosts(prisma, saved);

    for (const p of added) {
      results.push({ url: p.url, status: "added", platform: p.platform, title: p.title, picture: !!p.coverUrl });
    }
    res.json({ ok: true, posts: saved, results });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/social-feed/posts/:id/refresh -> ask the platform again for
// the title and picture. The repair button for a card that lost its image.
router.post("/social-feed/posts/:id/refresh", async (req, res, next) => {
  try {
    const posts = await readPosts(prisma);
    const post = posts.find((p) => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    const fresh = await lookupPost(post.url);
    post.thumbUrl = fresh.thumbUrl || post.thumbUrl;
    post.embedUrl = fresh.embedUrl || post.embedUrl;
    post.aspect = fresh.aspect || null; // re-derived below from the picture
    // The admin's own title always wins — refreshing must not overwrite it.
    if (!post.title) post.title = fresh.title;
    const cover = await mirrorCover(post);
    res.json({ ok: true, posts: await writePosts(prisma, posts), cover: !!cover });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/admin/social-feed/posts/:id { post } -> edit one card in place.
router.put("/social-feed/posts/:id", async (req, res, next) => {
  try {
    const posts = await readPosts(prisma);
    const idx = posts.findIndex((p) => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "Post not found" });
    posts[idx] = { ...posts[idx], ...(req.body?.post || req.body), id: posts[idx].id };
    const saved = await writePosts(prisma, posts);
    res.json({ ok: true, posts: saved });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/social-feed/posts/:id
router.delete("/social-feed/posts/:id", async (req, res, next) => {
  try {
    const posts = await readPosts(prisma);
    const saved = await writePosts(prisma, posts.filter((p) => p.id !== req.params.id));
    res.json({ ok: true, posts: saved });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/social-feed/posts/:id/cover (multipart: file=<image>)
// The cover image for platforms that give us nothing — Instagram above all.
// It always wins over whatever thumbnail the platform reported.
router.post("/social-feed/posts/:id/cover", upload.single("file"), async (req, res, next) => {
  try {
    const posts = await readPosts(prisma);
    const post = posts.find((p) => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = LOGO_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Unsupported image type (use PNG, JPG, WEBP or SVG)" });
    if (!isSafeId(post.id)) return res.status(400).json({ error: "Invalid post id" });
    mkdirSync(SOCIAL_DIR, { recursive: true });
    const filename = `${post.id}${ext}`;
    const dest = safeUploadPath(SOCIAL_DIR, filename);
    if (!dest) return res.status(400).json({ error: "Invalid post id" });
    writeFileSync(dest, req.file.buffer);
    post.coverUrl = `/api/uploads/social/${filename}?v=${Date.now()}`;
    const saved = await writePosts(prisma, posts);
    res.json({ ok: true, coverUrl: post.coverUrl, posts: saved });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/social-feed/posts/:id/cover -> back to the platform's own
// thumbnail (or the plain card, when there is none).
router.delete("/social-feed/posts/:id/cover", async (req, res, next) => {
  try {
    const posts = await readPosts(prisma);
    const post = posts.find((p) => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    post.coverUrl = null;
    res.json({ ok: true, posts: await writePosts(prisma, posts) });
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
      where: { key: { in: ["live_timing_url", "live_cm_join_url", "live_stream_url"] } },
    });
    const get = (k) => rows.find((r) => r.key === k)?.value || "";
    res.json({
      liveTimingUrl: get("live_timing_url"),
      cmJoinUrl: get("live_cm_join_url"),
      streamUrl: get("live_stream_url"),
      defaults: LIVE_LINK_DEFAULTS,
    });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/live-links  { liveTimingUrl, cmJoinUrl, streamUrl }
// Empty live-timing URL falls back to the server-manager default; empty CM link
// hides that button, empty stream link hides the player. Bare values get
// https:// prefixed (CM's acstuff.ru scheme links are left untouched).
router.put("/live-links", async (req, res, next) => {
  try {
    const body = req.body || {};
    const clean = (v) => {
      let val = String(v ?? "").trim();
      if (val && !/^[a-z]+:\/\//i.test(val)) val = `https://${val}`;
      return val;
    };
    const map = {
      live_timing_url: clean(body.liveTimingUrl),
      live_cm_join_url: clean(body.cmJoinUrl),
      live_stream_url: clean(body.streamUrl),
    };
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

// PUT /api/admin/races/:id/honours
//   { poleDriverId | null, poleTimeMs | null,
//     fastestLapDriverId | null, fastestLapMs | null }
// Records a round's honours by hand — built for the archive seasons, where no
// AC data exists to derive them from. Pole is stored as grid = 1 on the chosen
// driver's row (the site's own definition of a pole everywhere: profiles,
// Hall of Fame, track history, achievements), the pole LAP as that row's
// qualiTimeMs (the column reserved for qualifying best laps — shown on the
// race facts). The fastest lap sets the raw-SQL flag (lib/raceHonours.js)
// and, when the lap time is known, the real bestLapMs — which then also joins
// the track records and season honours. Each time travels with its own honour.
// null clears an honour; clearing the fastest lap leaves imported laps alone.
router.put("/races/:id/honours", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    const { poleDriverId, poleTimeMs, fastestLapDriverId, fastestLapMs } = req.body || {};
    const rows = await prisma.raceResult.findMany({
      where: { raceId: race.id },
      select: { driverId: true, grid: true, bestLapMs: true },
    });
    // qualiTimeMs is raw-SQL managed (the generated client may not know it),
    // so the stored pole laps ride in via their own read.
    const qualiTimes = new Map();
    try {
      const qt = await prisma.$queryRawUnsafe(
        `SELECT "driverId", "qualiTimeMs" FROM "RaceResult" WHERE "raceId" = ? AND "qualiTimeMs" IS NOT NULL`,
        race.id
      );
      for (const r of qt) qualiTimes.set(r.driverId, Number(r.qualiTimeMs));
    } catch {
      /* column missing pre-migration */
    }
    const rowIds = new Set(rows.map((r) => r.driverId));
    for (const [label, id] of [["Pole", poleDriverId], ["Fastest lap", fastestLapDriverId]]) {
      if (id && !rowIds.has(id)) {
        return res.status(400).json({ error: `${label}: that driver has no result in this race` });
      }
    }
    const times = {};
    for (const [key, v, label] of [
      ["fl", fastestLapMs, "Fastest lap time"],
      ["pole", poleTimeMs, "Pole lap time"],
    ]) {
      if (v == null) {
        times[key] = null;
        continue;
      }
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n <= 0 || n > 1_800_000) {
        return res.status(400).json({ error: `${label} must be under 30 minutes` });
      }
      times[key] = n;
    }
    const ms = times.fl;
    const pms = times.pole;

    // Snapshot only when the save OVERWRITES stored data (demoting a previous
    // pole holder, replacing a stored lap or quali time): backfilling a blank
    // archive round then never floods the rotating backups, a correction is
    // still one file-copy away from being undone.
    const prevPole = rows.find((r) => r.grid === 1)?.driverId || null;
    const poleChanges = (poleDriverId || null) !== prevPole;
    const poleRow = poleDriverId ? rows.find((r) => r.driverId === poleDriverId) : null;
    const poleTimeChanges = !!poleRow && (qualiTimes.get(poleDriverId) ?? null) !== pms;
    const flRow = fastestLapDriverId ? rows.find((r) => r.driverId === fastestLapDriverId) : null;
    const lapChanges = !!flRow && (flRow.bestLapMs ?? null) !== ms;
    if (
      (poleChanges && prevPole) ||
      (lapChanges && flRow.bestLapMs != null) ||
      (poleTimeChanges && qualiTimes.has(poleDriverId))
    ) {
      await tryCreateBackup(prisma, `before-honours-r${race.number ?? "x"}`);
    }

    // Pole: exactly one grid-1 row per race; the previous holder is demoted to
    // an unknown grid slot and loses any recorded pole lap with it, the chosen
    // driver becomes grid 1.
    if (poleChanges) {
      if (prevPole) {
        await prisma.$executeRawUnsafe(
          `UPDATE "RaceResult" SET "qualiTimeMs" = NULL WHERE "raceId" = ? AND "driverId" = ?`,
          race.id,
          prevPole
        );
      }
      await prisma.raceResult.updateMany({ where: { raceId: race.id, grid: 1 }, data: { grid: null } });
      if (poleDriverId) {
        await prisma.raceResult.updateMany({
          where: { raceId: race.id, driverId: poleDriverId },
          data: { grid: 1 },
        });
      }
    }
    // The pole lap is written exactly as sent while a holder is set (null
    // clears a recorded time); clearing the pole was handled above.
    if (poleDriverId) {
      await prisma.$executeRawUnsafe(
        `UPDATE "RaceResult" SET "qualiTimeMs" = ? WHERE "raceId" = ? AND "driverId" = ?`,
        pms,
        race.id,
        poleDriverId
      );
    }

    // Fastest lap: clear the race's flags, then mark the holder. The time is
    // written exactly as sent (null clears a manual one) but only while a
    // holder is set; clearing the honour leaves stored lap times untouched.
    await prisma.$executeRawUnsafe(`UPDATE "RaceResult" SET "fastestLap" = 0 WHERE "raceId" = ?`, race.id);
    if (fastestLapDriverId) {
      await prisma.$executeRawUnsafe(
        `UPDATE "RaceResult" SET "fastestLap" = 1 WHERE "raceId" = ? AND "driverId" = ?`,
        race.id,
        fastestLapDriverId
      );
      await prisma.raceResult.updateMany({
        where: { raceId: race.id, driverId: fastestLapDriverId },
        data: { bestLapMs: ms },
      });
    }

    // Honours move career stats, the Hall of Fame and the rating curves, and
    // a first pole can unlock card editions and achievements.
    invalidateRecordsCache();
    invalidateRatingHistoryCache();
    invalidateCardRatingCache();
    notifyCardUnlocksForSeason(prisma, race.seasonId);
    res.json({ ok: true });
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
    // The id becomes the avatar's file name later on (routes/me.js).
    if (!isSafeId(driverId)) {
      return res.status(400).json({ error: "Driver id may only contain letters, digits, - and _" });
    }
    // Default to the season the chosen team belongs to (or the active season
    // of the series the admin is editing).
    let resolvedSeasonId = seasonId;
    if (!resolvedSeasonId) {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      resolvedSeasonId =
        team?.seasonId ||
        (await resolveSeasonId(prisma, undefined, { includePrivate: true, series: req.body?.series }));
    }
    // Same person twice in one season is almost always a mistake (e.g. the
    // attendance sign-up already auto-created them in the Reserve pool). A
    // same-name row in the target season therefore needs an explicit confirm
    // (`force`) — the error names the team so the admin can simply move the
    // existing row instead of creating a twin.
    const dupe = await prisma.driver.findFirst({
      where: { seasonId: resolvedSeasonId, name: { equals: name } },
      include: { team: { select: { name: true, tier: true } } },
    });
    // Same name sitting in the Reserve pool (e.g. auto-created by an
    // attendance sign-up): the target team gets THAT row moved over instead
    // of a twin, so their sign-ups and links survive on the same entry.
    const targetTeam = await prisma.team.findUnique({ where: { id: teamId }, select: { tier: true, name: true } });
    const reserveMove = dupe && dupe.team?.tier === 0 && targetTeam && targetTeam.tier !== 0;
    if (dupe && !req.body?.force) {
      return res.status(409).json({
        error: reserveMove
          ? `${dupe.name} is already in this season's Reserve pool. Confirm to move that entry into ${targetTeam.name} (their sign-ups are kept) instead of creating a duplicate.`
          : `${dupe.name} is already on this season's roster (${dupe.team?.name || "no team"}). ` +
            `Move that entry to the right team instead of creating a second one, or confirm to create a true namesake.`,
        needsConfirm: true,
      });
    }
    if (reserveMove) {
      const moved = await prisma.driver.update({
        where: { id: dupe.id },
        data: { teamId, tier: targetTeam.tier, isActive: true },
      });
      return res.status(200).json({ ...moved, movedFromReserve: true });
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
      include: { team: { select: { name: true, tier: true } } },
    });
    if (clash) {
      // In the Reserve pool (e.g. auto-created by an attendance sign-up):
      // MOVE that row into the team instead of creating a twin — their
      // sign-ups, market entries and links all ride along on the same row.
      if (clash.team?.tier === 0 && team.tier !== 0) {
        const moved = await prisma.driver.update({
          where: { id: clash.id },
          data: { teamId: team.id, tier: team.tier, isActive: true },
        });
        return res.status(200).json({ ...moved, movedFromReserve: true });
      }
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
    // Nothing captured from a race yet? The person may have proved their Steam
    // account themselves on the profile page while waiting for a roster row.
    // Ranked above the name fallback below: this one was confirmed by Steam.
    if (!steamId) {
      const discordId =
        source.discordUserId ||
        (linked.length
          ? (
              await prisma
                .$queryRawUnsafe(
                  `SELECT "discordUserId" FROM "Driver" WHERE "id" IN (${linked.map(() => "?").join(",")}) AND "discordUserId" IS NOT NULL LIMIT 1`,
                  ...linked
                )
                .catch(() => [])
            )[0]?.discordUserId || null
          : null);
      if (discordId) {
        const acct = await dbGetMember(prisma, discordId).catch(() => null);
        steamId = acct?.steamId || null;
      }
    }
    // Unlinked archive rows of the same name can donate too (the database
    // groups by name when no person link exists yet). Scoped to THIS series:
    // across series, two different people sharing a display name would hand
    // each other's Steam ID over, and the import only writes once, so the wrong
    // value would stick for good.
    if (!steamId) {
      const rows = await prisma
        .$queryRawUnsafe(
          `SELECT d."steamId" FROM "Driver" d
             JOIN "Season" s ON s."id" = d."seasonId"
            WHERE lower(d."name") = lower(?)
              AND d."steamId" IS NOT NULL
              AND s."seriesId" IS (SELECT "seriesId" FROM "Season" WHERE "id" = ?)
            LIMIT 1`,
          source.name,
          team.season.id
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
    const { name, discordName, teamId, tier, isActive, photoUrl, discordUserId, role, hideFromStandings, steamId, country } = req.body || {};
    // Nationality is normally the driver's own to set, on their profile after a
    // Discord login. Drivers who have never logged in cannot, so they have no
    // flag anywhere on the site and none on the result poster either. This lets
    // an admin fill it in for them. Lowercase ISO 3166-1 alpha-2, or "" to clear.
    if (country !== undefined && country !== "" && !/^[a-z]{2}$/i.test(String(country))) {
      return res.status(400).json({ error: "country must be a two-letter code, or empty" });
    }
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
    if (country !== undefined) data.country = String(country).toLowerCase() || null;
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
    // The Steam ID (SteamID64) the result import matches on. Normally captured
    // automatically from the first AC import, or carried over from the member's
    // own Steam link — but a wrong value used to be unfixable, because the
    // import only ever writes into an EMPTY field and would then report a
    // conflict after every race. Hence this editable field; "" clears it.
    // Raw-SQL column (see the note on attachSteamIds), so it is written after
    // the prisma update, like role and hideFromStandings.
    if (steamId !== undefined) {
      const v = String(steamId || "").trim();
      if (v && !isIndividualSteamId(v)) {
        return res.status(400).json({
          error:
            "A Steam ID is the 17-digit number of a personal account (steamcommunity.com/profiles/7656...). Note it is not the Discord ID.",
        });
      }
      // Unique PER SEASON, so only the same season can collide. Checked here to
      // name the other driver, instead of the generic unique-violation message
      // below, which talks about Discord IDs.
      if (v) {
        const clash = await prisma
          .$queryRawUnsafe(
            `SELECT "id", "name" FROM "Driver" WHERE "steamId" = ? AND "seasonId" IS ? AND "id" != ?`,
            v,
            driver.seasonId,
            driver.id
          )
          .catch(() => []);
        if (clash.length) {
          return res.status(409).json({
            error: `That Steam ID is already on ${clash[0].name} in this season. Clear it there first if the two entries are the same person.`,
          });
        }
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "Driver" SET "steamId" = ? WHERE "id" = ?`,
        v || null,
        driver.id
      );
      driver.steamId = v || null;
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

// DELETE /api/admin/drivers/:id -> remove ONE driver row from ITS season (the
// other seasons' rows of the same person stay). Guard rails:
//   - a row with race results can never be deleted (fix the results first, or
//     set the driver inactive / hidden instead) — deleting would corrupt
//     standings and history.
//   - attendance answers and driver-market entries DO go with the row; the
//     first call reports exactly what would be lost (needsConfirm) and the
//     admin retries with ?force=1 to proceed.
router.delete("/drivers/:id", async (req, res, next) => {
  try {
    const driver = await prisma.driver.findUnique({
      where: { id: req.params.id },
      include: {
        season: { select: { name: true } },
        team: { select: { name: true, tier: true } },
        _count: {
          select: { results: true, rsvps: true, seatInterests: true, seatOffersOffered: true, seatOffersFilled: true },
        },
      },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    const c = driver._count;
    if (c.results > 0) {
      return res.status(409).json({
        error:
          `${driver.name} has ${c.results} race result(s) in ${driver.season?.name || "this season"} and cannot be deleted. ` +
          `Remove the results first (Edit Results), or set the driver Inactive / hidden from standings instead.`,
      });
    }

    // A TEAM driver with attendance answers is never truly deleted: their
    // sign-ups are real intent (they may well race), so "removing" them from
    // the team DEMOTES the row to the season's Reserve pool instead — the
    // answers, market entries and person links all survive. Only a row
    // without answers (or one already in the Reserve pool, after an explicit
    // confirm with the numbers) is actually deleted.
    const demote = c.rsvps > 0 && driver.team?.tier !== 0 && driver.seasonId;

    if (!req.query.force) {
      if (demote) {
        return res.status(409).json({
          error:
            `${driver.name} (${driver.team?.name || "no team"}, ${driver.season?.name || "unknown season"}) has ` +
            `${c.rsvps} attendance answer(s), so they won't be deleted. They'll be moved to the Reserve pool instead, ` +
            `keeping their answers and market entries. Continue?`,
          needsConfirm: true,
        });
      }
      const bits = [];
      if (c.rsvps > 0) bits.push(`${c.rsvps} attendance answer(s)`);
      if (c.seatInterests > 0) bits.push(`${c.seatInterests} driver-market interest entr${c.seatInterests === 1 ? "y" : "ies"}`);
      if (c.seatOffersOffered > 0) bits.push(`${c.seatOffersOffered} seat offer(s) they made`);
      if (c.seatOffersFilled > 0) bits.push(`${c.seatOffersFilled} seat(s) they were picked to fill (those offers reopen)`);
      return res.status(409).json({
        error:
          `Remove ${driver.name} (${driver.team?.name || "no team"}, ${driver.season?.name || "unknown season"})?` +
          (bits.length ? ` This also deletes ${bits.join(", ")}.` : " No attendance answers or market entries hang on this entry.") +
          " Their entries in other seasons are not touched.",
        needsConfirm: true,
      });
    }

    if (demote) {
      const pool = await ensureReservePool(prisma, driver.seasonId);
      if (!pool) return res.status(409).json({ error: "Season not found" });
      await prisma.$transaction([
        // A demoted driver no longer holds a seat, so any offer THEY made is
        // cancelled (their interests as a reserve stay).
        prisma.seatOffer.updateMany({ where: { driverId: driver.id, status: "OPEN" }, data: { status: "CANCELLED" } }),
        prisma.driver.update({ where: { id: driver.id }, data: { teamId: pool.id, tier: 0 } }),
      ]);
      return res.json({ ok: true, demoted: true, keptRsvps: c.rsvps });
    }

    // Person-link first (raw table without FK cascade), then everything that
    // references the row, then the row itself.
    await dbUnlinkDriver(prisma, driver.id);
    await prisma.$transaction([
      prisma.raceRsvp.deleteMany({ where: { driverId: driver.id } }),
      prisma.seatInterest.deleteMany({ where: { driverId: driver.id } }),
      // Offers they made: drop them (any interests cascade with the offer).
      prisma.seatOffer.deleteMany({ where: { driverId: driver.id } }),
      // Offers they were chosen to FILL belong to another driver — keep those,
      // just un-pick the deleted reserve so the seat reads open again.
      prisma.seatOffer.updateMany({ where: { filledById: driver.id }, data: { filledById: null, status: "OPEN" } }),
      prisma.driver.delete({ where: { id: driver.id } }),
    ]);
    res.json({ ok: true, removed: { rsvps: c.rsvps, seatInterests: c.seatInterests, seatOffers: c.seatOffersOffered } });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/drivers/bulk-delete -> remove SEVERAL driver rows at once
// (same rules as the single delete above). Two-step like the single route:
// without force it only reports what would happen — per driver, including who
// is blocked by race results — and the UI shows that as ONE confirm; with
// force it deletes every deletable row and returns what was removed/skipped.
router.post("/drivers/bulk-delete", async (req, res, next) => {
  try {
    const ids = [...new Set((req.body?.ids || []).map(String))].filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "No drivers selected" });

    const rows = await prisma.driver.findMany({
      where: { id: { in: ids } },
      include: {
        season: { select: { name: true } },
        team: { select: { name: true, tier: true } },
        _count: {
          select: { results: true, rsvps: true, seatInterests: true, seatOffersOffered: true, seatOffersFilled: true },
        },
      },
    });
    if (!rows.length) return res.status(404).json({ error: "None of the selected drivers exist (already removed?)" });

    // Same rule as the single delete: a TEAM driver with attendance answers
    // is demoted to the Reserve pool (answers survive) instead of deleted.
    const isDemote = (d) => d._count.results === 0 && d._count.rsvps > 0 && d.team?.tier !== 0 && d.seasonId;
    const report = rows.map((d) => ({
      id: d.id,
      name: d.name,
      team: d.team?.name || null,
      season: d.season?.name || null,
      blocked: d._count.results > 0,
      demote: isDemote(d),
      results: d._count.results,
      rsvps: d._count.rsvps,
      marketEntries: d._count.seatInterests + d._count.seatOffersOffered,
      seatsToReopen: d._count.seatOffersFilled,
    }));

    if (!req.body?.force) {
      return res.status(409).json({ needsConfirm: true, drivers: report });
    }

    const demoted = [];
    const deleted = [];
    for (const d of rows) {
      if (d._count.results > 0) continue;
      if (isDemote(d)) {
        const pool = await ensureReservePool(prisma, d.seasonId);
        if (!pool) continue;
        await prisma.$transaction([
          prisma.seatOffer.updateMany({ where: { driverId: d.id, status: "OPEN" }, data: { status: "CANCELLED" } }),
          prisma.driver.update({ where: { id: d.id }, data: { teamId: pool.id, tier: 0 } }),
        ]);
        demoted.push(d.name);
        continue;
      }
      // Same order as the single delete: person-link first (raw table, no FK),
      // then dependents, then the row. One transaction per driver keeps a
      // mid-list failure from voiding the deletions already done.
      await dbUnlinkDriver(prisma, d.id);
      await prisma.$transaction([
        prisma.raceRsvp.deleteMany({ where: { driverId: d.id } }),
        prisma.seatInterest.deleteMany({ where: { driverId: d.id } }),
        prisma.seatOffer.deleteMany({ where: { driverId: d.id } }),
        prisma.seatOffer.updateMany({ where: { filledById: d.id }, data: { filledById: null, status: "OPEN" } }),
        prisma.driver.delete({ where: { id: d.id } }),
      ]);
      deleted.push(d.name);
    }
    res.json({
      ok: true,
      removed: deleted,
      demoted,
      blocked: rows.filter((d) => d._count.results > 0).map((d) => d.name),
    });
  } catch (e) {
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
    const [rows, drivers, activeSeasons, primarySeason, adminIds, stewardIds] = await Promise.all([
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
      getStewardDiscordIds(prisma),
    ]);
    const activeIds = new Set(activeSeasons.map((s) => s.id));
    // Whether the Steam ID has actually reached the roster row (raw column, so
    // read the way every other admin path reads it).
    await attachSteamIds(drivers);
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
        steamId: d.steamId || null,
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
      return {
        ...m,
        driver: shapeDriver(driver),
        isAdmin: adminIds.has(String(m.discordId)),
        isSteward: stewardIds.has(String(m.discordId)),
      };
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

// GET /api/admin/members/pending -> { unlinked, requests }
// Just the two numbers the admin navigation puts on the Members tab, so the
// badge doesn't have to pull the whole member list (every driver of every
// season) on each admin page load.
//   unlinked = login accounts no driver row carries the Discord id of,
//   requests = how many of those pressed "I want to race".
router.get("/members/pending", async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT COUNT(*) AS n,
             SUM(CASE WHEN m."raceRequestAt" IS NOT NULL THEN 1 ELSE 0 END) AS r
      FROM "MemberAccount" m
      WHERE NOT EXISTS (
        SELECT 1 FROM "Driver" d WHERE d."discordUserId" = m."discordId"
      )`;
    res.json({ unlinked: Number(rows[0]?.n || 0), requests: Number(rows[0]?.r || 0) });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/attention -> { feedback, reports, members, market, total }
// Everything waiting on an admin, as four numbers and their sum.
//
// The admin's own navigation fetches its badges tab by tab, which is right
// there: it needs the lists anyway. This is for the rest of the site, where a
// dot in the corner has to say "there is work" without pulling four lists on
// every page an admin loads. Numbers only, and one round trip.
//
// The rules are the ones the tabs themselves use, taken from the same helpers,
// because a dot that disagrees with the tab it points at is worse than no dot.
router.get("/attention", async (req, res, next) => {
  try {
    const [feedbackItems, reports, memberRows, market] = await Promise.all([
      dbListFeedback(prisma).catch(() => []),
      dbListReports(prisma).catch(() => []),
      prisma.$queryRaw`
        SELECT COUNT(*) AS n
        FROM "MemberAccount" m
        WHERE NOT EXISTS (
          SELECT 1 FROM "Driver" d WHERE d."discordUserId" = m."discordId"
        )`.catch(() => []),
      // A seat still on the market that somebody has actually put their hand up
      // for, on a race that has not been run. An offer nobody wants is not work,
      // and neither is one whose race is over: the market ignores those too.
      prisma.seatOffer
        .count({
          where: { status: "OPEN", race: { isCompleted: false }, interests: { some: {} } },
        })
        .catch(() => 0),
    ]);
    // Same predicate as GET /feedback: untouched, or the sender replied last.
    const feedback = feedbackItems.filter((i) => {
      if (i.status === "NEW") return true;
      const last = i.replies?.[i.replies.length - 1];
      return !!last && last.author === "SENDER";
    }).length;
    const open = reports.filter((r) => !REPORT_DECIDED.includes(r.status)).length;
    const members = Number(memberRows[0]?.n || 0);
    res.json({
      feedback,
      reports: open,
      members,
      market,
      total: feedback + open + members + market,
    });
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

// POST /api/admin/members/:discordId/steward { isSteward }
// Appoint somebody to steward: they can read EVERY incident report and answer
// in any of them, and nothing else changes for them. Judging incidents and
// running a league are different jobs, and handing over the PIN so somebody can
// look at a report hands over the results editor with it.
router.post("/members/:discordId/steward", async (req, res, next) => {
  try {
    const existing = await dbGetMember(prisma, req.params.discordId);
    if (!existing) return res.status(404).json({ error: "Account not found" });
    const on = !!req.body?.isSteward;
    await setSteward(prisma, req.params.discordId, on);
    res.json({ ok: true, isSteward: on });
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
    // Linked = their "I want to race" hand-raise (if any) is answered.
    await dbClearRaceRequest(prisma, req.params.discordId);
    // If they linked their Steam account while waiting for a driver row, the
    // proved id moves onto that row now, so the next result import matches them
    // by Steam GUID instead of by name.
    const steam = await applyMemberSteamId(prisma, req.params.discordId, driverId);
    res.json({ ok: true, steam });
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
    // A fresh driver answers their "I want to race" hand-raise (if any).
    await dbClearRaceRequest(prisma, req.params.discordId);
    // This is the main case for the member-side Steam link: they proved their
    // account weeks ago, the driver row only exists now. Seed it here.
    const steam = await applyMemberSteamId(prisma, req.params.discordId, driver.id);
    res.status(201).json({ ok: true, driver, steam });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/members/:discordId/unlink
router.post("/members/:discordId/unlink", async (req, res, next) => {
  try {
    // Take back what the link put there. The account's own Steam claim was
    // copied onto the driver row when it was linked; leaving it behind would
    // strand it on a row that is no longer this person's, and the per-season
    // uniqueness would then block linking them anywhere else. Only an id that
    // still MATCHES the claim is cleared, so a value captured from a real race
    // import (which may differ) is never touched.
    const account = await dbGetMember(prisma, req.params.discordId).catch(() => null);
    if (account?.steamId) {
      await prisma
        .$executeRawUnsafe(
          `UPDATE "Driver" SET "steamId" = NULL WHERE "discordUserId" = ? AND "steamId" = ?`,
          req.params.discordId,
          account.steamId
        )
        .catch(() => {});
    }
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

// GET /api/admin/discord/results-role -> { roleId }
// PUT /api/admin/discord/results-role  { roleId }   ("" clears it)
// The role every driver has, pinged at the top of a results post so the whole
// grid gets a notification. A snowflake id and nothing else: a role NAME does
// not ping, and anything that is not digits would go out as literal text.
router.get("/discord/results-role", async (req, res, next) => {
  try {
    res.json({ roleId: await getResultsRoleId(prisma) });
  } catch (e) {
    next(e);
  }
});

router.put("/discord/results-role", async (req, res, next) => {
  try {
    const raw = String(req.body?.roleId || "").trim();
    // Paste-friendly: accept the id, or the <@&id> Discord copies when you type
    // the role into a message and copy the text back out.
    const id = (/^<@&(\d+)>$/.exec(raw)?.[1] ?? raw).trim();
    if (id && !/^\d{5,25}$/.test(id)) {
      return res.status(400).json({
        error: "A role ID is the long number from Server Settings -> Roles -> Copy Role ID, not the role's name.",
      });
    }
    await setResultsRoleId(prisma, id);
    res.json({ ok: true, roleId: id || null });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/races/:id/results-post -> { text, short, mentions }
// Generated drafts of the Discord results message for this round, in both
// lengths, plus the names behind the mention ids so the admin's preview can
// show what Discord will show. Both are sent at once: the admin flips between
// them while writing, and a round trip per flip would make an editor that
// stutters. The admin edits before posting either way.
//
// The origin for the short version's link is the address the admin is LOOKING
// at, falling back to the one this request arrived on. In production they are
// the same string (one origin serves the site and the API), so the fallback is
// what normally runs. They differ only in development, where the API answers on
// its own port and the request-derived link would point at a page nobody visits.
//
// Taken as a bare origin and rebuilt from its parts, so what reaches the message
// is scheme + host + port and nothing else — never a path, query or credentials
// smuggled in through the parameter.
const postOrigin = (req) => {
  const asked = String(req.query.origin || "");
  if (asked) {
    try {
      const u = new URL(asked);
      if (u.protocol === "http:" || u.protocol === "https:") return u.origin;
    } catch {
      /* fall through to the request's own host */
    }
  }
  return `${req.protocol}://${req.get("host")}`;
};

router.get("/races/:id/results-post", async (req, res, next) => {
  try {
    const origin = postOrigin(req);
    const post = await buildResultsPost(prisma, req.params.id, {
      origin,
      roleId: await getResultsRoleId(prisma),
    });
    if (post == null) return res.status(404).json({ error: "Race not found or has no results yet" });
    res.json({ text: post.full, short: post.short, mentions: post.mentions });
  } catch (e) {
    next(e);
  }
});

// The championship table as a post, to the same channel and by the same rules.
// GET  /api/admin/standings-post?upTo=<round> -> { text, short, mentions }
// POST /api/admin/standings-post  (multipart: content + image0..imageN)
//
// The sheets are drawn in the BROWSER and sent along, exactly as the round's
// poster is — see the note on the results-post route below for why. A table
// longer than one sheet arrives as several pictures on ONE message, which is
// how a reader sees "places 1 to 20" rather than two posts an hour apart.
router.get("/standings-post", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, { includePrivate: true, series: req.query.series });
    const upTo = Number(req.query.upTo);
    const upToRound = Number.isFinite(upTo) && upTo > 0 ? Math.floor(upTo) : null;
    const origin = postOrigin(req);
    const roleId = await getResultsRoleId(prisma);
    const spots = (v, def) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.min(12, Math.floor(n)) : def;
    };
    // Which championship, and for the drivers' one which group and whether the
    // people who have not driven are on it — so the text is the same table the
    // sheets above it are.
    const post =
      req.query.of === "constructors"
        ? await buildConstructorsPost(prisma, seasonId, {
            upToRound,
            t1Rows: spots(req.query.t1Rows, 5),
            t2Rows: spots(req.query.t2Rows, 8),
            origin,
            roleId,
          })
        : await buildStandingsPost(prisma, seasonId, {
            upToRound,
            tier: ["all", "0", "1", "2"].includes(String(req.query.tier)) ? String(req.query.tier) : "all",
            withoutStarts: req.query.withoutStarts === "1",
            origin,
            roleId,
          });
    if (post == null) return res.status(404).json({ error: "No standings for this season yet" });
    res.json({ text: post.full, short: post.short, mentions: post.mentions });
  } catch (e) {
    next(e);
  }
});

router.post("/standings-post", upload.array("images", 10), async (req, res, next) => {
  try {
    const content = String(req.body?.content || "").trim();
    const files = req.files || [];
    if (!content && !files.length) return res.status(400).json({ error: "Message is empty" });
    if (files.some((f) => f.mimetype !== "image/png")) {
      return res.status(400).json({ error: "The sheets must be PNGs" });
    }
    const images = files.map((f, i) => ({ buffer: f.buffer, filename: `standings-${i + 1}.png` }));
    const result = await postToResultsChannel(prisma, content, images);
    if (result.skipped) return res.status(400).json({ error: "No results webhook configured" });
    if (!result.ok) return res.status(502).json({ error: result.reason || "Discord rejected the message" });
    res.json({ ok: true, messages: result.messages, attached: result.files });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/races/:id/results-post { content } -> send the (possibly
// edited) message to the results-channel webhook.
// Accepts JSON ({ content }) or multipart ({ content, image }). The image is
// the round's poster, drawn in the BROWSER and sent along with the message.
//
// Drawn there rather than here on purpose. Rendering it server-side would mean
// a headless Chromium living next to the site for one picture a week. And
// nothing is stored: each post draws the poster again from the current design
// and the current artwork, so changing either changes what goes out next time,
// including for a round that ran months ago.
router.post("/races/:id/results-post", upload.single("image"), async (req, res, next) => {
  try {
    const content = String(req.body?.content || "").trim();
    const image = req.file
      ? { buffer: req.file.buffer, filename: `${req.params.id}-result.png` }
      : null;
    if (!content && !image) return res.status(400).json({ error: "Message is empty" });
    if (req.file && req.file.mimetype !== "image/png") {
      return res.status(400).json({ error: "The graphic must be a PNG" });
    }
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    const result = await postToResultsChannel(prisma, content, image);
    if (result.skipped) return res.status(400).json({ error: "No results webhook configured" });
    if (!result.ok) return res.status(502).json({ error: result.reason || "Discord rejected the message" });
    res.json({ ok: true, messages: result.messages, attached: !!result.attached });
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
  const highlights = parseHighlightsUrl(body.highlightsUrl);
  if (highlights.error) return { error: highlights.error };
  if (highlights.ok) out.highlightsUrl = highlights.value;
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
  if (extras.highlightsUrl !== undefined) {
    await writeRaceHighlights(prisma, raceId, extras.highlightsUrl);
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
      return res.status(409).json({ error: "The active series cannot be hidden. Activate another series first" });
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
    const dest = safeUploadPath(SERIES_DIR, filename);
    if (!dest) return res.status(400).json({ error: "This series' id can't be used as a file name" });
    writeFileSync(dest, req.file.buffer);
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
      // teamDropWorst / teamDropMode / isPublic / isAnnounced / heroImageUrl /
      // cardsEnabled aren't in the generated client yet -> raw read.
      prisma.$queryRawUnsafe(`SELECT "id", "teamDropWorst", "teamDropMode", "isPublic", "isAnnounced", "heroImageUrl", "carImageUrl", "cardsEnabled" FROM "Season"`).catch(() => []),
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
            cardsEnabled: extra.cardsEnabled == null ? true : !!Number(extra.cardsEnabled),
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
  if (body.cardsEnabled !== undefined) out.cardsEnabled = body.cardsEnabled ? 1 : 0;
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
  if (raw.cardsEnabled !== undefined) {
    await prisma.$executeRawUnsafe(`UPDATE "Season" SET "cardsEnabled" = ? WHERE "id" = ?`, raw.cardsEnabled, seasonId);
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
    // Steam ids ride along (raw column, read the way the rest of this file does).
    // Without them the cloned roster starts every season blind: the result
    // import would fall back to matching display names until it re-captured a
    // GUID per driver, which is exactly what the id is meant to avoid. No
    // collision is possible, the target season is empty and the source already
    // holds at most one row per id.
    await attachSteamIds(sourceDrivers);
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
      if (d.steamId) {
        await prisma
          .$executeRawUnsafe(`UPDATE "Driver" SET "steamId" = ? WHERE "id" = ?`, d.steamId, newId)
          .catch(() => {});
      }
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
    const dest = safeUploadPath(SEASONS_DIR, filename);
    if (!dest) return res.status(400).json({ error: "This season's id can't be used as a file name" });
    writeFileSync(dest, req.file.buffer);
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
    const dest = safeUploadPath(SEASONS_DIR, filename);
    if (!dest) return res.status(400).json({ error: "This season's id can't be used as a file name" });
    writeFileSync(dest, req.file.buffer);
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
// GET /api/admin/teams/library?q=&seasonId=   -> teams from EVERY OTHER season
// Building next season's grid meant retyping each team by hand (name, a
// hand-invented unique id, tier, colour) and re-uploading its logo, for teams
// that already exist in the archive with all of that filled in. Cloning a whole
// season is the other extreme and drags along teams that are not coming back.
// This is the middle: search what the league has ever run and take the ones you
// want. Newest seasons first, and a team whose NAME is already on the target
// season is marked so it can be greyed out rather than imported twice.
router.get("/teams/library", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const targetSeasonId =
      req.query.seasonId || (await resolveSeasonId(prisma, undefined, { includePrivate: true, series: req.query.series }));
    const target = await prisma.season.findUnique({ where: { id: targetSeasonId } });
    // Same series only: a team from another championship is not a suggestion,
    // it is a mistake waiting to happen.
    const seasons = await prisma.season.findMany({
      where: { seriesId: target?.seriesId ?? null },
      orderBy: { number: "desc" },
    });
    const seasonById = new Map(seasons.map((s) => [s.id, s]));
    const existing = await prisma.team.findMany({ where: { seasonId: targetSeasonId } });
    const takenNames = new Set(existing.map((t) => t.name.trim().toLowerCase()));

    const teams = await prisma.team.findMany({
      where: { seasonId: { in: seasons.map((s) => s.id).filter((id) => id !== targetSeasonId) } },
    });
    const rows = teams
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
      .map((t) => ({
        id: t.id,
        name: t.name,
        tier: t.tier,
        color: t.color,
        logoUrl: t.logoUrl,
        seasonId: t.seasonId,
        seasonNumber: seasonById.get(t.seasonId)?.number ?? null,
        seasonName: seasonById.get(t.seasonId)?.name ?? null,
        alreadyHere: takenNames.has(t.name.trim().toLowerCase()),
      }))
      .sort(
        (a, b) =>
          (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0) || a.name.localeCompare(b.name)
      );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/teams/import  { fromTeamId, seasonId? }
// Copies ONE archived team into the season being edited, keeping its name, tier,
// colour and logo. The new id gets the target season's suffix so ids stay unique
// across seasons (same convention as clone-teams).
router.post("/teams/import", async (req, res, next) => {
  try {
    const { fromTeamId, seasonId } = req.body || {};
    if (!fromTeamId) return res.status(400).json({ error: "fromTeamId required" });
    const targetSeasonId =
      seasonId || (await resolveSeasonId(prisma, undefined, { includePrivate: true, series: req.body?.series }));
    const target = await prisma.season.findUnique({ where: { id: targetSeasonId } });
    if (!target) return res.status(404).json({ error: "Target season not found" });
    const source = await prisma.team.findUnique({ where: { id: fromTeamId } });
    if (!source) return res.status(404).json({ error: "Team not found" });
    if (source.seasonId === targetSeasonId) {
      return res.status(400).json({ error: "That team is already in this season" });
    }
    const clash = await prisma.team.findFirst({
      where: { seasonId: targetSeasonId, name: source.name },
    });
    if (clash) return res.status(409).json({ error: `${source.name} is already in this season` });

    // Strip any previous season suffix before adding this one, so a team
    // travelling S6 -> S7 -> S8 does not end up as "mclaren_s7_s8".
    const base = source.id.replace(/_s\d+$/i, "");
    let newId = `${base}_s${target.number}`;
    for (let n = 2; await prisma.team.findUnique({ where: { id: newId } }); n++) {
      newId = `${base}_s${target.number}_${n}`;
    }
    const team = await prisma.team.create({
      data: {
        id: newId,
        name: source.name,
        tier: source.tier,
        color: source.color,
        logoUrl: source.logoUrl,
        seasonId: targetSeasonId,
      },
    });
    res.status(201).json(team);
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "Team id already exists" });
    next(e);
  }
});

router.post("/teams", async (req, res, next) => {
  try {
    const { id, name, tier, color, seasonId } = req.body || {};
    if (!id || !name || tier === undefined || !color) {
      return res.status(400).json({ error: "id, name, tier, color required" });
    }
    // The id becomes the logo's file name later on, so keep it to plain
    // characters. Every existing team already fits this.
    if (!isSafeId(id)) {
      return res.status(400).json({ error: "Team id may only contain letters, digits, - and _" });
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
    const dest = safeUploadPath(TEAMS_DIR, filename);
    if (!dest) return res.status(400).json({ error: "This team's id can't be used as a file name" });
    writeFileSync(dest, req.file.buffer);
    // Cache-bust the URL so an updated logo shows immediately.
    const logoUrl = `/api/uploads/teams/${filename}?v=${Date.now()}`;
    await prisma.team.update({ where: { id: team.id }, data: { logoUrl } });
    res.json({ ok: true, logoUrl });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// TEAM ART — the car and the wide wordmark the result graphic draws with.
// See lib/teamArt.js for why this is a Setting blob and not two more columns.
// ---------------------------------------------------------------------------

// GET /api/admin/team-art -> { "<teamId>": { car, mark, badge } }
router.get("/team-art", async (req, res, next) => {
  try {
    res.json(await readTeamArt(prisma));
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/team-art/:id/:kind   (multipart: file=<image>)
// DELETE /api/admin/team-art/:id/:kind
router.post("/team-art/:id/:kind", upload.single("file"), async (req, res, next) => {
  try {
    const { id, kind } = req.params;
    if (!ART_KINDS.includes(kind)) return res.status(400).json({ error: "Unknown art kind" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = LOGO_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Unsupported image type (use PNG, JPG, WEBP or SVG)" });
    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) return res.status(404).json({ error: "Team not found" });

    mkdirSync(TEAM_ART_DIR, { recursive: true });
    const filename = `${team.id}-${kind}${ext}`;
    const dest = safeUploadPath(TEAM_ART_DIR, filename);
    if (!dest) return res.status(400).json({ error: "This team's id can't be used as a file name" });
    writeFileSync(dest, req.file.buffer);
    // Cache-bust, so replacing a car shows the new one straight away. The
    // graphic reads these through a canvas, where a stale cached image would
    // otherwise survive until the browser felt like letting go of it.
    const url = `/api/uploads/team-art/${filename}?v=${Date.now()}`;
    res.json({ ok: true, art: await writeTeamArt(prisma, team.id, kind, url) });
  } catch (e) {
    next(e);
  }
});

router.delete("/team-art/:id/:kind", async (req, res, next) => {
  try {
    const { id, kind } = req.params;
    if (!ART_KINDS.includes(kind)) return res.status(400).json({ error: "Unknown art kind" });
    // The file is left on disk: the Health tab's clean-up already lists unused
    // uploads, and deleting here would race a graphic still being drawn.
    res.json({ ok: true, art: await writeTeamArt(prisma, id, kind, null) });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/team-art/:id/country { country: "de" | "" }
// The flag a team flies on the constructors poster. Teams have no nationality
// of their own in the database, so it is kept with their pictures.
router.put("/team-art/:id/country", async (req, res, next) => {
  try {
    res.json({ ok: true, art: await writeTeamCountry(prisma, req.params.id, req.body?.country) });
  } catch (e) {
    next(e);
  }
});

// How those cars are cropped in the podium tiles. One setting for all three,
// read by the poster and written by the sliders beside the preview, plus the
// framings that were worth keeping. The PUT patches, so the sliders and the
// preset list can each save their own half without erasing the other.
// GET /api/admin/poster-framing -> { zoom, x, y, presets: [{ name, zoom, x, y }] }
// PUT /api/admin/poster-framing   { zoom?, x?, y?, presets? }
router.get("/poster-framing", async (req, res, next) => {
  try {
    res.json(await readCarFraming(prisma));
  } catch (e) {
    next(e);
  }
});

router.put("/poster-framing", async (req, res, next) => {
  try {
    res.json(await writeCarFraming(prisma, req.body));
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
    const dest = safeUploadPath(TRACKS_DIR, filename);
    if (!dest) return res.status(400).json({ error: "Invalid track key" });
    writeFileSync(dest, req.file.buffer);
    const mapImageUrl = `/api/uploads/tracks/${filename}?v=${Date.now()}`;
    const current = await readTrackInfo(prisma, key);
    const saved = await writeTrackInfo(prisma, key, { ...current, mapImageUrl });
    res.json({ ok: true, mapImageUrl, content: saved });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/races/:id/attendance { state: "auto" | "open" | "closed" }
// Decide by hand whether a race takes sign-ups, whatever the general rule says.
router.put("/races/:id/attendance", async (req, res, next) => {
  try {
    const state = String(req.body?.state || "auto");
    if (!ATTENDANCE_STATES.includes(state)) return res.status(400).json({ error: "Unknown state" });
    const race = await prisma.race.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    res.json({ ok: true, overrides: await writeAttendanceOverride(prisma, race.id, state) });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/races/:id/attendance-visibility { hidden: true | false }
// Take a race off the attendance page altogether, or put it back. Nothing else
// about the race changes: it keeps its date, its calendar card and its results.
router.put("/races/:id/attendance-visibility", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    const hidden = req.body?.hidden === true;
    const list = await writeHiddenRace(prisma, race.id, hidden);
    res.json({ ok: true, hidden, hiddenRaceIds: list });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// RACE PHOTOS
// The gallery for a round: an admin uploads the night's screenshots, the round
// page shows them as a carousel. Files on disk under uploads/races, the order
// and the captions in a Setting blob (lib/racePhotos.js).
// ---------------------------------------------------------------------------

// No SVG here, unlike the logo uploads: a gallery is photographs, and an SVG is
// a document that can carry script. GIF is in, because a three-second clip of
// the crash is exactly what people post.
const PHOTO_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
// Uploads are named by us. The race id only rides along to make the folder
// readable by hand; the Setting blob is what actually maps file -> round.
const photoFileTag = (raceId) => String(raceId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "race";

async function loadRace(id) {
  // Enough of the race for the "photos are up" notification to name and link it.
  return prisma.race.findUnique({
    where: { id },
    select: { id: true, number: true, track: true, seasonId: true, isSpecialEvent: true, isCompleted: true },
  });
}

// The admin's view of a gallery: the public shape plus each file's size on
// disk, so the Photos tab can say what a picture actually costs. Only here —
// the public round page has no use for byte counts.
function withAdminPhotoInfo(photos) {
  return photos.map((p) => {
    let bytes = null;
    try {
      const dest = safeUploadPath(RACES_DIR, p.file);
      if (dest && existsSync(dest)) bytes = statSync(dest).size;
    } catch {
      /* a missing file shows as size unknown, not as a broken tab */
    }
    return { id: p.id, url: racePhotoUrl(p.file), caption: p.caption, bytes };
  });
}

// GET /api/admin/races/:id/photos -> { photos: [{ id, url, caption, bytes }] }
router.get("/races/:id/photos", async (req, res, next) => {
  try {
    res.json({ photos: withAdminPhotoInfo(await readRacePhotos(prisma, req.params.id)) });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/races/:id/photos  (multipart: files=<image>[]) — add to the
// gallery. Appends, so uploading a second batch keeps the first one.
router.post("/races/:id/photos", upload.array("files", MAX_PHOTOS), async (req, res, next) => {
  try {
    const race = await loadRace(req.params.id);
    if (!race) return res.status(404).json({ error: "Race not found" });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No file uploaded" });

    const current = await readRacePhotos(prisma, race.id);
    const room = MAX_PHOTOS - current.length;
    if (room <= 0) {
      return res.status(400).json({ error: `This round already has the maximum of ${MAX_PHOTOS} photos` });
    }
    // Everything that doesn't fit is refused by name rather than dropped in
    // silence — an admin who picked 20 files needs to know which 5 missed out.
    const taking = files.slice(0, room);
    const skipped = files.slice(room).map((f) => f.originalname);

    mkdirSync(RACES_DIR, { recursive: true });
    const added = [];
    const rejected = [];
    for (const file of taking) {
      const ext = PHOTO_EXT[file.mimetype];
      if (!ext) {
        rejected.push(file.originalname);
        continue;
      }
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const filename = `${photoFileTag(race.id)}-${id}${ext}`;
      const dest = safeUploadPath(RACES_DIR, filename);
      if (!dest) {
        rejected.push(file.originalname);
        continue;
      }
      writeFileSync(dest, file.buffer);
      added.push({ id, file: filename, caption: "" });
    }
    if (!added.length) {
      return res.status(400).json({ error: "Unsupported image type (use PNG, JPG, WEBP or GIF)" });
    }
    const saved = await writeRacePhotos(prisma, race.id, [...current, ...added]);
    // Ring the bell — once per race (deduped), and only when the round already
    // has its result: the gallery renders under the results, so on an upcoming
    // round the link would lead to a page without it.
    //
    // ?silent=1 skips it. Filling in the galleries of seasons gone by is not
    // news, and without this every old round the admin works through would
    // ring the whole grid's bell. Nothing is recorded either, so the round can
    // still announce itself later if it ever earns it.
    const silent = req.query.silent === "1";
    if (race.isCompleted && !silent) notifyRacePhotosAdded(prisma, race, added.length);
    res.json({
      ok: true,
      photos: withAdminPhotoInfo(saved),
      added: added.length,
      // Named so the admin UI can say exactly what didn't make it.
      rejected,
      skipped,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/races/:id/photos/:photoId/replace  (multipart: file=<image>)
// Swap the FILE behind one gallery entry, keeping its id, caption and place in
// the running order. The admin tab uses it to re-upload a shrunk copy of a
// photo that went up at full weight: without this, fixing one picture would
// mean deleting it and adding it again at the end of the gallery.
router.post("/races/:id/photos/:photoId/replace", upload.single("file"), async (req, res, next) => {
  try {
    const race = await loadRace(req.params.id);
    if (!race) return res.status(404).json({ error: "Race not found" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = PHOTO_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Unsupported image type (use PNG, JPG, WEBP or GIF)" });

    const current = await readRacePhotos(prisma, race.id);
    const idx = current.findIndex((p) => p.id === String(req.params.photoId));
    if (idx === -1) return res.status(404).json({ error: "No such photo" });

    mkdirSync(RACES_DIR, { recursive: true });
    // A NEW file name, never the old one: the served URL carries no cache
    // buster, so writing over the same name would leave every browser showing
    // the old picture for as long as its 30-day cache lasts.
    const fresh = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const filename = `${photoFileTag(race.id)}-${fresh}${ext}`;
    const dest = safeUploadPath(RACES_DIR, filename);
    if (!dest) return res.status(400).json({ error: "Could not store the file" });
    writeFileSync(dest, req.file.buffer);

    const old = current[idx];
    const next_ = current.map((p, i) => (i === idx ? { ...p, file: filename } : p));
    const saved = await writeRacePhotos(prisma, race.id, next_);
    // The old file goes only once the blob points at the new one.
    try {
      const prev = safeUploadPath(RACES_DIR, old.file);
      if (prev && existsSync(prev)) unlinkSync(prev);
    } catch {
      /* an orphan file is not worth failing the swap over */
    }
    res.json({ ok: true, photos: withAdminPhotoInfo(saved) });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/races/:id/photos  { photos: [{ id, caption }] }
// The whole gallery in one go: the order is the order sent, a caption is
// whatever is sent with it, and anything left out is deleted (file included).
router.put("/races/:id/photos", async (req, res, next) => {
  try {
    const race = await loadRace(req.params.id);
    if (!race) return res.status(404).json({ error: "Race not found" });
    const current = await readRacePhotos(prisma, race.id);
    const byId = new Map(current.map((p) => [p.id, p]));

    const wanted = Array.isArray(req.body?.photos) ? req.body.photos : [];
    const next_ = [];
    const keptIds = new Set();
    for (const w of wanted) {
      const known = byId.get(String(w?.id));
      // Only rows that already exist survive: a client cannot invent a file
      // name and have the gallery point at it.
      if (!known || keptIds.has(known.id)) continue;
      keptIds.add(known.id);
      next_.push({ ...known, caption: typeof w?.caption === "string" ? w.caption : known.caption });
    }

    const saved = await writeRacePhotos(prisma, race.id, next_);
    // Files only go once the blob no longer references them, so a failed write
    // can never leave the gallery pointing at something that isn't there.
    for (const p of current) {
      if (keptIds.has(p.id)) continue;
      const dest = safeUploadPath(RACES_DIR, p.file);
      try {
        if (dest && existsSync(dest)) unlinkSync(dest);
      } catch {
        /* the row is gone either way; an orphan file is not worth a 500 */
      }
    }
    res.json({ ok: true, photos: withAdminPhotoInfo(saved) });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// RACE MAIN-CARD PHOTO
// The picture behind the Home hero while this round is the latest one. Same
// mechanics as the season photo it overrides (POST /seasons/:id/hero above),
// one folder further along: the file lives with the round's gallery photos and
// the URL on Race.heroImageUrl (lib/raceHero.js).
// ---------------------------------------------------------------------------

// POST /api/admin/races/:id/hero  (multipart: file=<image>)
router.post("/races/:id/hero", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    // The gallery's list, minus GIF: this one is a background behind text, and
    // an animation under the podium is a different decision from a clip in the
    // gallery. No SVG either, for the reason given there.
    const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" }[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Unsupported image type (use PNG, JPG or WEBP)" });
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });

    mkdirSync(RACES_DIR, { recursive: true });
    const filename = `${photoFileTag(race.id)}-hero${ext}`;
    const dest = safeUploadPath(RACES_DIR, filename);
    if (!dest) return res.status(400).json({ error: "This race's id can't be used as a file name" });
    writeFileSync(dest, req.file.buffer);
    // Cache-bust, or a replaced photo keeps showing the old one.
    const heroImageUrl = `/api/uploads/races/${filename}?v=${Date.now()}`;
    await writeRaceHero(prisma, race.id, heroImageUrl);
    res.json({ ok: true, heroImageUrl });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/races/:id/hero -> back to the season's photo. The file is
// left where it is, exactly like the season photo's clear: a replacement
// overwrites it, and an orphan costs nothing.
router.delete("/races/:id/hero", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    await writeRaceHero(prisma, race.id, null);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/attendance-history -> what people answered for the races that
// have already run. The answers are never deleted when a result is saved, so
// this is a straight read of what was there at the time.
//
// The reason to keep it rather than just count it: an answer is a promise, and
// the interesting column is where the promise and the result disagree. Someone
// who accepted and never appeared cost the grid a seat; someone who raced
// without ever answering is a planning problem of a different kind. Both are
// worked out here by comparing the sign-up against the classification.
router.get("/attendance-history", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, { includePrivate: true, series: req.query.series });
    if (!seasonId) return res.json({ races: [] });

    const races = await prisma.race.findMany({
      where: { seasonId, isCompleted: true },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      include: {
        rsvps: { include: { driver: { select: { id: true, name: true } } } },
        // The driver comes along because the "raced without answering" list can
        // only get its names from here — those people have no sign-up row.
        results: { select: { driverId: true, status: true, driver: { select: { name: true } } } },
      },
    });
    const types = await readRaceTypes(prisma, races.map((r) => r.id));

    const out = races
      // A race nobody ever answered has nothing to show; listing it would bury
      // the ones that do under a wall of empty rows.
      .filter((race) => race.rsvps.length > 0)
      .map((race) => {
        const grouped = { ACCEPTED: [], DECLINED: [], TENTATIVE: [] };
        for (const r of race.rsvps) {
          (grouped[r.status] || (grouped[r.status] = [])).push({ driverId: r.driverId, name: r.driver.name });
        }
        // "Raced" means classified in any way — a DNF still turned up.
        const started = new Set(race.results.filter((r) => r.status !== "DNS").map((r) => r.driverId));
        const answered = new Set(race.rsvps.map((r) => r.driverId));
        return {
          id: race.id,
          number: race.number,
          type: types.get(race.id) || (race.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP"),
          track: race.track,
          date: race.date,
          counts: {
            ACCEPTED: grouped.ACCEPTED.length,
            DECLINED: grouped.DECLINED.length,
            TENTATIVE: grouped.TENTATIVE.length,
          },
          rsvps: grouped,
          // Said yes, never started.
          noShows: grouped.ACCEPTED.filter((d) => !started.has(d.driverId)).map((d) => d.name),
          // Started without ever answering.
          unannounced: race.results
            .filter((r) => r.status !== "DNS" && !answered.has(r.driverId))
            .map((r) => r.driver?.name)
            .filter(Boolean),
          starters: started.size,
        };
      });
    res.json({ races: out });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/attendance-missing?raceId=<id> -> who is still silent.
//
// The attendance page answers "who is coming". The question an admin actually
// acts on the night before is the other one: who has said nothing at all, so
// they can be chased in Discord. That cannot be read off the sign-up lists,
// because silence leaves no row anywhere — it is the roster MINUS the answers.
//
// Split into full-timers and reserves because they mean different things: a
// Tier-1/2 driver not answering is a hole in the grid, a reserve not answering
// is just a reserve who isn't needed. Deactivated rows are left out entirely —
// nobody should be chased for a season they are no longer in.
//
// The Discord id per driver is their EFFECTIVE one (own row, or inherited
// through the person links), the same value the results post @mentions with —
// so a member whose login still points at last season's row is still reachable.
router.get("/attendance-missing", async (req, res, next) => {
  try {
    const raceId = String(req.query.raceId || "");
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    if (!race) return res.status(404).json({ error: "Race not found" });

    const [roster, rsvps, nameOverrides] = await Promise.all([
      prisma.driver.findMany({
        where: { seasonId: race.seasonId, isActive: true },
        include: { team: { select: { name: true, tier: true, color: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.raceRsvp.findMany({ where: { raceId: race.id }, select: { driverId: true, status: true } }),
      getNameOverrides(prisma),
    ]);

    const answered = new Set(rsvps.map((r) => r.driverId));
    const silent = roster.filter((d) => !answered.has(d.id));
    const discordIds = await discordIdsForDrivers(prisma, silent.map((d) => d.id)).catch(() => new Map());

    const shape = (d) => ({
      driverId: d.id,
      name: nameOverrides.get(d.id)?.displayName || d.name,
      discordName: d.discordName,
      // null = no login of theirs is known, so they cannot be @mentioned. The
      // admin can still search the handle above by hand.
      discordUserId: discordIds.get(d.id) || null,
      team: d.team?.name || null,
      teamColor: d.team?.color || null,
      tier: d.team?.tier ?? d.tier,
    });
    // The row's TEAM tier decides, not the driver's own: a Tier-2 driver parked
    // in the Reserve pool is a reserve this season, and that is the roster the
    // grid is built from.
    const isReserve = (d) => (d.team?.tier ?? d.tier) === 0;
    // Tier 1 first, then Tier 2, teammates together, alphabetical inside a team.
    // Sorted here rather than in the browser so the list arrives in the order it
    // is read in: chasing is a per-team job ("Renault: both of them"), and an
    // alphabetical mix of the whole grid hides exactly that.
    const byTeamThenName = (a, b) =>
      (a.tier ?? 9) - (b.tier ?? 9) ||
      (a.team || "").localeCompare(b.team || "") ||
      a.name.localeCompare(b.name);

    res.json({
      race: { id: race.id, number: race.number, track: race.track, date: race.date },
      counts: {
        answered: answered.size,
        roster: roster.length,
        fullTime: roster.filter((d) => !isReserve(d)).length,
        reserve: roster.filter(isReserve).length,
      },
      missing: {
        fullTime: silent.filter((d) => !isReserve(d)).map(shape).sort(byTeamThenName),
        // The reserve pool is one "team", so a team sort would say nothing —
        // they stay alphabetical, which is how you look a name up in a list.
        reserve: silent.filter(isReserve).map(shape),
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/attendance-gates -> the per-race overrides an admin has set.
router.get("/attendance-gates", async (req, res, next) => {
  try {
    res.json(await readAttendanceOverrides(prisma));
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
      include: {
        season: { select: { name: true } },
        // seatOffers used to be missing here, and it is the one relation that
        // routinely survives a team with nothing else on it: a Driver Market
        // listing stays on file after it is filled or cancelled. The guard
        // passed, the delete hit the foreign key, and the admin got a raw
        // "Foreign key constraint violated" with nothing to act on.
        _count: { select: { drivers: true, results: true, constructorScores: true, seatOffers: true } },
      },
    });
    if (!team) return res.status(404).json({ error: "Team not found" });

    const c = team._count;
    const where = `${team.name}${team.season?.name ? ` (${team.season.name})` : ""}`;

    // Real history. None of this may be thrown away by deleting a team, and
    // the message names what it actually found instead of a vague "or".
    const hard = [];
    if (c.drivers > 0) hard.push(`${c.drivers} driver(s) in its seats`);
    if (c.results > 0) hard.push(`${c.results} race result(s) subbed for it`);
    if (c.constructorScores > 0) hard.push(`${c.constructorScores} constructor score(s)`);
    if (hard.length) {
      return res.status(409).json({
        error: `${where} still has ${hard.join(" and ")}. Move those first, then delete the team.`,
      });
    }

    // Driver Market listings are the team's own paperwork: an offer for a seat
    // at a team that no longer exists is meaningless, and leaving it behind
    // would put a phantom team on the market page. So it goes WITH the team —
    // after the admin has been told it exists.
    if (c.seatOffers > 0 && !req.query.force) {
      return res.status(409).json({
        error:
          `Delete ${where}? It has no drivers and no results, but ${c.seatOffers} driver-market seat ` +
          `offer(s) point at it. Those will be deleted with the team.`,
        needsConfirm: true,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.seatOffer.deleteMany({ where: { teamId: team.id } });
      await tx.team.delete({ where: { id: team.id } });
    });
    res.json({ ok: true, seatOffersRemoved: c.seatOffers });
  } catch (e) {
    // Belt and braces for a relation nobody has added to the count above yet:
    // an admin should never be handed a raw Prisma foreign-key message.
    if (e?.code === "P2003" || /Foreign key constraint/i.test(e?.message || "")) {
      return res.status(409).json({
        error: "Something in the league still points at this team, so it can't be deleted yet.",
      });
    }
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

// DELETE /api/admin/downloads/:id[?file=1] -> remove the catalogue entry, and
// with ?file=1 the uploaded file as well.
//
// Removing the entry alone stays the default and stays non-destructive. But it
// was the ONLY option, and uploads never overwrite, so every replaced pack and
// every mistaken multi-gigabyte upload stayed on the volume forever with nothing
// in the admin able to see it, let alone remove it. External links have no file
// of their own, so `file=1` is simply a no-op for them.
router.delete("/downloads/:id", async (req, res, next) => {
  try {
    const alsoFile = req.query.file === "1" || req.query.file === "true";
    const row = alsoFile ? await dbGetDownload(prisma, req.params.id) : null;
    await dbDeleteDownload(prisma, req.params.id);
    const fileDeleted = alsoFile && row?.fileName ? deleteStoredFile(row.fileName) : false;
    res.json({ ok: true, fileDeleted });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/downloads/orphans -> files on disk no catalogue entry uses.
// The clean-up view for everything the old delete left behind.
router.get("/downloads/orphans", async (req, res, next) => {
  try {
    const rows = await dbListDownloads(prisma);
    const files = listOrphanFiles(rows.map((r) => r.fileName));
    res.json({ files, totalBytes: files.reduce((a, f) => a + (f.size || 0), 0) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/downloads/orphans/:fileName -> delete one unused file.
// Guarded twice: resolveDownloadPath refuses anything that escapes the folder,
// and a file still referenced by a catalogue entry is rejected outright, so a
// stale list in a long-open tab can never take out a live download.
router.delete("/downloads/orphans/:fileName", async (req, res, next) => {
  try {
    const name = req.params.fileName;
    const rows = await dbListDownloads(prisma);
    if (rows.some((r) => r.fileName === name)) {
      return res.status(409).json({ error: "That file belongs to a download in the catalogue" });
    }
    if (!deleteStoredFile(name)) return res.status(404).json({ error: "File not found" });
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

// --- Incident reports (stewarding) -------------------------------------------
// Filed by members (routes/reports.js) or, later, by the in-game webPenalty
// app. The office reads the thread, decides, and records the decision here.
//
// Deciding does NOT write the penalty into the classification. What is stored
// is what was decided; putting the seconds on the driver stays a separate act
// in the results editor, which is the one place that owns the points. See the
// note at the top of lib/reports.js.

// How far into its round each report happened, in seconds — the figure a
// steward drags the replay's timeline to.
//
// Worked out at READ time, not stored at insert time, because the two things it
// needs arrive at different moments: a report is filed during the race, and the
// session's start only becomes knowable when the result file is imported
// afterwards. A pinned contact already carries its own `contactSecond` from the
// archive and keeps it; everything else, above all every report fired from
// inside the race, gets one derived here as soon as the round is imported.
function withSessionSecond(reports, races) {
  const byId = new Map(races.map((r) => [r.id, r]));
  // One archive read per ROUND, not per report: a busy round can carry a dozen.
  const startOf = new Map();
  // The figure a report already carries, used when the archive cannot supply
  // one. For a report pinned to a contact after the race that IS the archive's
  // own arithmetic and is exact; for one fired from inside the race it was read
  // off the live board mid-session (routes/reports.js POST /ingest) and is
  // right to a second or two, so it is flagged as approximate — a steward
  // scrubbing to it should know whether to expect the incident on the frame or
  // a moment either side of it.
  const stored = (r) =>
    r.contactSecond != null
      ? { ...r, sessionSecond: r.contactSecond, sessionSecondApprox: r.source === "INGAME" }
      : r;
  return reports.map((r) => {
    const race = r.raceId ? byId.get(r.raceId) : null;
    // Derive from the archive whenever it can be read, and fall back to the
    // stored figure only when it cannot. For a pinned contact the two are the
    // same arithmetic on the same anchor, so this costs nothing — and it means a
    // correction to the anchor reaches reports that were filed before it. The
    // first version measured from the green flag rather than the start of the
    // session, which left every stored figure short by the grid wait.
    if (!race || !r.incidentAt || race.number == null || race.season?.number == null) {
      return stored(r);
    }
    if (!startOf.has(race.id)) {
      let start = null;
      try {
        start = sessionStartForRound(race.season.number, race.number);
      } catch {
        start = null;
      }
      startOf.set(race.id, start);
    }
    const start = startOf.get(race.id);
    if (!start) return stored(r);
    const second = Math.round(new Date(r.incidentAt).getTime() / 1000 - start);
    // A negative figure means the report's clock and the round's archive
    // disagree about which session this was — showing "-4:12 into the race"
    // would be worse than showing nothing, and the figure the report came in
    // with is the better answer if it has one.
    return second >= 0 ? { ...r, sessionSecond: second, sessionSecondApprox: false } : stored(r);
  });
}

router.get("/reports", async (req, res, next) => {
  try {
    const reports = await dbListReports(prisma);
    // The races they belong to, so the tab can group by round without the
    // browser fetching the calendar and joining it by hand.
    const ids = [...new Set(reports.map((r) => r.raceId).filter(Boolean))];
    const races = ids.length
      ? await prisma.race.findMany({
          where: { id: { in: ids } },
          select: { id: true, number: true, track: true, date: true, season: { select: { number: true } } },
        })
      : [];
    res.json({
      reports: withSessionSecond(reports, races),
      races,
      open: reports.filter((r) => !REPORT_DECIDED.includes(r.status)).length,
      // Which of the decided ones still have to be entered in a classification.
      // Counted here rather than in the browser so the tab badge and the panel
      // in the results editor cannot disagree about it.
      pendingPenalties: reports.filter((r) => r.status === "PENALTY" && r.penaltySeconds > 0).length,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/reports/:id", async (req, res, next) => {
  try {
    const report = await dbGetReport(prisma, req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    const voices = await dbThreadVoices(prisma, report.id, report);
    // The same replay anchor the list carries, so opening a report never shows
    // less than the row it was opened from.
    const race = report.raceId
      ? await prisma.race
          .findUnique({
            where: { id: report.raceId },
            select: { id: true, number: true, track: true, date: true, season: { select: { number: true } } },
          })
          .catch(() => null)
      : null;
    const [anchored] = withSessionSecond([report], race ? [race] : []);
    res.json({
      report: { ...anchored, reporterTeam: voices.get(String(report.reporterDiscordId || "")) || null },
      // At the desk, "mine" means the office: a PIN admin has no Discord id
      // to match on, and every message written from here is the stewards'.
      messages: (
        await dbMessages(prisma, report.id, req.user?.discordId || null, voices)
      ).map((m) => ({ ...m, mine: m.mine || m.author === "ADMIN" })),
      viewers: await dbViewers(prisma, report.id),
      attachments: await dbAttachments(prisma, report.id),
    });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/reports/:id  { status, verdict?, penaltySeconds? }
// The whole decision in ONE call, deliberately: the drivers are told the moment
// this lands, and a decision sent in three pieces means they are told the
// outcome before the reasoning has been typed.
router.put("/reports/:id", async (req, res, next) => {
  try {
    const report = await dbGetReport(prisma, req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    const b = req.body || {};
    res.json({ ok: true, report: await dbDecideReport(prisma, report, b) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// POST /api/admin/reports/:id/messages  { body }
// The stewards writing in a thread. Its own endpoint rather than the member
// one, because a PIN admin has no Discord login behind them: the member route
// works out who you are from your account and would turn them away. Here the
// office is the author by definition.
router.post("/reports/:id/messages", attachmentUpload.array("files", 4), async (req, res, next) => {
  try {
    const report = await dbGetReport(prisma, req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    const { messageId } = await dbAddMessage(prisma, report, {
      author: "ADMIN",
      discordId: req.user?.discordId || null,
      name: req.user?.driverName || req.user?.discordName || null,
      body: req.body?.body,
      allowEmpty: (req.files || []).length > 0,
    });
    for (const f of req.files || []) {
      await saveAttachment(prisma, { report, messageId, file: f, uploaderDiscordId: req.user?.discordId || null });
    }
    res.json({
      ok: true,
      messages: (
        await dbMessages(prisma, report.id, req.user?.discordId || null, await dbThreadVoices(prisma, report.id, report))
      ).map((m) => ({ ...m, mine: m.mine || m.author === "ADMIN" })),
      attachments: await dbAttachments(prisma, report.id),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// GET /api/admin/reports/:id/files/:attId — the stewards' side of the same
// gated download. Behind requireAdmin like everything else in this router, so
// a PIN admin (who has no Discord login) can open what the drivers attached.
router.get("/reports/:id/files/:attId", async (req, res, next) => {
  try {
    const report = await dbGetReport(prisma, req.params.id);
    if (!report) return res.status(404).json({ error: "Not found" });
    await serveAttachment(prisma, res, report.id, req.params.attId);
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/races/:id/report-penalties -> what the stewards decided for
// this round. The results editor shows it beside its own penalty column: the
// decision here never writes into the classification (on purpose), so this is
// the only thing standing between "we agreed five seconds" and a championship
// that never heard about them.
router.get("/races/:id/report-penalties", async (req, res, next) => {
  try {
    const decided = await dbDecidedForRace(prisma, req.params.id);
    res.json({ decided });
  } catch (e) {
    next(e);
  }
});

// Letting somebody else into one thread (a witness, a team mate). Per report,
// never a blanket permission.
router.post("/reports/:id/viewers", async (req, res, next) => {
  try {
    let { discordId, name, driverId } = req.body || {};
    // Picked from the roster: resolve the driver to the id their login uses,
    // through the person links like everything else, so an admin never has to
    // go and copy an 18-digit number out of Discord.
    if (driverId) {
      const d = await prisma.driver.findUnique({ where: { id: String(driverId) }, select: { id: true, name: true } });
      if (!d) return res.status(400).json({ error: "No such driver" });
      const map = await discordIdsForDrivers(prisma, [d.id]).catch(() => new Map());
      discordId = map.get(d.id) || null;
      name = name || d.name;
      if (!discordId) {
        return res.status(400).json({
          error: `${d.name} has never signed in with Discord, so there is no account to let in.`,
        });
      }
    }
    if (!/^\d{5,25}$/.test(String(discordId || ""))) {
      return res.status(400).json({ error: "That is not a Discord user ID" });
    }
    const viewers = await dbAddViewer(prisma, req.params.id, discordId, name);
    // Tell them, otherwise being let in is a thing that happened silently and
    // they only find out if they happen to look.
    await dbCreateNotification(prisma, {
      type: "REPORT",
      title: "You were added to an incident report",
      body: "The stewards have let you read an incident report.",
      link: `/reports?id=${req.params.id}`,
      recipientId: String(discordId),
      dedupeKey: `report_viewer:${req.params.id}:${discordId}`,
    }).catch(() => {});
    res.json({ ok: true, viewers });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.delete("/reports/:id/viewers/:discordId", async (req, res, next) => {
  try {
    res.json({ ok: true, viewers: await dbRemoveViewer(prisma, req.params.id, req.params.discordId) });
  } catch (e) {
    next(e);
  }
});

// GET/PUT /api/admin/reports-retention { days }
// How long a DECIDED report keeps its pictures. 0 = forever, the default.
// Sweeping on save means "did that work" is answered immediately rather than
// within the hour.
router.get("/reports-retention", async (req, res, next) => {
  try {
    res.json({ days: await readFileRetentionDays(prisma), choices: RETENTION_CHOICES });
  } catch (e) {
    next(e);
  }
});

router.put("/reports-retention", async (req, res, next) => {
  try {
    const days = await writeFileRetentionDays(prisma, req.body?.days);
    const swept = await sweepReportFiles(prisma).catch(() => ({ removed: 0 }));
    res.json({ ok: true, days, removed: swept.removed });
  } catch (e) {
    next(e);
  }
});

// GET/PUT /api/admin/reports-ingest — the in-game webPenalty app's key.
//
// Until a key is saved, POST /api/reports/ingest answers 503 to everything, so
// this switch IS the feature's on/off. Generated here rather than typed: it is
// a bearer token that has to travel in a URL (the app cannot set headers), so
// it should be long and random and never something a human chose.
router.get("/reports-ingest", async (req, res, next) => {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "report_ingest_key" } }).catch(() => null);
    const key = row?.value || "";
    res.json({ configured: !!key, key: key || null });
  } catch (e) {
    next(e);
  }
});

router.put("/reports-ingest", async (req, res, next) => {
  try {
    // "" switches in-game reporting off again.
    const on = req.body?.enabled !== false;
    const value = on ? randomUUID().replace(/-/g, "") : "";
    await prisma.setting.upsert({
      where: { key: "report_ingest_key" },
      create: { key: "report_ingest_key", value },
      update: { value },
    });
    res.json({ ok: true, configured: !!value, key: value || null });
  } catch (e) {
    next(e);
  }
});

// The pictures go with it. A private conversation that has been deleted but
// left its clips in a folder has not been deleted.
router.delete("/reports/:id", async (req, res, next) => {
  try {
    removeAttachmentFiles(req.params.id, await dbDeleteReport(prisma, req.params.id));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- Feedback (bug reports & feature wishes from the site) -------------------
// Written by anyone through the floating Feedback button (routes/feedback.js);
// read, sorted and worked through here. Private throughout — a report can name
// a driver or quote something said in Discord, so it never leaves this tab.

router.get("/feedback", async (req, res, next) => {
  try {
    const items = await dbListFeedback(prisma);
    // The tab's badge counts everything the office still owes an answer: reports
    // nobody has touched, plus threads where the sender wrote back last (which
    // can sit under an entry that was long since marked done).
    const needsAttention = (i) => {
      if (i.status === "NEW") return true;
      const last = i.replies[i.replies.length - 1];
      return !!last && last.author === "SENDER";
    };
    res.json({ items, newCount: items.filter(needsAttention).length });
  } catch (e) {
    next(e);
  }
});

router.patch("/feedback/:id", async (req, res, next) => {
  try {
    const existing = await dbGetFeedback(prisma, req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const item = await dbUpdateFeedback(prisma, req.params.id, {
      status: req.body?.status,
      adminNote: req.body?.adminNote,
    });
    res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
});

router.delete("/feedback/:id", async (req, res, next) => {
  try {
    await dbDeleteFeedback(prisma, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Answer a piece of feedback. The reply lands in the sender's notification bell
// with a link to their own /feedback page, where they can write back — so this
// is a conversation, not a receipt. Only works for a sender who was signed in;
// a logged-out one left a contact line instead and has to be reached there.
// `status` may ride along, since answering and filing usually happen in one go.
router.post("/feedback/:id/reply", async (req, res, next) => {
  try {
    const entry = await dbGetFeedback(prisma, req.params.id);
    if (!entry) return res.status(404).json({ error: "Not found" });
    if (!entry.discordId) {
      return res.status(400).json({
        error: "This was sent without a login, so there's no account to answer to.",
      });
    }
    const reply = await dbAddFeedbackReply(prisma, {
      feedbackId: entry.id,
      author: "ADMIN",
      // A designated Discord admin signs with their name; the PIN admin has no
      // name to give, so the thread simply says it came from the league office.
      authorName: req.user?.driverName || req.user?.discordName || null,
      body: req.body?.body,
    });
    if (req.body?.status !== undefined) {
      await dbUpdateFeedback(prisma, entry.id, { status: req.body.status });
    }
    // Never make the admin's request wait on (or fail with) a bell write.
    notifySenderOfReply(prisma, entry, reply).catch(() => {});
    res.json({ ok: true, item: await dbGetFeedback(prisma, entry.id) });
  } catch (e) {
    next(e);
  }
});

export default router;
