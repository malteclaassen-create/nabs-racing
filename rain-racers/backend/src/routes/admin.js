import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import prisma from "../db.js";
import { requireAdmin } from "../auth.js";
import { getSettings, saveSettings, parsePointsList } from "../lib/settings.js";
import { parseAcResult } from "../lib/acResult.js";
import { orderWithPenalties, MAX_RACES } from "../lib/points.js";
import { attendance, teamAt } from "../lib/stats.js";
import { teamsAtRound, recomputeResultTeams, seasonRaces } from "../lib/seasonData.js";
import { UPLOAD_DIR } from "../config.js";
import { restartLive } from "../live/relay.js";
import { loadHistory } from "../lib/history.js";

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
const STATUSES = ["FIN", "DNF", "DSQ", "DNS"];
// The results of race 1, 2, ... of a round are the sessions R1, R2, ...
const sessionParam = (v) => {
  const m = /^R([1-9])$/.exec(String(v || "").toUpperCase());
  return m && Number(m[1]) <= MAX_RACES ? `R${m[1]}` : "R1";
};
const isQuali = (v) => String(v || "").toUpperCase() === "QUALIFY";
// A points table typed as "25, 18, 15" (empty = none of its own).
const tableJson = (v) => {
  if (v == null || String(v).trim() === "") return null;
  const list = parsePointsList(v);
  return list.length ? JSON.stringify(list) : null;
};
// The season's tables for rounds of 2, 3, ... races: { "2": "35, 29" } (one
// table for every race) or { "2": ["8, 7", "25, 18"] } (one per race; an empty
// one pays the season's table).
const raceTablesJson = (v) => {
  if (!v || typeof v !== "object") return null;
  const out = {};
  for (let n = 2; n <= MAX_RACES; n++) {
    const entry = v[n];
    if (Array.isArray(entry) && entry.length && !entry.every((x) => typeof x === "number")) {
      const list = entry.slice(0, n).map((t) => (tableJson(t) ? JSON.parse(tableJson(t)) : null));
      if (list.some(Boolean)) out[n] = list;
    } else if (tableJson(entry)) out[n] = JSON.parse(tableJson(entry));
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
};
// A picture: one uploaded here, or a link to one elsewhere (https).
const imageRef = (v) => {
  const t = text(v, 500);
  return /^\/api\/uploads\/images\/[\w.-]+$/.test(t) || /^https:\/\//.test(t) ? t : null;
};
// The sessions of a round's day, as [{ label, at, length }].
const timetableJson = (v) => {
  if (!Array.isArray(v)) return null;
  const rows = v
    .map((x) => {
      const at = new Date(x?.at);
      return { label: text(x?.label, 40), at: Number.isNaN(at.getTime()) ? null : at.toISOString(), length: optText(x?.length, 30) };
    })
    .filter((x) => x.label)
    .slice(0, 12);
  return rows.length ? JSON.stringify(rows) : null;
};

// Prisma's "record not found" and "unique constraint" become readable answers.
function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.code === "P2025") return res.status(404).json({ error: "Not found." });
      if (err.code === "P2002") return res.status(409).json({ error: `Already taken: ${err.meta?.target ?? "value"}.` });
      console.error(err);
      res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
    }
  };
}
const fail = (status, message) => Object.assign(new Error(message), { status });

// ---- Settings ---------------------------------------------------------------

router.get("/admin/settings", wrap(async (_req, res) => res.json(await getSettings())));

router.put("/admin/settings", wrap(async (req, res) => {
  const before = await getSettings();
  const after = await saveSettings(req.body);
  if (before.liveWsUrl !== after.liveWsUrl || before.liveOrigin !== after.liveOrigin) restartLive();
  res.json(after);
}));

