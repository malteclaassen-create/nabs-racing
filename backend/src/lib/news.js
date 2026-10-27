// ---------------------------------------------------------------------------
// The news desk: articles the league writes about itself. Race reports after a
// round, transfer gossip, a driver in the spotlight, a word from the stewards.
//
// Who writes: league admins, plus whoever an admin names a NEWS WRITER (a list
// of Discord ids in a Setting, like admin_discord_ids). A writer can write,
// publish and delete articles and nothing else; the admin area stays shut.
//
// One row per article in "NewsArticle", raw-SQL managed (ensureNewsTable,
// called from ensureAppSchema) and mirrored by a migration, so it stays
// writable while a dev server holds the generated Prisma client on Windows.
//
// An article is a DRAFT until somebody publishes it. Only published ones are
// public. A draft can come from a person or from the site itself: after each
// saved round the race report is written from the results
// (lib/newsRaceReport.js), and a writer only has to add the jokes. `source`
// says which, and `raceId` ties a report to its round, so the site writes at
// most one per round no matter how often the result is saved again.
//
// The body is a small, safe subset of Markdown (paragraphs, ## headings,
// **bold**, *italic*, [links](…), ![pictures](…), lists, > quotes) that the
// page renders itself. No HTML ever goes through: what a writer types is text.
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";

export const NEWS_CATEGORIES = {
  RACES: "Races",
  TRANSFERS: "Transfers",
  DRIVERS: "Drivers",
  TEAMS: "Teams",
  COMMUNITY: "Community",
  TECHNICAL: "Technical",
  LEAGUE: "League",
};

export const NEWS_LIMITS = { title: 120, summary: 280, body: 30000, coverUrl: 400 };

export const NEWS_STATUSES = ["DRAFT", "PUBLISHED"];

const WRITERS_KEY = "news_writer_ids";
const DISCORD_ID_RE = /^\d{5,25}$/;
const ARTICLE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
// Control characters bar the line breaks a body needs, and the zero-width and
// bidi ones that make text read as something it is not.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g;

export function isArticleId(id) {
  return ARTICLE_ID_RE.test(String(id ?? ""));
}

// --- the table ---------------------------------------------------------------

