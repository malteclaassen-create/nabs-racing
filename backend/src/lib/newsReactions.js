// ---------------------------------------------------------------------------
// Emoji reactions on news articles and their comments, and how many people
// have seen an article.
//
// Reactions: any signed-in member can put one or more of a small fixed set of
// emoji on an article or a comment, and take them off again, the way Discord
// does it. One row per (target, member, emoji) in "NewsReaction"; a target is
// the article itself or one of its comments.
//
// Views: one counter per article in "NewsView" that goes up every time the
// article is opened, signed in or not, the same reader again included. Nothing
// about who opened it is kept. Obvious crawlers are not counted: they are not
// somebody clicking.
//
// Both tables are raw-SQL managed like "NewsComment" (ensureNewsReactionTables,
// called from ensureAppSchema) and mirrored by a migration.
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";

// The emoji on offer, in the order the page shows them.
export const REACTIONS = ["👍", "❤️", "😂", "🔥", "😮", "😢", "💀", "🏆"];
const TARGETS = ["article", "comment"];
const BOT_RE = /bot|crawler|spider|crawling|preview|fetch|monitor|curl|wget|python-requests|headless/i;

export async function ensureNewsReactionTables(prisma) {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "NewsReaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "NewsReaction_target_member_emoji_key" ON "NewsReaction"("targetType", "targetId", "discordId", "emoji")`
  );
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "NewsReaction_articleId_idx" ON "NewsReaction"("articleId")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "NewsView" (
    "articleId" TEXT NOT NULL PRIMARY KEY,
    "views" INTEGER NOT NULL DEFAULT 0
  )`);
}

// --- reactions ----------------------------------------------------------------

// { target, id, emoji } as the page sends it, checked. Returns the clean
// { targetType, targetId, emoji } or { error }.
export function readReaction(input) {
  const src = input || {};
  const targetType = String(src.target ?? "");
  if (!TARGETS.includes(targetType)) return { error: "React to an article or a comment" };
  const emoji = String(src.emoji ?? "");
  if (!REACTIONS.includes(emoji)) return { error: "That reaction isn't one of ours" };
  return { targetType, targetId: String(src.id ?? ""), emoji };
}

// Puts the reaction on, or takes it off when the member already has it there.
// Answers whether it is on now.
export async function toggleReaction(prisma, { articleId, targetType, targetId, discordId, emoji }) {
  const gone = Number(
    await prisma.$executeRawUnsafe(
      `DELETE FROM "NewsReaction" WHERE "targetType" = ? AND "targetId" = ? AND "discordId" = ? AND "emoji" = ?`,
      targetType,
      targetId,
      discordId,
      emoji
    )
  );
  if (gone) return false;
  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO "NewsReaction" ("id","articleId","targetType","targetId","discordId","emoji","createdAt") VALUES (?,?,?,?,?,?,?)`,
    randomUUID(),
    articleId,
    targetType,
    targetId,
    discordId,
    emoji,
    new Date().toISOString()
  );
  return true;
}

// Rows of one article as the page shows them: per target, each emoji with how
// many put it there and whether the viewer did, in REACTIONS order. Pure.
export function summarise(rows, viewerId = null) {
  const byTarget = new Map();
  for (const r of rows) {
    const key = `${r.targetType}:${r.targetId}`;
    if (!byTarget.has(key)) byTarget.set(key, new Map());
    const m = byTarget.get(key);
    const e = m.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false };
    e.count += 1;
    if (viewerId && r.discordId === viewerId) e.mine = true;
    m.set(r.emoji, e);
  }
  const list = (key) =>
    [...(byTarget.get(key)?.values() || [])].sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji));
  return { list, article: (id) => list(`article:${id}`), comment: (id) => list(`comment:${id}`) };
}

export async function articleReactionRows(prisma, articleId) {
  return prisma.$queryRawUnsafe(
    `SELECT "targetType","targetId","discordId","emoji" FROM "NewsReaction" WHERE "articleId" = ?`,
    articleId
  );
}

// The reactions on one target, for the answer to a toggle.
export async function targetReactions(prisma, { targetType, targetId }, viewerId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "targetType","targetId","discordId","emoji" FROM "NewsReaction" WHERE "targetType" = ? AND "targetId" = ?`,
    targetType,
    targetId
  );
  return summarise(rows, viewerId).list(`${targetType}:${targetId}`);
}

// Per member: plenty for clicking about, not enough to hammer the table.
const RATE = { windowMs: 60 * 1000, perWindow: 40 };
const recent = new Map();

export function reactionRateCheck(discordId, now = Date.now()) {
  const list = (recent.get(discordId) || []).filter((t) => now - t < RATE.windowMs);
  if (list.length >= RATE.perWindow) return "Easy on the reactions. Try again in a minute";
  list.push(now);
  recent.set(discordId, list);
  if (recent.size > 5000) recent.delete(recent.keys().next().value);
  return null;
}

// --- views --------------------------------------------------------------------

// A crawler fetching the page is not somebody opening it.
export function isCrawler(userAgent) {
  return BOT_RE.test(String(userAgent || ""));
}

// One more view of the article, unless it was a crawler. Answers the total.
export async function recordView(prisma, articleId, { userAgent = "" } = {}) {
  if (!isCrawler(userAgent)) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "NewsView" ("articleId","views") VALUES (?, 1) ON CONFLICT("articleId") DO UPDATE SET "views" = "views" + 1`,
      articleId
    );
  }
  return countViews(prisma, articleId);
}

export async function countViews(prisma, articleId) {
  const rows = await prisma.$queryRawUnsafe(`SELECT "views" FROM "NewsView" WHERE "articleId" = ?`, articleId);
  return Number(rows[0]?.views ?? 0);
}
