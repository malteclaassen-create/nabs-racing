// ---------------------------------------------------------------------------
// /api/news — the league's articles (lib/news.js).
//
// Public:
//   GET  /api/news?category=&q=&before=   published articles, newest first
//   GET  /api/news/article/:slug          one published article (+ its round, read next)
//   GET  /api/news/desk/access            { canWrite, admin } for the caller
//
// The desk (admins and news writers, middleware requireNewsDesk):
//   GET    /api/news/desk                 every article, drafts first
//   GET    /api/news/desk/:id             one article, draft or not
//   POST   /api/news/desk                 write one
//   PUT    /api/news/desk/:id             change one (publish = status PUBLISHED)
//   DELETE /api/news/desk/:id
//   POST   /api/news/desk/cover           upload a picture -> { url }
//   POST   /api/news/desk/race-report     { raceId } -> a fresh draft of that round's report
//   GET    /api/news/desk/rounds          finished rounds to write a report for
//   GET    /api/news/desk/races           every round, finished or not, to tie an article to
//   GET    /api/news/desk/by-race?ids=a,b the articles already written about those rounds
//   POST   /api/news/desk/race-reports    { raceIds, publish } -> one report per round, in one go
//
// Admins only, on the desk:
//   GET/PUT /api/news/desk/settings       { mode, writers }
// ---------------------------------------------------------------------------
import { Router } from "express";
import multer from "multer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import prisma from "../lib/prisma.js";
import { requireNewsDesk, newsDeskFor } from "../middleware/auth.js";
import { UPLOADS_DIR } from "../lib/dataDirs.js";
import { safeUploadPath } from "../lib/safeUpload.js";
import { sniffImageType, checkImageUpload } from "../lib/imageIntegrity.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { seasonIsPublic } from "../lib/notifications.js";
import { readParentIds } from "../lib/sprintRaces.js";
import { readRaceTypes } from "../lib/raceTypes.js";
import {
  NEWS_CATEGORIES,
  isArticleId,
  sanitizeArticleInput,
  shapeArticle,
  listPublished,
  listAll,
  findArticle,
  createArticle,
  updateArticle,
  deleteArticle,
  latestPublishedExcept,
  articlesForRaces,
  readNewsWriters,
  writeNewsWriters,
} from "../lib/news.js";
import {
  AUTO_REPORT_MODES,
  autoReportMode,
  setAutoReportMode,
  buildRaceReport,
  announceArticle,
} from "../lib/newsRaceReport.js";

const router = Router();
const NEWS_DIR = join(UPLOADS_DIR, "news");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
// The round an article is tied to, as the article page links it: which
// series' results page, which round. null when there is none, it is gone, or
// its season is not out yet (`showPrivate` for the desk).
async function raceLink(raceId, { showPrivate = false } = {}) {
  if (!raceId) return null;
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    select: {
      id: true,
      number: true,
      track: true,
      date: true,
      seasonId: true,
      season: { select: { number: true, series: { select: { slug: true, name: true } } } },
    },
  });
  if (!race) return null;
  if (!showPrivate && race.seasonId && (await getPrivateSeasonIds(prisma)).has(race.seasonId)) return null;
  return {
    id: race.id,
    number: race.number,
    track: race.track,
    date: race.date,
    season: race.season?.number ?? null,
    seriesSlug: race.season?.series?.slug || null,
    seriesName: race.season?.series?.name || null,
  };
}

const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };

// --- public ------------------------------------------------------------------

router.get("/", async (req, res, next) => {
  try {
    const category = String(req.query.category || "").toUpperCase() || null;
    const out = await listPublished(prisma, {
      category,
      q: req.query.q,
      before: req.query.before,
      limit: req.query.limit,
    });
    res.json({ ...out, categories: NEWS_CATEGORIES });
  } catch (e) {
    next(e);
  }
});

router.get("/article/:slug", async (req, res, next) => {
  try {
    const row = await findArticle(prisma, { slug: String(req.params.slug).slice(0, 120) });
    if (!row || row.status !== "PUBLISHED") return res.status(404).json({ error: "Article not found" });
    res.json({
      article: shapeArticle(row),
      race: await raceLink(row.raceId),
      more: await latestPublishedExcept(prisma, row.id, 3),
    });
  } catch (e) {
    next(e);
  }
});

// Whether the caller may write. Never fails: anybody without the right simply
// gets canWrite:false, so the news page can ask on every visit.
router.get("/desk/access", async (req, res) => {
  const { desk } = await newsDeskFor(req).catch(() => ({}));
  res.json({ canWrite: !!desk, admin: !!desk?.admin });
});

// --- the desk ----------------------------------------------------------------

router.use("/desk", requireNewsDesk);

function requireDeskAdmin(req, res, next) {
  if (req.newsDesk?.admin) return next();
  return res.status(403).json({ error: "Only league admins can change that" });
}

