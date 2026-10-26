import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import prisma from "../db.js";
import { requireAdmin } from "../auth.js";
import { getSettings, saveSettings } from "../lib/settings.js";
import { parseAcResult } from "../lib/acResult.js";
import { UPLOAD_DIR } from "../config.js";
import { restartLive } from "../live/relay.js";

const router = Router();
router.use("/admin", requireAdmin);

const FILES_DIR = path.join(UPLOAD_DIR, "files");
const IMAGES_DIR = path.join(UPLOAD_DIR, "images");
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

// Stored under a random name, so an upload can never overwrite another file
// or climb out of the folder; the original name is kept for the download.
const safeExt = (name) => (path.extname(name || "").toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [""])[0];
const storage = (dir) =>
  multer.diskStorage({
    destination: dir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomBytes(6).toString("hex")}${safeExt(file.originalname)}`),
  });
const fileUpload = multer({ storage: storage(FILES_DIR), limits: { fileSize: 500 * 1024 * 1024 } });
// No SVG: it can carry script and would be served from our own address.
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const imageUpload = multer({
  storage: storage(IMAGES_DIR),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, IMAGE_EXT.includes(safeExt(file.originalname))),
});

const id = (v) => Number(v) || 0;
const text = (v, max = 200) => (v == null ? "" : String(v).trim().slice(0, max));
const optText = (v, max = 200) => text(v, max) || null;
const optInt = (v) => (v === "" || v == null ? null : Number.isInteger(Number(v)) ? Number(v) : null);
const color = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v || "")) ? String(v).toLowerCase() : null);

// Prisma's "record not found" and "unique constraint" become readable answers.
function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.code === "P2025") return res.status(404).json({ error: "Not found." });
      if (err.code === "P2002") return res.status(409).json({ error: `Already taken: ${err.meta?.target ?? "value"}.` });
      console.error(err);
      res.status(500).json({ error: err.message || "Something went wrong." });
    }
  };
}

// ---- Settings ---------------------------------------------------------------

router.get("/admin/settings", wrap(async (_req, res) => res.json(await getSettings())));

router.put("/admin/settings", wrap(async (req, res) => {
  const before = await getSettings();
  const after = await saveSettings(req.body);
  if (before.liveWsUrl !== after.liveWsUrl || before.liveOrigin !== after.liveOrigin) restartLive();
  res.json(after);
}));

router.post("/admin/logo", imageUpload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "PNG, JPG or WebP up to 3 MB." });
  const old = (await getSettings()).logoUrl;
  const settings = await saveSettings({ logoUrl: `/api/uploads/images/${req.file.filename}` });
  removeUpload(old);
  res.json(settings);
}));

router.delete("/admin/logo", wrap(async (_req, res) => {
  const old = (await getSettings()).logoUrl;
  const settings = await saveSettings({ logoUrl: null });
  removeUpload(old);
  res.json(settings);
}));

function removeUpload(url) {
  const m = /^\/api\/uploads\/(images|files)\/([\w.-]+)$/.exec(url || "");
  if (!m) return;
  fs.rm(path.join(m[1] === "images" ? IMAGES_DIR : FILES_DIR, m[2]), { force: true }, () => {});
}

// ---- Seasons ----------------------------------------------------------------

router.get("/admin/seasons", wrap(async (_req, res) => {
  res.json(await prisma.season.findMany({ orderBy: { id: "desc" }, include: { _count: { select: { races: true } } } }));
}));

async function makeCurrent(seasonId) {
  await prisma.$transaction([
    prisma.season.updateMany({ data: { isCurrent: false } }),
    prisma.season.update({ where: { id: seasonId }, data: { isCurrent: true } }),
  ]);
}

router.post("/admin/seasons", wrap(async (req, res) => {
  const name = text(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: "A season needs a name." });
  const first = (await prisma.season.count()) === 0;
  const season = await prisma.season.create({ data: { name } });
  if (first || req.body?.isCurrent) await makeCurrent(season.id);
  res.json(season);
}));

router.put("/admin/seasons/:id", wrap(async (req, res) => {
  const data = {};
  if (req.body?.name != null) data.name = text(req.body.name, 80) || "Season";
  const season = await prisma.season.update({ where: { id: id(req.params.id) }, data });
  if (req.body?.isCurrent) await makeCurrent(season.id);
  res.json(season);
}));

router.delete("/admin/seasons/:id", wrap(async (req, res) => {
  await prisma.season.delete({ where: { id: id(req.params.id) } });
  res.json({ ok: true });
}));

// ---- Teams ------------------------------------------------------------------

router.get("/admin/teams", wrap(async (_req, res) => {
  res.json(await prisma.team.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { drivers: true, results: true } } } }));
}));

function teamData(body) {
  const data = {};
  if (body.name != null) data.name = text(body.name, 80);
  if (body.color !== undefined) data.color = color(body.color);
  if (body.archived !== undefined) data.archived = !!body.archived;
  return data;
}

router.post("/admin/teams", wrap(async (req, res) => {
  const data = teamData(req.body || {});
  if (!data.name) return res.status(400).json({ error: "A team needs a name." });
  res.json(await prisma.team.create({ data }));
}));

router.put("/admin/teams/:id", wrap(async (req, res) => {
  const data = teamData(req.body || {});
  if (data.name === "") return res.status(400).json({ error: "A team needs a name." });
  res.json(await prisma.team.update({ where: { id: id(req.params.id) }, data }));
}));

router.delete("/admin/teams/:id", wrap(async (req, res) => {
  await prisma.team.delete({ where: { id: id(req.params.id) } });
  res.json({ ok: true });
}));

// ---- Drivers ----------------------------------------------------------------

router.get("/admin/drivers", wrap(async (_req, res) => {
  res.json(
    await prisma.driver.findMany({
      orderBy: { name: "asc" },
      include: { team: true, user: true, _count: { select: { results: true } } },
    }),
  );
}));

function driverData(body) {
  const data = {};
  if (body.name != null) data.name = text(body.name, 80);
  if (body.number !== undefined) data.number = optInt(body.number);
  if (body.country !== undefined) data.country = optText(body.country, 2)?.toUpperCase() ?? null;
  if (body.steamGuid !== undefined) data.steamGuid = optText(body.steamGuid, 40);
  if (body.teamId !== undefined) data.teamId = optInt(body.teamId);
  if (body.userId !== undefined) data.userId = optInt(body.userId);
  return data;
}

router.post("/admin/drivers", wrap(async (req, res) => {
  const data = driverData(req.body || {});
  if (!data.name) return res.status(400).json({ error: "A driver needs a name." });
  res.json(await prisma.driver.create({ data }));
}));

router.put("/admin/drivers/:id", wrap(async (req, res) => {
  const data = driverData(req.body || {});
  if (data.name === "") return res.status(400).json({ error: "A driver needs a name." });
  res.json(await prisma.driver.update({ where: { id: id(req.params.id) }, data }));
}));

router.delete("/admin/drivers/:id", wrap(async (req, res) => {
  await prisma.driver.delete({ where: { id: id(req.params.id) } });
  res.json({ ok: true });
}));

// ---- Members (Discord accounts) ---------------------------------------------

router.get("/admin/users", wrap(async (_req, res) => {
  res.json(await prisma.user.findMany({ orderBy: { createdAt: "desc" }, include: { driver: true } }));
}));

// Links a Discord account to a driver (or unlinks it with driverId null).
router.put("/admin/users/:id", wrap(async (req, res) => {
  const userId = id(req.params.id);
  const driverId = optInt(req.body?.driverId);
  await prisma.$transaction(async (tx) => {
    await tx.driver.updateMany({ where: { userId }, data: { userId: null } });
    if (driverId) await tx.driver.update({ where: { id: driverId }, data: { userId } });
  });
  res.json({ ok: true });
}));

router.delete("/admin/users/:id", wrap(async (req, res) => {
  await prisma.user.delete({ where: { id: id(req.params.id) } });
  res.json({ ok: true });
}));

// ---- Races ------------------------------------------------------------------

router.get("/admin/races", wrap(async (req, res) => {
  res.json(
    await prisma.race.findMany({
      where: { seasonId: id(req.query.season) },
      orderBy: [{ round: "asc" }, { startsAt: "asc" }],
      include: { _count: { select: { results: true, signups: true } } },
    }),
  );
}));

function raceData(body) {
  const data = {};
  if (body.name != null) data.name = text(body.name, 120);
  if (body.track != null) data.track = text(body.track, 120);
  if (body.round != null) data.round = optInt(body.round) ?? 1;
  if (body.notes !== undefined) data.notes = optText(body.notes, 5000);
  if (body.pointsMultiplier != null) {
    const m = Number(body.pointsMultiplier);
    data.pointsMultiplier = Number.isFinite(m) && m >= 0 ? m : 1;
  }
  if (body.startsAt != null) {
    const d = new Date(body.startsAt);
    if (!Number.isNaN(d.getTime())) data.startsAt = d;
  }
  return data;
}

router.post("/admin/races", wrap(async (req, res) => {
  const seasonId = id(req.body?.seasonId);
  const data = raceData(req.body || {});
  if (!seasonId || !data.name || !data.startsAt) return res.status(400).json({ error: "Season, name and start time are needed." });
  if (data.round == null) data.round = (await prisma.race.count({ where: { seasonId } })) + 1;
  res.json(await prisma.race.create({ data: { track: "", ...data, seasonId } }));
}));

router.put("/admin/races/:id", wrap(async (req, res) => {
  res.json(await prisma.race.update({ where: { id: id(req.params.id) }, data: raceData(req.body || {}) }));
}));

router.delete("/admin/races/:id", wrap(async (req, res) => {
  await prisma.race.delete({ where: { id: id(req.params.id) } });
  res.json({ ok: true });
}));

// ---- Results ----------------------------------------------------------------

router.get("/admin/races/:id/results", wrap(async (req, res) => {
  res.json(
    await prisma.result.findMany({
      where: { raceId: id(req.params.id) },
      orderBy: { position: "asc" },
      include: { driver: true, team: true },
    }),
  );
}));

// Step 1 of an import: read the file and say who is who. Nothing is saved.
// Each row gets the driver it would be booked on: the Steam id first, then
// the name; `driverId: null` means a new driver would be created.
router.post("/admin/races/:id/import/preview", wrap(async (req, res) => {
  const race = await prisma.race.findUnique({ where: { id: id(req.params.id) } });
  if (!race) return res.status(404).json({ error: "Race not found." });
  let parsed;
  try {
    parsed = parseAcResult(req.body?.file, await getSettings());
  } catch (err) {
    return res.status(400).json({ error: err.message || "Could not read the file." });
  }
  const drivers = await prisma.driver.findMany({ include: { team: true } });
  const teams = await prisma.team.findMany();
  const byGuid = new Map(drivers.filter((d) => d.steamGuid).map((d) => [d.steamGuid, d]));
  const byName = new Map(drivers.map((d) => [d.name.toLowerCase(), d]));
  const teamByName = new Map(teams.map((t) => [t.name.toLowerCase(), t]));
  const rows = parsed.rows.map((row) => {
    const match = (row.guid && byGuid.get(row.guid)) || byName.get(row.name.toLowerCase()) || null;
    const fileTeam = row.team ? teamByName.get(row.team.toLowerCase()) : null;
    return {
      ...row,
      driverId: match?.id ?? null,
      matchedBy: match ? (row.guid && match.steamGuid === row.guid ? "steam" : "name") : null,
      teamId: match?.teamId ?? fileTeam?.id ?? null,
    };
  });
  res.json({ type: parsed.type, track: parsed.track, rows, replaces: await prisma.result.count({ where: { raceId: race.id } }) });
}));

// Step 2: save the rows as the race's results, replacing any there were.
router.post("/admin/races/:id/import", wrap(async (req, res) => {
  const raceId = id(req.params.id);
  const race = await prisma.race.findUnique({ where: { id: raceId } });
  if (!race) return res.status(404).json({ error: "Race not found." });
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: "No rows to import." });
  const statuses = ["FIN", "DNF", "DSQ", "DNS"];

  await prisma.$transaction(async (tx) => {
    await tx.result.deleteMany({ where: { raceId } });
    const used = new Set();
    for (const [i, row] of rows.entries()) {
      let driverId = optInt(row.driverId);
      if (!driverId) {
        // A new driver. Their Steam id may already sit on someone (the admin
        // picked "new" on purpose), so it is only stored when it is free.
        const guid = optText(row.guid, 40);
        const taken = guid ? await tx.driver.findUnique({ where: { steamGuid: guid } }) : null;
        const created = await tx.driver.create({
          data: { name: text(row.name, 80) || "Unknown driver", steamGuid: taken ? null : guid, teamId: optInt(row.teamId) },
        });
        driverId = created.id;
      } else if (row.guid) {
        // Remember the Steam id for the next import if the driver has none yet.
        const d = await tx.driver.findUnique({ where: { id: driverId } });
        const free = !(await tx.driver.findUnique({ where: { steamGuid: String(row.guid) } }));
        if (d && !d.steamGuid && free) await tx.driver.update({ where: { id: driverId }, data: { steamGuid: String(row.guid) } });
      }
      if (used.has(driverId)) throw new Error(`A driver appears twice in the result (row ${i + 1}).`);
      used.add(driverId);
      await tx.result.create({
        data: {
          raceId,
          driverId,
          teamId: optInt(row.teamId),
          position: i + 1,
          status: statuses.includes(row.status) ? row.status : "FIN",
          laps: optInt(row.laps) ?? 0,
          totalTimeMs: optInt(row.totalTimeMs),
          bestLapMs: optInt(row.bestLapMs),
          carModel: optText(row.carModel, 120),
        },
      });
    }
    await tx.race.update({ where: { id: raceId }, data: { importedAt: new Date() } });
  });
  res.json({ ok: true });
}));

router.put("/admin/results/:id", wrap(async (req, res) => {
  const b = req.body || {};
  const data = {};
  if (b.status != null && ["FIN", "DNF", "DSQ", "DNS"].includes(b.status)) data.status = b.status;
  if (b.teamId !== undefined) data.teamId = optInt(b.teamId);
  if (b.laps != null) data.laps = optInt(b.laps) ?? 0;
  if (b.pointsAdjust != null) data.pointsAdjust = Number(b.pointsAdjust) || 0;
  if (b.bestLapMs !== undefined) data.bestLapMs = optInt(b.bestLapMs);
  res.json(await prisma.result.update({ where: { id: id(req.params.id) }, data }));
}));

// New finishing order: { order: [resultId, ...] }, top to bottom.
router.put("/admin/races/:id/order", wrap(async (req, res) => {
  const raceId = id(req.params.id);
  const order = (Array.isArray(req.body?.order) ? req.body.order : []).map(id);
  const existing = await prisma.result.findMany({ where: { raceId }, select: { id: true } });
  if (order.length !== existing.length || !existing.every((r) => order.includes(r.id))) {
    return res.status(400).json({ error: "The order has to list every result of the race once." });
  }
  // Two passes, so no two rows share a position half way through.
  await prisma.$transaction([
    ...order.map((rid, i) => prisma.result.update({ where: { id: rid }, data: { position: 1000 + i } })),
    ...order.map((rid, i) => prisma.result.update({ where: { id: rid }, data: { position: i + 1 } })),
  ]);
  res.json({ ok: true });
}));

router.delete("/admin/races/:id/results", wrap(async (req, res) => {
  const raceId = id(req.params.id);
  await prisma.result.deleteMany({ where: { raceId } });
  await prisma.race.update({ where: { id: raceId }, data: { importedAt: null } });
  res.json({ ok: true });
}));

router.delete("/admin/signups/:raceId/:userId", wrap(async (req, res) => {
  await prisma.signup.deleteMany({ where: { raceId: id(req.params.raceId), userId: id(req.params.userId) } });
  res.json({ ok: true });
}));

// ---- Downloads --------------------------------------------------------------

router.get("/admin/downloads", wrap(async (_req, res) => {
  res.json(await prisma.download.findMany({ orderBy: [{ order: "asc" }, { id: "asc" }] }));
}));

router.post("/admin/downloads/link", wrap(async (req, res) => {
  const url = text(req.body?.url, 500);
  const title = text(req.body?.title, 120);
  if (!title || !/^https?:\/\//.test(url)) return res.status(400).json({ error: "A title and an http(s) link are needed." });
  const order = await prisma.download.count();
  res.json(await prisma.download.create({ data: { title, url, description: optText(req.body?.description, 1000), order } }));
}));

router.post("/admin/downloads/file", fileUpload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file." });
  const order = await prisma.download.count();
  const title = text(req.body?.title, 120) || req.file.originalname;
  res.json(
    await prisma.download.create({
      data: {
        title,
        description: optText(req.body?.description, 1000),
        url: `/api/uploads/files/${req.file.filename}`,
        fileName: req.file.filename,
        sizeBytes: req.file.size,
        order,
      },
    }),
  );
}));

router.put("/admin/downloads/:id", wrap(async (req, res) => {
  const b = req.body || {};
  const data = {};
  if (b.title != null) data.title = text(b.title, 120) || "Download";
  if (b.description !== undefined) data.description = optText(b.description, 1000);
  if (b.order != null) data.order = optInt(b.order) ?? 0;
  if (b.url != null && /^https?:\/\//.test(text(b.url, 500))) data.url = text(b.url, 500);
  res.json(await prisma.download.update({ where: { id: id(req.params.id) }, data }));
}));

router.delete("/admin/downloads/:id", wrap(async (req, res) => {
  const d = await prisma.download.delete({ where: { id: id(req.params.id) } });
  if (d.fileName) removeUpload(d.url);
  res.json({ ok: true });
}));

export default router;
