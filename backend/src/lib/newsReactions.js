// ---------------------------------------------------------------------------
// Emoji reactions on news articles and their comments, and how many people
// have seen an article.
//
// Reactions: any signed-in member can put any emoji on an article or a
// comment, as many different ones as they like, and take them off again, the
// way Discord does it. One row per (target, member, emoji) in "NewsReaction";
// a target is the article itself or one of its comments. The member's name is
// copied in, the way a comment keeps the name it was written under, so the
// page can say who reacted. REACTIONS is the quick row the picker opens on;
// the full set is every emoji there is (isEmoji).
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

// The quick row the picker opens on, in the order it shows them.
export const REACTIONS = ["👍", "❤️", "😂", "🔥", "😮", "😢", "💀", "🏆"];
// How many different emoji one target can carry, so a comment cannot be
// buried under a wall of them.
export const MAX_KINDS = 20;
// How many names the page gets per emoji (and how many more there are).
const NAMES_SHOWN = 50;
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
    "authorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // A table from before names were kept: the column comes in on its own.
  const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("NewsReaction")`);
  if (!cols.some((c) => c.name === "authorName"))
    await prisma.$executeRawUnsafe(`ALTER TABLE "NewsReaction" ADD COLUMN "authorName" TEXT`);
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

// Whether `s` is one emoji: a single character as the eye sees it (one
// grapheme), made only of emoji parts, with at least one real emoji in it.
// That takes skin tones, families and flags (several code points joined) and
// refuses text, a row of emoji, and anything that only looks empty.
const EMOJI_PARTS_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200D\uFE0E\uFE0F\u20E3\u{E0020}-\u{E007F}]+$/u;
const EMOJI_CORE_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|\u20E3/u;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export function isEmoji(s) {
  const str = String(s ?? "");
  if (!str || str.length > 32) return false;
  if (!EMOJI_PARTS_RE.test(str) || !EMOJI_CORE_RE.test(str)) return false;
  let n = 0;
  for (const _ of graphemes.segment(str)) if (++n > 1) return false;
  return n === 1;
}

// { target, id, emoji } as the page sends it, checked. Returns the clean
// { targetType, targetId, emoji } or { error }.
export function readReaction(input) {
  const src = input || {};
  const targetType = String(src.target ?? "");
  if (!TARGETS.includes(targetType)) return { error: "React to an article or a comment" };
  const emoji = String(src.emoji ?? "");
  if (!isEmoji(emoji)) return { error: "That isn't an emoji" };
  return { targetType, targetId: String(src.id ?? ""), emoji };
}

// Puts the reaction on, or takes it off when the member already has it there.
// Answers { on }, or { error } when the target already carries MAX_KINDS
// different emoji and this would be one more.
export async function toggleReaction(prisma, { articleId, targetType, targetId, discordId, emoji, name = null }) {
  const gone = Number(
    await prisma.$executeRawUnsafe(
      `DELETE FROM "NewsReaction" WHERE "targetType" = ? AND "targetId" = ? AND "discordId" = ? AND "emoji" = ?`,
      targetType,
      targetId,
      discordId,
      emoji
    )
  );
  if (gone) return { on: false };
  const kinds = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT "emoji" FROM "NewsReaction" WHERE "targetType" = ? AND "targetId" = ?`,
    targetType,
    targetId
  );
  if (kinds.length >= MAX_KINDS && !kinds.some((k) => k.emoji === emoji))
    return { error: "That one has all the different reactions it can take. Add to one that's there" };
  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO "NewsReaction" ("id","articleId","targetType","targetId","discordId","emoji","authorName","createdAt") VALUES (?,?,?,?,?,?,?,?)`,
    randomUUID(),
    articleId,
    targetType,
    targetId,
    discordId,
    emoji,
    name ? String(name).slice(0, 80) : null,
    new Date().toISOString()
  );
  return { on: true };
}

// Rows of one article as the page shows them: per target, each emoji with how
// many put it there, whether the viewer did, and who (`names`, first come
// first, the viewer as "You"). The emoji stand in the order they first
// arrived, the way Discord lines them up. `rows` come oldest first. Pure.
export function summarise(rows, viewerId = null) {
  const byTarget = new Map();
  for (const r of rows) {
    const key = `${r.targetType}:${r.targetId}`;
    if (!byTarget.has(key)) byTarget.set(key, new Map());
    const m = byTarget.get(key);
    const e = m.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false, names: [] };
    e.count += 1;
    const isViewer = !!viewerId && r.discordId === viewerId;
    if (isViewer) e.mine = true;
    if (e.names.length < NAMES_SHOWN) e.names.push(isViewer ? "You" : r.authorName || "A member");
    m.set(r.emoji, e);
  }
  const list = (key) => [...(byTarget.get(key)?.values() || [])];
  return { list, article: (id) => list(`article:${id}`), comment: (id) => list(`comment:${id}`) };
}

// The columns a summary needs. A reaction from before names were kept has no
// `authorName`; it gets the member's name now, the way the site shows them
// elsewhere: their driver's name, else their Discord display name, else
// their Discord username.
const ROW_SELECT = `SELECT r."targetType", r."targetId", r."discordId", r."emoji",
    COALESCE(
      r."authorName",
      (SELECT d."name" FROM "Driver" d WHERE d."discordUserId" = r."discordId" LIMIT 1),
      m."displayName",
      m."username"
    ) AS "authorName"
  FROM "NewsReaction" r LEFT JOIN "MemberAccount" m ON m."discordId" = r."discordId"`;

export async function articleReactionRows(prisma, articleId) {
  return prisma.$queryRawUnsafe(`${ROW_SELECT} WHERE r."articleId" = ? ORDER BY r."createdAt" ASC`, articleId);
}

// The reactions on one target, for the answer to a toggle.
export async function targetReactions(prisma, { targetType, targetId }, viewerId) {
  const rows = await prisma.$queryRawUnsafe(
    `${ROW_SELECT} WHERE r."targetType" = ? AND r."targetId" = ? ORDER BY r."createdAt" ASC`,
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