// The league's series, seasons and calendars from Grid Finder and YouTube
// (series that already exist are left alone).
router.post("/admin/history", wrap(async (_req, res) => {
  const result = await loadHistory();
  restartLive();
  res.json(result);
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

// A picture for a series, season or round: upload it, or remove it again.
function pictureRoutes(path, model) {
  router.post(`/admin/${path}/:id/image`, imageUpload.single("file"), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "PNG, JPG or WebP up to 3 MB." });
    const before = await prisma[model].findUnique({ where: { id: id(req.params.id) } });
    if (!before) {
      removeUpload(`/api/uploads/images/${req.file.filename}`);
      return res.status(404).json({ error: "Not found." });
    }
    const row = await prisma[model].update({ where: { id: before.id }, data: { imageUrl: `/api/uploads/images/${req.file.filename}` } });
    removeUpload(before.imageUrl);
    res.json(row);
  }));
  router.delete(`/admin/${path}/:id/image`, wrap(async (req, res) => {
    const before = await prisma[model].findUnique({ where: { id: id(req.params.id) } });
    if (!before) return res.status(404).json({ error: "Not found." });
    const row = await prisma[model].update({ where: { id: before.id }, data: { imageUrl: null } });
    removeUpload(before.imageUrl);
    res.json(row);
  }));
}
pictureRoutes("series", "series");
pictureRoutes("seasons", "season");
pictureRoutes("races", "race");

// ---- Series -----------------------------------------------------------------

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);

function seriesData(body) {
  const data = {};
  if (body.name != null) data.name = text(body.name, 60);
  if (body.slug != null) data.slug = slugify(body.slug);
  if (body.color !== undefined) data.color = color(body.color);
  if (body.description !== undefined) data.description = optText(body.description, 500);
  if (body.schedule !== undefined) data.schedule = optText(body.schedule, 80);
  if (body.order != null) data.order = optInt(body.order) ?? 0;
  if (body.archived !== undefined) data.archived = !!body.archived;
  if (body.liveWsUrl !== undefined) data.liveWsUrl = /^wss?:\/\//.test(text(body.liveWsUrl)) ? text(body.liveWsUrl, 300) : null;
  if (body.liveOrigin !== undefined) data.liveOrigin = optText(body.liveOrigin, 200);
  return data;
}

router.get("/admin/series", wrap(async (_req, res) => {
  res.json(
    await prisma.series.findMany({
      orderBy: [{ order: "asc" }, { id: "asc" }],
      include: { _count: { select: { seasons: true, teams: true } } },
    }),
  );
}));

router.post("/admin/series", wrap(async (req, res) => {
  const data = seriesData(req.body || {});
  if (!data.name) return res.status(400).json({ error: "A series needs a name." });
  data.slug = data.slug || slugify(data.name);
  if (!data.slug) return res.status(400).json({ error: "The address name needs letters or digits." });
  if (data.order == null) data.order = await prisma.series.count();
  const series = await prisma.series.create({ data });
  // A series starts with its first season, so races can go in right away.
  if (req.body?.seasonName !== "") {
    await prisma.season.create({ data: { seriesId: series.id, name: text(req.body?.seasonName, 80) || `Season ${new Date().getFullYear()}`, isCurrent: true } });
  }
  res.json(series);
}));

router.put("/admin/series/:id", wrap(async (req, res) => {
  const data = seriesData(req.body || {});
  if (data.name === "") return res.status(400).json({ error: "A series needs a name." });
  if (data.slug === "") return res.status(400).json({ error: "The address name needs letters or digits." });
  const series = await prisma.series.update({ where: { id: id(req.params.id) }, data });
  if ("liveWsUrl" in data || "liveOrigin" in data) restartLive();
  res.json(series);
}));

router.delete("/admin/series/:id", wrap(async (req, res) => {
  await prisma.series.delete({ where: { id: id(req.params.id) } });
  restartLive();
  res.json({ ok: true });
}));

// ---- Seasons ----------------------------------------------------------------

router.get("/admin/seasons", wrap(async (req, res) => {
  res.json(
    await prisma.season.findMany({
      where: req.query.series ? { seriesId: id(req.query.series) } : {},
      orderBy: { id: "desc" },
      include: { series: true, _count: { select: { races: true, entries: true } } },
    }),
  );
}));