router.get("/desk", async (_req, res, next) => {
  try {
    res.json({ articles: await listAll(prisma), categories: NEWS_CATEGORIES });
  } catch (e) {
    next(e);
  }
});

router.get("/desk/settings", requireDeskAdmin, async (_req, res, next) => {
  try {
    const writers = await readNewsWriters(prisma);
    const names = writers.length
      ? await prisma.$queryRawUnsafe(
          `SELECT "discordId", "username", "displayName" FROM "MemberAccount" WHERE "discordId" IN (${writers
            .map(() => "?")
            .join(",")})`,
          ...writers
        )
      : [];
    const byId = new Map(names.map((m) => [m.discordId, m.displayName || m.username]));
    res.json({
      mode: await autoReportMode(prisma),
      modes: AUTO_REPORT_MODES,
      writers: writers.map((id) => ({ discordId: id, name: byId.get(id) || null })),
    });
  } catch (e) {
    next(e);
  }
});

router.put("/desk/settings", requireDeskAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.mode !== undefined) await setAutoReportMode(prisma, String(body.mode));
    if (Array.isArray(body.writers)) await writeNewsWriters(prisma, body.writers);
    res.json({ ok: true, mode: await autoReportMode(prisma), writers: await readNewsWriters(prisma) });
  } catch (e) {
    next(e);
  }
});

