// ---------------------------------------------------------------------------
// Comments under a news article, and the GIFs that go in them.
//
// Any signed-in member can comment on a published article: some text, a GIF,
// or both, and answer somebody else's comment. The writer of a comment can
// delete it, and so can the news desk (admins and news writers), which is all
// the moderation there is.
//
// Replies are one level deep, the way YouTube and Instagram do it: a reply
// hangs under the comment that opened the thread ("parentId"), and an answer
// to a reply joins the same thread and says who it answers ("replyToName").
// Deleting the comment that opened a thread takes its replies with it. The
// member who was answered hears about it in the bell.
//
// One row per comment in "NewsComment", raw-SQL managed like "NewsArticle"
// (ensureNewsCommentTable, called from ensureAppSchema) and mirrored by a
// migration. The author's name and picture are copied in when the comment is
// written, the way a Discord message keeps the name it was sent under.
//
// GIFs: Tenor closed its API on 30 June 2026, so the search in the picker runs
// on GIPHY (GIPHY_API_KEY, optional: without one the picker only takes links).
// A link from either site works, including the tenor.com/view/... link Discord
// copies; that one is looked up on tenor.com for the GIF behind it. A GIF is
// only ever stored as an address on Tenor's or GIPHY's own media servers, so a
// comment cannot pull a picture from anywhere else into the page, and a GIF
// costs the league nothing but that one line of address: no file is copied to
// the server, and the visitor's browser loads it straight from Tenor or GIPHY.
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";

export const COMMENT_LIMITS = { body: 1000, perPage: 50 };

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g;
const COMMENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isCommentId(id) {
  return COMMENT_ID_RE.test(String(id ?? ""));
}

// --- the table ---------------------------------------------------------------

export async function ensureNewsCommentTable(prisma) {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "NewsComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "driverId" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "gifUrl" TEXT,
    "gifWidth" INTEGER,
    "gifHeight" INTEGER,
    "parentId" TEXT,
    "replyToName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // A table from before replies: the two columns come in on their own.
  const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("NewsComment")`);
  for (const name of ["parentId", "replyToName"]) {
    if (!cols.some((c) => c.name === name)) await prisma.$executeRawUnsafe(`ALTER TABLE "NewsComment" ADD COLUMN "${name}" TEXT`);
  }
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "NewsComment_articleId_createdAt_idx" ON "NewsComment"("articleId", "createdAt")`
  );
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "NewsComment_parentId_idx" ON "NewsComment"("parentId")`);
}

// --- GIF addresses -----------------------------------------------------------

// Tenor: media.tenor.com, media1.tenor.com, c.tenor.com. GIPHY: media.giphy.com,
// media0-4.giphy.com, i.giphy.com.
const GIF_HOST_RE = /^(?:media\d*\.tenor\.com|c\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com)$/i;
const SAFE_PATH_RE = /^\/[A-Za-z0-9._~%/-]+$/;
const SAFE_QUERY_RE = /^[A-Za-z0-9._~%=&-]*$/;
const GIF_URL_MAX = 400;

// An address the page may show as a comment's GIF. Returns the cleaned URL or
// null.
export function cleanGifUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.length > GIF_URL_MAX) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (!GIF_HOST_RE.test(u.hostname)) return null;
  if (!SAFE_PATH_RE.test(u.pathname) || u.pathname.includes("..")) return null;
  const query = u.search.replace(/^\?/, "");
  if (!SAFE_QUERY_RE.test(query)) return null;
  return `https://${u.hostname.toLowerCase()}${u.pathname}${query ? `?${query}` : ""}`;
}