async function makeCurrent(season) {
  await prisma.$transaction([
    prisma.season.updateMany({ where: { seriesId: season.seriesId }, data: { isCurrent: false } }),
    prisma.season.update({ where: { id: season.id }, data: { isCurrent: true } }),
  ]);
}

router.post("/admin/seasons", wrap(async (req, res) => {
  const seriesId = id(req.body?.seriesId);
  const name = text(req.body?.name, 80);
  if (!seriesId || !name) return res.status(400).json({ error: "A season needs a series and a name." });
  const first = (await prisma.season.count({ where: { seriesId } })) === 0;
  const season = await prisma.season.create({ data: { seriesId, name } });
  // Carry the entry list over from the season it follows, if asked to.
  const from = id(req.body?.copyEntriesFrom);
  if (from) {
    const entries = await prisma.entry.findMany({ where: { seasonId: from } });
    const transfers = await prisma.transfer.findMany({ where: { seasonId: from } });
    const lastRound = (await prisma.race.findFirst({ where: { seasonId: from }, orderBy: { round: "desc" } }))?.round ?? 999;
    for (const e of entries) {
      const teamId = teamAt({ entry: e, transfers: transfers.filter((t) => t.driverId === e.driverId) }, lastRound);
      await prisma.entry.create({ data: { seasonId: season.id, driverId: e.driverId, teamId, number: e.number } });
    }
  }
  if (first || req.body?.isCurrent) await makeCurrent(season);
  res.json(season);
}));

router.put("/admin/seasons/:id", wrap(async (req, res) => {
  const b = req.body || {};
  const data = {};
  if (b.name != null) data.name = text(b.name, 80) || "Season";
  if (b.description !== undefined) data.description = optText(b.description, 2000);
  if (b.pointsMode !== undefined) data.pointsMode = b.pointsMode === "REVERSE" ? "REVERSE" : "TABLE";
  if (b.pointsTable !== undefined) data.pointsTable = tableJson(b.pointsTable);
  if (b.raceTables !== undefined) data.raceTables = raceTablesJson(b.raceTables);
  if (b.qualiPointsTable !== undefined) data.qualiPointsTable = tableJson(b.qualiPointsTable);
  if (b.dropWorst != null) data.dropWorst = Math.max(0, Math.min(20, optInt(b.dropWorst) ?? 0));
  if (b.championId !== undefined) data.championId = optInt(b.championId);
  if (b.championNote !== undefined) data.championNote = optText(b.championNote, 300);
  const season = await prisma.season.update({ where: { id: id(req.params.id) }, data });
  if (b.isCurrent) await makeCurrent(season);
  res.json(season);
}));

router.delete("/admin/seasons/:id", wrap(async (req, res) => {
  await prisma.season.delete({ where: { id: id(req.params.id) } });
  res.json({ ok: true });
}));

// Manual points (a pole award, a deduction, a total from an old sheet).
router.get("/admin/seasons/:id/manual", wrap(async (req, res) => {
  res.json(await prisma.manualPoints.findMany({ where: { seasonId: id(req.params.id) }, include: { driver: true }, orderBy: { id: "asc" } }));
}));

router.post("/admin/seasons/:id/manual", wrap(async (req, res) => {
  const points = Number(req.body?.points);
  const driverId = id(req.body?.driverId);
  if (!driverId || !Number.isFinite(points)) return res.status(400).json({ error: "Pick a driver and enter the points (negative for a deduction)." });
  res.json(await prisma.manualPoints.create({ data: { seasonId: id(req.params.id), driverId, points, note: optText(req.body?.note, 200) } }));
}));

router.delete("/admin/manual/:id", wrap(async (req, res) => {
  await prisma.manualPoints.delete({ where: { id: id(req.params.id) } });
  res.json({ ok: true });
}));

// ---- Entry list and transfers -----------------------------------------------