// Members an admin can name a writer: everybody who has signed in, by name.
router.get("/desk/members", requireDeskAdmin, async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 40);
    if (q.length < 2) return res.json({ members: [] });
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "discordId", "username", "displayName" FROM "MemberAccount"
       WHERE "banned" = 0 AND ("username" LIKE ? ESCAPE '\\' OR "displayName" LIKE ? ESCAPE '\\')
       ORDER BY "lastLoginAt" DESC LIMIT 10`,
      like,
      like
    );
    res.json({ members: rows.map((m) => ({ discordId: m.discordId, name: m.displayName || m.username, username: m.username })) });
  } catch (e) {
    next(e);
  }
});

// Finished rounds of public seasons, newest first, for "write a race report".
router.get("/desk/rounds", async (_req, res, next) => {
  try {
    const hidden = await getPrivateSeasonIds(prisma);
    const races = await prisma.race.findMany({
      where: { isCompleted: true },
      orderBy: { date: "desc" },
      take: 40,
      select: { id: true, number: true, track: true, date: true, seasonId: true, season: { select: { number: true } } },
    });
    res.json({
      rounds: races
        .filter((r) => !hidden.has(r.seasonId))
        .map((r) => ({ id: r.id, number: r.number, track: r.track, date: r.date, season: r.season?.number ?? null })),
    });
  } catch (e) {
    next(e);
  }
});

// Every round an article can be about, newest first: finished or still to
// come, training and special events too, but not a sprint's hidden second
// row. A writer who is not an admin never sees a season that is not out yet.
router.get("/desk/races", async (req, res, next) => {
  try {
    const hidden = req.newsDesk?.admin ? new Set() : await getPrivateSeasonIds(prisma);
    const races = (
      await prisma.race.findMany({
        orderBy: [{ date: "desc" }, { number: "desc" }],
        take: 400,
        select: {
          id: true,
          number: true,
          track: true,
          date: true,
          isCompleted: true,
          seasonId: true,
          season: { select: { number: true, series: { select: { name: true } } } },
        },
      })
    ).filter((r) => !hidden.has(r.seasonId));
    const ids = races.map((r) => r.id);
    const [parents, types] = await Promise.all([readParentIds(prisma, ids), readRaceTypes(prisma, ids)]);
    res.json({
      races: races
        .filter((r) => !parents.get(r.id))
        .map((r) => ({
          id: r.id,
          number: r.number,
          track: r.track,
          date: r.date,
          isCompleted: r.isCompleted,
          type: types.get(r.id) || "CHAMPIONSHIP",
          season: r.season?.number ?? null,
          series: r.season?.series?.name || null,
        })),
    });
  } catch (e) {
    next(e);
  }
});

// An article may only point at a round that exists.
async function checkRace(article) {
  if (!article.raceId) return null;
  const race = await prisma.race.findUnique({ where: { id: article.raceId }, select: { id: true } });
  return race ? null : "That round no longer exists";
}

router.post("/desk/race-report", async (req, res, next) => {
  try {
    const raceId = String(req.body?.raceId || "");
    if (!raceId) return res.status(400).json({ error: "Pick a round" });
    const built = await buildRaceReport(prisma, raceId, { draft: true });
    if (!built) return res.status(404).json({ error: "That round has no classified result to write about" });
    const row = await createArticle(
      prisma,
      { ...built.article, status: "DRAFT" },
      { author: req.newsDesk, source: "MANUAL", raceId }
    );
    res.json({ article: shapeArticle(row) });
  } catch (e) {
    next(e);
  }
});

router.get("/desk/by-race", async (req, res, next) => {
  try {
    const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
    res.json({ byRace: Object.fromEntries(await articlesForRaces(prisma, ids)) });
  } catch (e) {
    next(e);
  }
});

// Several rounds at once (Admin, Content, News). A round that already has an
// article is left alone rather than given a second one; a round of a private
// season is only ever written as a draft, so publishing cannot leak a season
// that is not out yet. Answers what was written and what was not, and why.
const MAX_BATCH = 40;
router.post("/desk/race-reports", async (req, res, next) => {
  try {
    const raceIds = [...new Set((Array.isArray(req.body?.raceIds) ? req.body.raceIds : []).map(String))].filter(Boolean);
    if (!raceIds.length) return res.status(400).json({ error: "Pick at least one round" });
    if (raceIds.length > MAX_BATCH) return res.status(400).json({ error: `At most ${MAX_BATCH} rounds at once` });
    const publish = req.body?.publish === true;
    const existing = await articlesForRaces(prisma, raceIds);
    const created = [];
    const skipped = [];
    for (const raceId of raceIds) {
      if (existing.get(raceId)?.length) {
        skipped.push({ raceId, reason: "already has an article" });
        continue;
      }
      const built = await buildRaceReport(prisma, raceId, { draft: !publish });
      if (!built) {
        skipped.push({ raceId, reason: "no classified result" });
        continue;
      }
      const live = publish && (await seasonIsPublic(prisma, built.race.seasonId));
      const row = await createArticle(
        prisma,
        { ...built.article, status: live ? "PUBLISHED" : "DRAFT" },
        { author: req.newsDesk, source: "MANUAL", raceId }
      );
      if (row?.status === "PUBLISHED") await announceArticle(prisma, row);
      created.push(shapeArticle(row));
      if (publish && !live) skipped.push({ raceId, reason: "private season, kept as a draft" });
    }
    res.json({ created, skipped });
  } catch (e) {
    next(e);
  }
});

router.post("/desk/cover", upload.single("file"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const isGif = file.buffer.subarray(0, 4).toString("latin1") === "GIF8";
    const kind = isGif ? "image/gif" : sniffImageType(file.buffer);
    const ext = EXT[kind];
    if (!ext) return res.status(400).json({ error: "Unsupported image type (use PNG, JPG, WEBP or GIF)" });
    if (!isGif) {
      const check = checkImageUpload(file.buffer, kind);
      if (!check.ok) return res.status(400).json({ error: check.error });
    }
    mkdirSync(NEWS_DIR, { recursive: true });
    const name = `${Date.now().toString(36)}-${randomBytes(5).toString("hex")}${ext}`;
    const dest = safeUploadPath(NEWS_DIR, name);
    if (!dest) return res.status(400).json({ error: "Upload refused" });
    writeFileSync(dest, file.buffer);
    res.json({ url: `/api/uploads/news/${name}` });
  } catch (e) {
    next(e);
  }
});

router.get("/desk/:id", async (req, res, next) => {
  try {
    if (!isArticleId(req.params.id)) return res.status(404).json({ error: "Article not found" });
    const row = await findArticle(prisma, { id: req.params.id });
    if (!row) return res.status(404).json({ error: "Article not found" });
    res.json({ article: shapeArticle(row), race: await raceLink(row.raceId, { showPrivate: true }) });
  } catch (e) {
    next(e);
  }
});

router.post("/desk", async (req, res, next) => {
  try {
    const { article, error } = sanitizeArticleInput(req.body);
    const bad = error || (await checkRace(article));
    if (bad) return res.status(400).json({ error: bad });
    const row = await createArticle(prisma, article, { author: req.newsDesk });
    if (row?.status === "PUBLISHED") await announceArticle(prisma, row);
    res.json({ article: shapeArticle(row) });
  } catch (e) {
    next(e);
  }
});

router.put("/desk/:id", async (req, res, next) => {
  try {
    if (!isArticleId(req.params.id)) return res.status(404).json({ error: "Article not found" });
    const existing = await findArticle(prisma, { id: req.params.id });
    if (!existing) return res.status(404).json({ error: "Article not found" });
    const { article, error } = sanitizeArticleInput(req.body, { partial: true });
    const bad = error || (await checkRace(article));
    if (bad) return res.status(400).json({ error: bad });
    const row = await updateArticle(prisma, existing, article);
    // The bell rings once per article, the first time it goes out.
    if (row?.status === "PUBLISHED" && existing.status !== "PUBLISHED") await announceArticle(prisma, row);
    res.json({ article: shapeArticle(row) });
  } catch (e) {
    next(e);
  }
});

router.delete("/desk/:id", async (req, res, next) => {
  try {
    if (!isArticleId(req.params.id)) return res.status(404).json({ error: "Article not found" });
    await deleteArticle(prisma, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