// What somebody pasted into the GIF box. Answers one of
//   { gif: { url } }            usable as it is
//   { tenorPage: "<https url>" } a tenor.com page, still to be looked up
//   { error }
export function readGifLink(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { error: "Paste a GIF link" };
  let u;
  try {
    u = new URL(s);
  } catch {
    return { error: "That is not a link" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "That is not a link" };
  const host = u.hostname.toLowerCase().replace(/^www\./, "");

  // A Tenor page: tenor.com/view/<words>-gif-<id>, also with a language in
  // front (tenor.com/de/view/...), and the short tenor.com/<code>.gif links.
  if (host === "tenor.com") {
    if (/^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?view\/[A-Za-z0-9%_-]+$/.test(u.pathname) || /^\/[A-Za-z0-9]+\.gif$/.test(u.pathname)) {
      return { tenorPage: `https://tenor.com${u.pathname}` };
    }
    return { error: "Copy the link of one GIF on Tenor" };
  }

  // A GIPHY page: giphy.com/gifs/<words>-<id> or giphy.com/gifs/<id>. The
  // GIF itself sits at a fixed address on GIPHY's media server.
  if (host === "giphy.com") {
    const m = u.pathname.match(/^\/(?:gifs|stickers)\/(?:[A-Za-z0-9_-]*-)?([A-Za-z0-9]{6,40})\/?$/);
    if (m) return { gif: { url: `https://media.giphy.com/media/${m[1]}/giphy.gif` } };
    return { error: "Copy the link of one GIF on GIPHY" };
  }

  const url = cleanGifUrl(s.replace(/^http:/i, "https:"));
  if (url) return { gif: { url } };
  return { error: "Only GIFs from Tenor or GIPHY work here" };
}

const metaContent = (html, prop) => {
  const re = new RegExp(`<meta[^>]+property=["']${prop.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag?.match(/content=["']([^"']+)["']/i)?.[1] || null;
};

// The GIF behind a tenor.com page, read from the page's own preview tags (the
// ones Discord reads too). null when the page has none or does not answer.
export async function resolveTenorPage(pageUrl, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  let res;
  try {
    res = await fetchImpl(pageUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; NABSRacingBot/1.0)", accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (!res?.ok) return null;
  // A short link redirects; only a page on tenor.com itself is believed.
  try {
    if (res.url && new URL(res.url).hostname.replace(/^www\./, "") !== "tenor.com") return null;
  } catch {
    return null;
  }
  const html = String(await res.text()).slice(0, 400_000);
  const url = cleanGifUrl(metaContent(html, "og:image"));
  if (!url) return null;
  return { url, width: dimension(metaContent(html, "og:image:width")), height: dimension(metaContent(html, "og:image:height")) };
}

function dimension(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= 4000 ? n : null;
}

// --- GIPHY search ------------------------------------------------------------

export function gifSearchEnabled() {
  return !!process.env.GIPHY_API_KEY;
}

const searchCache = new Map();
const SEARCH_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 200;

// One GIPHY result as the picker needs it: a small preview for the grid and
// the size that goes into the comment. GIPHY's own addresses, checked like
// any other.
export function shapeGiphyResult(g) {
  const pick = g?.images?.downsized || g?.images?.fixed_height || g?.images?.original;
  const small = g?.images?.fixed_width_small || g?.images?.fixed_width || pick;
  const url = cleanGifUrl(pick?.url);
  const preview = cleanGifUrl(small?.url);
  if (!url || !preview) return null;
  return {
    id: String(g.id || ""),
    title: String(g.title || "").slice(0, 120),
    url,
    preview,
    width: dimension(pick.width),
    height: dimension(pick.height),
  };
}

// Search, or what is trending when `q` is empty. [] when GIPHY is not set up
// or does not answer: the picker then simply shows nothing to pick. `kind`
// "stickers" searches GIPHY's stickers instead (cut-out pictures on a
// transparent background), which come from the same media servers.
export async function searchGifs(q, { fetchImpl = fetch, now = Date.now(), kind = "gifs" } = {}) {
  const key = process.env.GIPHY_API_KEY;
  if (!key) return [];
  const type = kind === "stickers" ? "stickers" : "gifs";
  const term = String(q ?? "").replace(CONTROL_RE, "").trim().slice(0, 50);
  const cacheKey = `${type}:${term.toLowerCase()}`;
  const hit = searchCache.get(cacheKey);
  if (hit && now - hit.at < SEARCH_TTL_MS) return hit.gifs;

  const params = new URLSearchParams({ api_key: key, limit: "24", rating: "pg-13", bundle: "messaging_non_clips" });
  if (term) params.set("q", term);
  const endpoint = `https://api.giphy.com/v1/${type}/${term ? "search" : "trending"}?${params}`;
  let gifs = [];
  try {
    const res = await fetchImpl(endpoint, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const json = await res.json();
    gifs = (Array.isArray(json?.data) ? json.data : []).map(shapeGiphyResult).filter(Boolean);
  } catch {
    return [];
  }
  if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
  searchCache.set(cacheKey, { at: now, gifs });
  return gifs;
}

// --- cleaning what a member sends ---------------------------------------------

// { body, gif: { url, width, height } } as the page sends it, checked. Returns
// { comment } or { error }. The GIF has to be one readGifLink or the search
// already produced: an address on Tenor's or GIPHY's media servers.
export function sanitizeCommentInput(input) {
  const src = input || {};
  const body = String(src.body ?? "")
    .replace(CONTROL_RE, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (body.length > COMMENT_LIMITS.body) return { error: `Keep it under ${COMMENT_LIMITS.body} characters` };
  let gif = null;
  if (src.gif && src.gif.url) {
    const url = cleanGifUrl(src.gif.url);
    if (!url) return { error: "Only GIFs from Tenor or GIPHY work here" };
    gif = { url, width: dimension(src.gif.width), height: dimension(src.gif.height) };
  }
  if (!body && !gif) return { error: "Write something or pick a GIF" };
  return { comment: { body, gif } };
}

// --- a little brake -----------------------------------------------------------

// Per member: one comment every few seconds, and not a wall of them. Kept in
// memory, which a restart forgets; that is fine for a brake.
const RATE = { gapMs: 5000, windowMs: 10 * 60 * 1000, perWindow: 20 };
const recent = new Map();

export function commentRateCheck(discordId, now = Date.now()) {
  const list = (recent.get(discordId) || []).filter((t) => now - t < RATE.windowMs);
  if (list.length && now - list[list.length - 1] < RATE.gapMs) return "Slow down a little";
  if (list.length >= RATE.perWindow) return "That is a lot of comments. Take a breather and try again in a few minutes";
  list.push(now);
  recent.set(discordId, list);
  if (recent.size > 5000) recent.delete(recent.keys().next().value);
  return null;
}

// --- reading and writing ------------------------------------------------------

const iso = (d) => (d ? new Date(d).toISOString() : null);

// `viewer` is { discordId, moderator } or null: it decides `mine` and
// `canDelete`, nothing else.
export function shapeComment(row, viewer = null) {
  if (!row) return null;
  const mine = !!viewer?.discordId && viewer.discordId === row.discordId;
  return {
    id: row.id,
    body: row.body || "",
    gif: row.gifUrl ? { url: row.gifUrl, width: row.gifWidth ?? null, height: row.gifHeight ?? null } : null,
    author: { name: row.authorName, avatarUrl: row.avatarUrl || null, driverId: row.driverId || null },
    parentId: row.parentId || null,
    replyToName: row.replyToName || null,
    createdAt: iso(row.createdAt),
    mine,
    canDelete: mine || !!viewer?.moderator,
  };
}

// Where an answer to `target` goes: under the comment that opened its thread,
// and, when `target` is itself a reply, naming whom it answers.
export function replyPlacement(target) {
  if (!target) return null;
  if (target.parentId) return { parentId: target.parentId, replyToName: target.authorName || null };
  return { parentId: target.id, replyToName: null };
}

// The page's comments as threads: each opening comment with its replies,
// oldest reply first so a thread reads top to bottom.
export function threadComments(top, replies, viewer = null) {
  const byParent = new Map();
  for (const r of replies) {
    const list = byParent.get(r.parentId) || [];
    list.push(r);
    byParent.set(r.parentId, list);
  }
  return top.map((row) => ({
    ...shapeComment(row, viewer),
    replies: (byParent.get(row.id) || [])
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((r) => shapeComment(r, viewer)),
  }));
}

// The newest threads of an article first; `before` pages back by time. Each
// page brings the replies of its threads along.
export async function listComments(prisma, articleId, { before = null, limit = COMMENT_LIMITS.perPage } = {}) {
  const where = [`"articleId" = ?`, `"parentId" IS NULL`];
  const args = [articleId];
  if (before) {
    const t = new Date(before);
    if (!Number.isNaN(t.getTime())) {
      where.push(`"createdAt" < ?`);
      args.push(t.toISOString());
    }
  }
  const n = Math.min(100, Math.max(1, Number(limit) || COMMENT_LIMITS.perPage));
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "NewsComment" WHERE ${where.join(" AND ")} ORDER BY "createdAt" DESC LIMIT ${n + 1}`,
    ...args
  );
  const top = rows.slice(0, n);
  const replies = top.length
    ? await prisma.$queryRawUnsafe(
        `SELECT * FROM "NewsComment" WHERE "parentId" IN (${top.map(() => "?").join(",")}) ORDER BY "createdAt" ASC`,
        ...top.map((r) => r.id)
      )
    : [];
  return { rows: top, replies, more: rows.length > n };
}

export async function countComments(prisma, articleId) {
  const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS "n" FROM "NewsComment" WHERE "articleId" = ?`, articleId);
  return Number(rows[0]?.n ?? 0);
}

export async function findComment(prisma, id) {
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "NewsComment" WHERE "id" = ? LIMIT 1`, String(id));
  return rows[0] || null;
}

// `comment` is sanitised; `author` is { discordId, name, avatarUrl, driverId };
// `placement` is replyPlacement's answer for a reply, null for a new thread.
export async function createComment(prisma, articleId, comment, author, placement = null) {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "NewsComment" ("id","articleId","discordId","authorName","avatarUrl","driverId","body","gifUrl","gifWidth","gifHeight","parentId","replyToName","createdAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    articleId,
    String(author.discordId),
    String(author.name || "Member").slice(0, 80),
    author.avatarUrl ? String(author.avatarUrl).slice(0, 400) : null,
    author.driverId || null,
    comment.body,
    comment.gif?.url || null,
    comment.gif?.width ?? null,
    comment.gif?.height ?? null,
    placement?.parentId || null,
    placement?.replyToName ? String(placement.replyToName).slice(0, 80) : null,
    new Date().toISOString()
  );
  return findComment(prisma, id);
}

// A comment, and the replies under it when it opened a thread, with their
// reactions (lib/newsReactions.js). Answers how many comments went.
export async function deleteComment(prisma, id) {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "NewsReaction" WHERE "targetType" = 'comment' AND "targetId" IN (SELECT "id" FROM "NewsComment" WHERE "id" = ? OR "parentId" = ?)`,
    id,
    id
  );
  return Number(await prisma.$executeRawUnsafe(`DELETE FROM "NewsComment" WHERE "id" = ? OR "parentId" = ?`, id, id));
}