router.get("/admin/seasons/:id/entries", wrap(async (req, res) => {
  const seasonId = id(req.params.id);
  const [entries, transfers, races] = await Promise.all([
    prisma.entry.findMany({ where: { seasonId }, include: { driver: { include: { user: true } }, team: true } }),
    prisma.transfer.findMany({ where: { seasonId }, include: { team: true }, orderBy: [{ fromRound: "asc" }, { id: "asc" }] }),
    prisma.race.findMany({ where: { seasonId }, orderBy: { round: "asc" }, select: { round: true, track: true, importedAt: true } }),
  ]);
  res.json({
    rounds: races,
    entries: entries
      .map((e) => ({ ...e, transfers: transfers.filter((t) => t.driverId === e.driverId) }))
      // teams alphabetically, drivers without a team last
      .sort((a, b) => (a.team ? 0 : 1) - (b.team ? 0 : 1) || (a.team && b.team ? a.team.name.localeCompare(b.team.name) : 0) || a.driver.name.localeCompare(b.driver.name)),
  });
}));

router.post("/admin/seasons/:id/entries", wrap(async (req, res) => {
  const seasonId = id(req.params.id);
  let driverId = id(req.body?.driverId);
  if (!driverId) {
    const name = text(req.body?.name, 80);
    if (!name) return res.status(400).json({ error: "Pick a driver or type a new name." });
    driverId = (await prisma.driver.create({ data: { name } })).id;
  }
  const entry = await prisma.entry.create({
    data: { seasonId, driverId, teamId: optInt(req.body?.teamId), number: optInt(req.body?.number) },
  });
  await recomputeResultTeams(prisma, seasonId, driverId);
  res.json(entry);
}));

router.put("/admin/entries/:id", wrap(async (req, res) => {
  const data = {};
  if (req.body?.teamId !== undefined) data.teamId = optInt(req.body.teamId);
  if (req.body?.number !== undefined) data.number = optInt(req.body.number);
  const entry = await prisma.entry.update({ where: { id: id(req.params.id) }, data });
  if ("teamId" in data) await recomputeResultTeams(prisma, entry.seasonId, entry.driverId);
  res.json(entry);
}));

router.delete("/admin/entries/:id", wrap(async (req, res) => {
  const entry = await prisma.entry.delete({ where: { id: id(req.params.id) } });
  await prisma.transfer.deleteMany({ where: { seasonId: entry.seasonId, driverId: entry.driverId } });
  res.json({ ok: true });
}));

// A team change from a round on. A round already raced moves that round's
// results (and its team points) to the new team; a round ahead applies itself
// when its result is saved.
router.post("/admin/seasons/:id/transfers", wrap(async (req, res) => {
  const seasonId = id(req.params.id);
  const driverId = id(req.body?.driverId);
  const fromRound = optInt(req.body?.fromRound);
  if (!driverId || !fromRound) return res.status(400).json({ error: "Pick a driver and the round the move applies from." });
  const entry = await prisma.entry.findUnique({ where: { seasonId_driverId: { seasonId, driverId } } });
  if (!entry) return res.status(400).json({ error: "The driver is not on this season's entry list." });
  const transfer = await prisma.transfer.create({ data: { seasonId, driverId, teamId: optInt(req.body?.teamId), fromRound } });
  await recomputeResultTeams(prisma, seasonId, driverId);
  res.json(transfer);
}));

router.delete("/admin/transfers/:id", wrap(async (req, res) => {
  const t = await prisma.transfer.delete({ where: { id: id(req.params.id) } });
  await recomputeResultTeams(prisma, t.seasonId, t.driverId);
  res.json({ ok: true });
}));

// ---- Attendance -------------------------------------------------------------

router.get("/admin/attendance", wrap(async (req, res) => {
  const seasonId = id(req.query.season);
  const [races, entries, signups] = await Promise.all([
    seasonRaces(seasonId),
    prisma.entry.findMany({ where: { seasonId }, include: { driver: true, team: true } }),
    prisma.signup.findMany({ where: { race: { seasonId } }, include: { user: { include: { driver: true } } } }),
  ]);
  res.json(attendance({ races, entries, signups }));
}));

// ---- Teams ------------------------------------------------------------------