export async function ensureNewsTable(prisma) {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "NewsArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'RACES',
    "coverUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "raceId" TEXT,
    "authorDiscordId" TEXT,
    "authorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME
  )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "NewsArticle_slug_key" ON "NewsArticle"("slug")`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "NewsArticle_status_publishedAt_idx" ON "NewsArticle"("status", "publishedAt")`
  );
  // One site-written report per round, whatever the number of saves.
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "NewsArticle_auto_race_key" ON "NewsArticle"("raceId") WHERE "source" = 'AUTO'`
  );
}

// --- writers -----------------------------------------------------------------

export async function readNewsWriters(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: WRITERS_KEY } });
    const arr = row?.value ? JSON.parse(row.value) : [];
    return Array.isArray(arr) ? arr.map(String).filter((id) => DISCORD_ID_RE.test(id)) : [];
  } catch {
    return [];
  }
}

export async function writeNewsWriters(prisma, ids) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x).trim()))].filter((id) =>
    DISCORD_ID_RE.test(id)
  );
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({ where: { key: WRITERS_KEY }, create: { key: WRITERS_KEY, value }, update: { value } });
  return clean;
}

export async function isNewsWriter(prisma, discordId) {
  if (!discordId) return false;
  return (await readNewsWriters(prisma)).includes(String(discordId));
}

// --- cleaning what a writer sends -------------------------------------------

export function slugify(title) {
  const base = String(title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");
  return base || "article";
}

function cleanText(raw, max, { multiline = false } = {}) {
  let s = String(raw ?? "").replace(CONTROL_RE, "");
  s = multiline ? s.replace(/\r\n?/g, "\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

// A cover is a picture on this site (an upload) or a plain https address.
// Anything else is refused rather than cleaned up, so the writer sees it.
export function checkCoverUrl(raw) {
  const url = String(raw ?? "").trim();
  if (!url) return { url: null };
  if (url.length > NEWS_LIMITS.coverUrl) return { error: "The picture address is too long" };
  if (/^\/api\/uploads\/[A-Za-z0-9/_.-]+$/.test(url) && !url.includes("..")) return { url };
  if (/^https:\/\/[^\s"'<>]+$/i.test(url)) return { url };
  return { error: "The picture has to be an upload or an https:// address" };
}

// The fields of an article as a writer sends them, checked. Returns
// { article } or { error }. `partial` lets an update leave fields out.
export function sanitizeArticleInput(input, { partial = false } = {}) {
  const src = input || {};
  const out = {};
  if (!partial || "title" in src) {
    const title = cleanText(src.title, NEWS_LIMITS.title);
    if (title.length < 3) return { error: "Give the article a title" };
    out.title = title;
  }
  if (!partial || "summary" in src) out.summary = cleanText(src.summary, NEWS_LIMITS.summary) || null;
  if (!partial || "body" in src) {
    const raw = String(src.body ?? "");
    if (raw.length > NEWS_LIMITS.body) return { error: `The text is longer than ${NEWS_LIMITS.body} characters` };
    out.body = cleanText(raw, NEWS_LIMITS.body, { multiline: true });
  }
  if (!partial || "category" in src) {
    const cat = String(src.category ?? "").toUpperCase();
    out.category = NEWS_CATEGORIES[cat] ? cat : "RACES";
  }
  if (!partial || "coverUrl" in src) {
    const cover = checkCoverUrl(src.coverUrl);
    if (cover.error) return { error: cover.error };
    out.coverUrl = cover.url;
  }
  // The round the article is about. Only a Races article has one; any other
  // category drops it (the route says which way a partial update goes).
  if (!partial || "raceId" in src) {
    const raceId = String(src.raceId ?? "").trim();
    if (raceId && !ARTICLE_ID_RE.test(raceId)) return { error: "That round is not one the site knows" };
    out.raceId = raceId || null;
  }
  if (out.category && out.category !== "RACES") out.raceId = null;
  if (!partial || "status" in src) {
    const status = String(src.status ?? "DRAFT").toUpperCase();
    out.status = NEWS_STATUSES.includes(status) ? status : "DRAFT";
  }
  return { article: out };
}

// Minutes to read, at a relaxed 220 words a minute. Never zero.
export function readingMinutes(body) {
  const words = String(body ?? "").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

// --- reading -----------------------------------------------------------------

const iso = (d) => (d ? new Date(d).toISOString() : null);

export function shapeArticle(row, { withBody = true } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary || null,
    ...(withBody ? { body: row.body || "" } : {}),
    category: row.category,
    categoryLabel: NEWS_CATEGORIES[row.category] || row.category,
    coverUrl: row.coverUrl || null,
    status: row.status,
    source: row.source,
    raceId: row.raceId || null,
    authorName: row.authorName || null,
    readingMinutes: readingMinutes(row.body),
    ...(row.commentCount != null ? { commentCount: Number(row.commentCount) } : {}),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    publishedAt: iso(row.publishedAt),
  };
}

const LIST_COLUMNS = `"id","slug","title","summary","body","category","coverUrl","status","source","raceId","authorName","createdAt","updatedAt","publishedAt"`;
// How many comments an article has (lib/newsComments.js), for the cards.
const COMMENT_COUNT = `(SELECT COUNT(*) FROM "NewsComment" c WHERE c."articleId" = "NewsArticle"."id") AS "commentCount"`;

// Published articles, newest first. `category` narrows, `q` searches title and
// summary, `limit` caps (max 60), `before` pages by publishedAt.
export async function listPublished(prisma, { category = null, q = "", limit = 24, before = null } = {}) {
  const where = [`"status" = 'PUBLISHED'`];
  const args = [];
  if (category && NEWS_CATEGORIES[category]) {
    where.push(`"category" = ?`);
    args.push(category);
  }
  const term = String(q || "").trim().slice(0, 60);
  if (term) {
    where.push(`("title" LIKE ? ESCAPE '\\' OR "summary" LIKE ? ESCAPE '\\')`);
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    args.push(like, like);
  }
  if (before) {
    const t = new Date(before);
    if (!Number.isNaN(t.getTime())) {
      where.push(`"publishedAt" < ?`);
      args.push(t.toISOString());
    }
  }
  const n = Math.min(60, Math.max(1, Number(limit) || 24));
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${LIST_COLUMNS}, ${COMMENT_COUNT} FROM "NewsArticle" WHERE ${where.join(" AND ")} ORDER BY "publishedAt" DESC LIMIT ${n + 1}`,
    ...args
  );
  return {
    articles: rows.slice(0, n).map((r) => shapeArticle(r, { withBody: false })),
    more: rows.length > n,
  };
}

// Every article, drafts first, for the desk.
export async function listAll(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${LIST_COLUMNS} FROM "NewsArticle"
     ORDER BY CASE "status" WHEN 'DRAFT' THEN 0 ELSE 1 END, COALESCE("publishedAt", "updatedAt") DESC
     LIMIT 300`
  );
  return rows.map((r) => shapeArticle(r, { withBody: false }));
}

export async function findArticle(prisma, { id = null, slug = null }) {
  const [col, val] = id ? ["id", id] : ["slug", slug];
  if (!val) return null;
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "NewsArticle" WHERE "${col}" = ? LIMIT 1`, String(val));
  return rows[0] || null;
}