router.get("/admin/teams", wrap(async (req, res) => {
  res.json(
    await prisma.team.findMany({
      where: req.query.series ? { seriesId: id(req.query.series) } : {},
      orderBy: { name: "asc" },
      include: { _count: { select: { entries: true, results: true } } },
    }),
  );
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
  const seriesId = id(req.body?.seriesId);
  if (!data.name || !seriesId) return res.status(400).json({ error: "A team needs a series and a name." });
  res.json(await prisma.team.create({ data: { ...data, seriesId } }));
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
      include: { user: true, entries: { include: { season: { include: { series: true } }, team: true } }, _count: { select: { results: true } } },
    }),
  );
}));

function driverData(body) {
  const data = {};
  if (body.name != null) data.name = text(body.name, 80);
  if (body.number !== undefined) data.number = optInt(body.number);
  if (body.country !== undefined) data.country = optText(body.country, 2)?.toUpperCase() ?? null;
  if (body.steamGuid !== undefined) data.steamGuid = optText(body.steamGuid, 40);
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
  const races = await prisma.race.findMany({
    where: { seasonId: id(req.query.season) },
    orderBy: [{ round: "asc" }, { startsAt: "asc" }],
    include: { results: { select: { session: true } }, _count: { select: { signups: true, qualifying: true } } },
  });
  res.json(
    races.map(({ results, ...r }) => ({
      ...r,
      pointsTable: r.pointsTable ? JSON.parse(r.pointsTable).join(", ") : "",
      timetable: r.timetable ? JSON.parse(r.timetable) : [],
      counts: {
        ...Object.fromEntries(Array.from({ length: MAX_RACES }, (_, i) => [`R${i + 1}`, results.filter((x) => x.session === `R${i + 1}`).length])),
        QUALIFY: r._count.qualifying,
        signups: r._count.signups,
      },
    })),
  );
}));

function raceData(body) {
  const data = {};
  if (body.name != null) data.name = text(body.name, 120);
  if (body.track != null) data.track = text(body.track, 120);
  if (body.round != null) data.round = optInt(body.round) ?? 1;
  if (body.notes !== undefined) data.notes = optText(body.notes, 5000);
  if (body.raceCount != null) data.raceCount = Math.max(1, Math.min(MAX_RACES, optInt(body.raceCount) ?? 1));
  if (body.car !== undefined) data.car = optText(body.car, 120);
  if (body.mysteryTrack !== undefined) data.mysteryTrack = !!body.mysteryTrack;
  if (body.videoUrl !== undefined) data.videoUrl = /^https:\/\//.test(text(body.videoUrl, 500)) ? text(body.videoUrl, 500) : null;
  if (body.imageUrl !== undefined) data.imageUrl = imageRef(body.imageUrl);
  if (body.timetable !== undefined) data.timetable = timetableJson(body.timetable);
  if (body.pointsTable !== undefined) data.pointsTable = tableJson(body.pointsTable);
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
  const data = raceData(req.body || {});
  // fewer races only once the dropped races have no results left
  if (data.raceCount != null) {
    const later = await prisma.result.findMany({ where: { raceId: id(req.params.id) }, select: { session: true }, distinct: ["session"] });
    const highest = Math.max(0, ...later.map((r) => Number(r.session.slice(1)) || 1));
    if (highest > data.raceCount) throw fail(409, `Race ${highest} has results. Delete them first, then take the race out.`);
  }
  res.json(await prisma.race.update({ where: { id: id(req.params.id) }, data }));
}));

router.delete("/admin/races/:id", wrap(async (req, res) => {
  await prisma.race.delete({ where: { id: id(req.params.id) } });
  res.json({ ok: true });
}));

// ---- Results ----------------------------------------------------------------

router.get("/admin/races/:id/results", wrap(async (req, res) => {
  const raceId = id(req.params.id);
  if (isQuali(req.query.session)) {
    return res.json(await prisma.qualiResult.findMany({ where: { raceId }, orderBy: { position: "asc" }, include: { driver: true } }));
  }
  res.json(
    await prisma.result.findMany({
      where: { raceId, session: sessionParam(req.query.session) },
      orderBy: { position: "asc" },
      include: { driver: true, team: true },
    }),
  );
}));

// Step 1 of an import: read the file and say who is who. Nothing is saved.
// Each row gets the driver it would be booked on (the Steam id first, then
// the name; null = a new driver) and the team they drive for in this round.
router.post("/admin/races/:id/import/preview", wrap(async (req, res) => {
  const race = await prisma.race.findUnique({ where: { id: id(req.params.id) }, include: { season: true } });
  if (!race) return res.status(404).json({ error: "Race not found." });
  const session = isQuali(req.body?.session) ? "QUALIFY" : sessionParam(req.body?.session);
  let parsed;
  try {
    parsed = parseAcResult(req.body?.file, await getSettings());
  } catch (err) {
    return res.status(400).json({ error: err.message || "Could not read the file." });
  }
  const [drivers, teams, teamNow] = await Promise.all([
    prisma.driver.findMany(),
    prisma.team.findMany({ where: { seriesId: race.season.seriesId } }),
    teamsAtRound(race.seasonId, race.round),
  ]);
  const byGuid = new Map(drivers.filter((d) => d.steamGuid).map((d) => [d.steamGuid, d]));
  const byName = new Map(drivers.map((d) => [d.name.toLowerCase(), d]));
  const teamByName = new Map(teams.map((t) => [t.name.toLowerCase(), t]));
  const rows = parsed.rows.map((row) => {
    const match = (row.guid && byGuid.get(row.guid)) || byName.get(row.name.toLowerCase()) || null;
    const fileTeam = row.team ? teamByName.get(row.team.toLowerCase()) : null;
    const entered = match && teamNow.has(match.id);
    return {
      ...row,
      driverId: match?.id ?? null,
      matchedBy: match ? (row.guid && match.steamGuid === row.guid ? "steam" : "name") : null,
      teamId: entered ? teamNow.get(match.id) : fileTeam?.id ?? null,
      onEntryList: !!entered,
    };
  });
  const existing =
    session === "QUALIFY"
      ? await prisma.qualiResult.count({ where: { raceId: race.id } })
      : await prisma.result.count({ where: { raceId: race.id, session: sessionParam(session) } });
  res.json({ type: parsed.type, track: parsed.track, rows, replaces: existing });
}));