export async function findAutoReport(prisma, raceId) {
  if (!raceId) return null;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "NewsArticle" WHERE "raceId" = ? AND "source" = 'AUTO' LIMIT 1`,
    raceId
  );
  return rows[0] || null;
}

// The articles written about these rounds (any source, drafts too), newest
// first per round: Map raceId -> [shaped article].
export async function articlesForRaces(prisma, raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean).map(String))].slice(0, 400);
  const out = new Map();
  if (!ids.length) return out;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${LIST_COLUMNS} FROM "NewsArticle" WHERE "raceId" IN (${ids.map(() => "?").join(",")}) ORDER BY "createdAt" DESC`,
    ...ids
  );
  for (const r of rows) {
    if (!out.has(r.raceId)) out.set(r.raceId, []);
    out.get(r.raceId).push(shapeArticle(r, { withBody: false }));
  }
  return out;
}

// The published articles about one round, newest first, for its results page.
export async function publishedForRace(prisma, raceId) {
  if (!raceId) return [];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${LIST_COLUMNS} FROM "NewsArticle" WHERE "raceId" = ? AND "status" = 'PUBLISHED' ORDER BY "publishedAt" DESC LIMIT 12`,
    String(raceId)
  );
  return rows.map((r) => shapeArticle(r, { withBody: false }));
}

// Neighbours in the published list, for "read next".
export async function latestPublishedExcept(prisma, id, limit = 3) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${LIST_COLUMNS} FROM "NewsArticle" WHERE "status" = 'PUBLISHED' AND "id" != ? ORDER BY "publishedAt" DESC LIMIT ?`,
    id,
    limit
  );
  return rows.map((r) => shapeArticle(r, { withBody: false }));
}

// --- writing -----------------------------------------------------------------

async function uniqueSlug(prisma, title, exceptId = null) {
  const base = slugify(title);
  for (let i = 1; i < 50; i += 1) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const rows = await prisma.$queryRawUnsafe(`SELECT "id" FROM "NewsArticle" WHERE "slug" = ? LIMIT 1`, slug);
    if (!rows.length || rows[0].id === exceptId) return slug;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

// Creates an article. `fields` is already sanitised. Returns the stored row.
// An AUTO article whose round already has one is not written twice: the
// unique index says no and the existing one comes back.
export async function createArticle(prisma, fields, { author = null, source = "MANUAL", raceId: forRace = null } = {}) {
  const raceId = forRace || fields.raceId || null;
  const id = randomUUID();
  const now = new Date().toISOString();
  const slug = await uniqueSlug(prisma, fields.title);
  const published = fields.status === "PUBLISHED" ? now : null;
  const inserted = await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO "NewsArticle"
      ("id","slug","title","summary","body","category","coverUrl","status","source","raceId","authorDiscordId","authorName","createdAt","updatedAt","publishedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    slug,
    fields.title,
    fields.summary ?? null,
    fields.body ?? "",
    fields.category || "RACES",
    fields.coverUrl ?? null,
    fields.status || "DRAFT",
    source,
    raceId,
    author?.discordId || null,
    author?.name || null,
    now,
    now,
    published
  );
  if (!inserted && source === "AUTO") return findAutoReport(prisma, raceId);
  return findArticle(prisma, { id });
}

// Applies a sanitised partial update. A first publish stamps publishedAt; a
// renamed draft gets a new address, a published article keeps the one that
// may already have been shared. A report the site wrote keeps its round for
// good: that link is how it knows the round already has one.
export async function updateArticle(prisma, existing, fields) {
  const next = { ...existing, ...fields };
  if (existing.source === "AUTO") next.raceId = existing.raceId;
  else if (next.category !== "RACES") next.raceId = null;
  if (fields.title && fields.title !== existing.title && existing.status !== "PUBLISHED") {
    next.slug = await uniqueSlug(prisma, fields.title, existing.id);
  }
  const now = new Date().toISOString();
  if (next.status === "PUBLISHED" && !existing.publishedAt) next.publishedAt = now;
  await prisma.$executeRawUnsafe(
    `UPDATE "NewsArticle" SET "slug"=?, "title"=?, "summary"=?, "body"=?, "category"=?, "coverUrl"=?, "raceId"=?, "status"=?, "publishedAt"=?, "updatedAt"=? WHERE "id"=?`,
    next.slug,
    next.title,
    next.summary ?? null,
    next.body ?? "",
    next.category,
    next.coverUrl ?? null,
    next.raceId ?? null,
    next.status,
    next.publishedAt ? iso(next.publishedAt) : null,
    now,
    existing.id
  );
  return findArticle(prisma, { id: existing.id });
}

export async function deleteArticle(prisma, id) {
  await prisma.$executeRawUnsafe(`DELETE FROM "NewsReaction" WHERE "articleId" = ?`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "NewsView" WHERE "articleId" = ?`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "NewsComment" WHERE "articleId" = ?`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "NewsArticle" WHERE "id" = ?`, id);
}