// Step 2: save the rows as the session's results, replacing any there were.
// Also takes rows typed in by hand (driverId and status, no times). Drivers
// who are new, or not yet on the season's entry list, are added to it.
router.post("/admin/races/:id/import", wrap(async (req, res) => {
  const raceId = id(req.params.id);
  const race = await prisma.race.findUnique({ where: { id: raceId } });
  if (!race) return res.status(404).json({ error: "Race not found." });
  const session = isQuali(req.body?.session) ? "QUALIFY" : sessionParam(req.body?.session);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: "No rows to save." });

  await prisma.$transaction(async (tx) => {
    // Every row on a driver: known, or created now (their Steam id is only
    // stored when nobody else has it).
    const driverIds = [];
    for (const row of rows) {
      let driverId = optInt(row.driverId);
      const guid = optText(row.guid, 40);
      if (!driverId) {
        const taken = guid ? await tx.driver.findUnique({ where: { steamGuid: guid } }) : null;
        driverId = (await tx.driver.create({ data: { name: text(row.name, 80) || "Unknown driver", steamGuid: taken ? null : guid } })).id;
      } else if (guid) {
        const d = await tx.driver.findUnique({ where: { id: driverId } });
        const free = !(await tx.driver.findUnique({ where: { steamGuid: guid } }));
        if (d && !d.steamGuid && free) await tx.driver.update({ where: { id: driverId }, data: { steamGuid: guid } });
      }
      if (driverIds.includes(driverId)) throw fail(400, `A driver appears twice (row ${driverIds.length + 1}).`);
      driverIds.push(driverId);
      // onto the entry list, with the team picked in the preview
      await tx.entry.upsert({
        where: { seasonId_driverId: { seasonId: race.seasonId, driverId } },
        create: { seasonId: race.seasonId, driverId, teamId: optInt(row.teamId) },
        update: {},
      });
    }

    if (session === "QUALIFY") {
      await tx.qualiResult.deleteMany({ where: { raceId } });
      for (const [i, row] of rows.entries()) {
        await tx.qualiResult.create({ data: { raceId, driverId: driverIds[i], position: i + 1, bestLapMs: optInt(row.bestLapMs) } });
      }
      // race 1's grid follows the qualifying where it has none of its own
      const first = await tx.result.findMany({ where: { raceId, session: "R1", grid: null } });
      for (const r of first) {
        const i = driverIds.indexOf(r.driverId);
        if (i >= 0) await tx.result.update({ where: { id: r.id }, data: { grid: i + 1 } });
      }
      return;
    }

    const s = sessionParam(session);
    const teamNow = await teamsAtRound(race.seasonId, race.round, tx);
    const quali = s === "R1" ? await tx.qualiResult.findMany({ where: { raceId } }) : [];
    await tx.result.deleteMany({ where: { raceId, session: s } });
    for (const [i, row] of rows.entries()) {
      const driverId = driverIds[i];
      const teamId = teamNow.has(driverId) ? teamNow.get(driverId) : optInt(row.teamId);
      await tx.result.create({
        data: {
          raceId,
          session: s,
          driverId,
          teamId,
          position: i + 1,
          grid: optInt(row.grid) ?? quali.find((q) => q.driverId === driverId)?.position ?? null,
          status: STATUSES.includes(row.status) ? row.status : "FIN",
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

// One result: status, team, laps, grid, best lap, points adjustment, and a
// steward time penalty (which re-orders the session's finishers by time).
router.put("/admin/results/:id", wrap(async (req, res) => {
  const b = req.body || {};
  const data = {};
  if (b.status != null && STATUSES.includes(b.status)) data.status = b.status;
  if (b.teamId !== undefined) data.teamId = optInt(b.teamId);
  if (b.laps != null) data.laps = optInt(b.laps) ?? 0;
  if (b.grid !== undefined) data.grid = optInt(b.grid);
  if (b.pointsAdjust != null) data.pointsAdjust = Number(b.pointsAdjust) || 0;
  if (b.bestLapMs !== undefined) data.bestLapMs = optInt(b.bestLapMs);
  if (b.penaltySeconds != null) data.penaltyMs = Math.max(0, Math.round((Number(b.penaltySeconds) || 0) * 1000));
  if (b.penaltyNote !== undefined) data.penaltyNote = optText(b.penaltyNote, 200);
  const result = await prisma.result.update({ where: { id: id(req.params.id) }, data });
  if ("penaltyMs" in data || "status" in data) {
    const all = await prisma.result.findMany({ where: { raceId: result.raceId, session: result.session } });
    const order = orderWithPenalties(all);
    await prisma.$transaction([
      ...order.map((r, i) => prisma.result.update({ where: { id: r.id }, data: { position: 1000 + i } })),
      ...order.map((r, i) => prisma.result.update({ where: { id: r.id }, data: { position: i + 1 } })),
    ]);
  }
  res.json(result);
}));

// New finishing order: { session, order: [resultId, ...] }, top to bottom.
router.put("/admin/races/:id/order", wrap(async (req, res) => {
  const raceId = id(req.params.id);
  const session = sessionParam(req.body?.session);
  const order = (Array.isArray(req.body?.order) ? req.body.order : []).map(id);
  const existing = await prisma.result.findMany({ where: { raceId, session }, select: { id: true } });
  if (order.length !== existing.length || !existing.every((r) => order.includes(r.id))) {
    return res.status(400).json({ error: "The order has to list every result of the session once." });
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
  if (isQuali(req.query.session)) {
    await prisma.qualiResult.deleteMany({ where: { raceId } });
    return res.json({ ok: true });
  }
  await prisma.result.deleteMany({ where: { raceId, session: sessionParam(req.query.session) } });
  if (!(await prisma.result.count({ where: { raceId } }))) await prisma.race.update({ where: { id: raceId }, data: { importedAt: null } });
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
