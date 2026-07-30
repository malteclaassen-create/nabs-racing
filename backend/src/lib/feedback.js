// ---------------------------------------------------------------------------
// Feedback from the people who use the site: bug reports and feature wishes,
// sent from the small floating button (desktop) or the "Feedback" row in the
// mobile menu. One row per submission; the admin reads and works through them
// in the Feedback tab of the league office.
//
// Anyone can write — a driver who is signed in has their Discord account
// attached automatically, a logged-out visitor may leave a contact line if they
// want an answer. Nothing here is ever shown publicly.
//
// A submission by a SIGNED-IN member is a conversation, not a one-way note: the
// admin can answer it (FeedbackReply, author ADMIN), the member gets that answer
// in their notification bell, reads it on /feedback and can write back (author
// SENDER), which pings the admins in turn. A logged-out sender has no account to
// notify, so their entry stays a one-way note and the admin uses the contact
// line they left.
//
// Managed via raw SQL like Notification/MemberAccount/Download (the running dev
// server locks the generated Prisma client on Windows). Keep the columns in
// sync with the Feedback/FeedbackReply models in prisma/schema.prisma and the
// CREATE TABLEs in lib/ensureSchema.js.
// ---------------------------------------------------------------------------
import { randomUUID } from "crypto";
import { dbCreateNotification } from "./notifications.js";
import { getAdminDiscordIds } from "./adminUsers.js";

// What the sender says this is. The three the widget offers, nothing else.
export const FEEDBACK_KINDS = ["BUG", "IDEA", "OTHER"];

// Where the admin has got to with it. NEW is where everything starts.
export const FEEDBACK_STATUSES = ["NEW", "PLANNED", "DONE", "DECLINED"];

const MAX_MESSAGE = 2000;
const MIN_MESSAGE = 5;
const MAX_CONTACT = 200;
const MAX_NOTE = 2000;
const MAX_REPLY = 2000;
const MIN_REPLY = 2;

// Who wrote a reply: the league office, or the person who sent the feedback.
export const REPLY_AUTHORS = ["ADMIN", "SENDER"];

export function sanitizeKind(kind) {
  const k = String(kind || "").toUpperCase();
  return FEEDBACK_KINDS.includes(k) ? k : "OTHER";
}

export function sanitizeStatus(status) {
  const s = String(status || "").toUpperCase();
  return FEEDBACK_STATUSES.includes(s) ? s : null;
}

// Raw SQLite rows carry 0/1 for booleans and keep every column, including the
// ones the admin UI has no business seeing in that shape.
function shapeFeedback(r) {
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    message: r.message,
    status: r.status,
    pageUrl: r.pageUrl ?? null,
    userAgent: r.userAgent ?? null,
    discordId: r.discordId ?? null,
    senderName: r.senderName ?? null,
    contact: r.contact ?? null,
    adminNote: r.adminNote ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? null,
    // Filled in by attachReplies(); [] rather than undefined so every caller can
    // treat an entry as a thread without checking first.
    replies: [],
  };
}

function shapeReply(r) {
  if (!r) return null;
  return {
    id: r.id,
    feedbackId: r.feedbackId,
    author: r.author, // ADMIN | SENDER
    authorName: r.authorName ?? null,
    body: r.body,
    createdAt: r.createdAt,
  };
}

// Hang the conversation onto a list of shaped entries, oldest reply first (the
// order a thread is read in). One query for the whole page rather than one per
// entry — the admin list is 300 rows deep.
async function attachReplies(prisma, items) {
  if (!items.length) return items;
  const ids = items.map((i) => i.id);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "FeedbackReply" WHERE "feedbackId" IN (${ids.map(() => "?").join(",")})
     ORDER BY "createdAt" ASC`,
    ...ids
  );
  const byFeedback = new Map();
  for (const row of rows) {
    const reply = shapeReply(row);
    if (!byFeedback.has(reply.feedbackId)) byFeedback.set(reply.feedbackId, []);
    byFeedback.get(reply.feedbackId).push(reply);
  }
  for (const item of items) item.replies = byFeedback.get(item.id) || [];
  return items;
}

// One submission. Everything is trimmed and capped here rather than at the
// route, so no path into this table can write an unbounded blob.
export async function dbCreateFeedback(prisma, { kind, message, pageUrl, userAgent, discordId, senderName, contact }) {
  const text = String(message || "").trim().slice(0, MAX_MESSAGE);
  if (text.length < MIN_MESSAGE) {
    const err = new Error("Please write a little more so we know what you mean.");
    err.status = 400;
    throw err;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  await prisma.$executeRaw`
    INSERT INTO "Feedback"
      ("id","kind","message","status","pageUrl","userAgent","discordId","senderName","contact","adminNote","createdAt","updatedAt")
    VALUES (
      ${id}, ${sanitizeKind(kind)}, ${text}, 'NEW',
      ${pageUrl ? String(pageUrl).slice(0, 300) : null},
      ${userAgent ? String(userAgent).slice(0, 300) : null},
      ${discordId || null},
      ${senderName ? String(senderName).slice(0, 100) : null},
      ${contact ? String(contact).trim().slice(0, MAX_CONTACT) : null},
      NULL, ${now}, ${now})`;
  return dbGetFeedback(prisma, id);
}

export async function dbGetFeedback(prisma, id) {
  const rows = await prisma.$queryRaw`SELECT * FROM "Feedback" WHERE "id" = ${id}`;
  const item = shapeFeedback(rows[0]);
  if (!item) return null;
  await attachReplies(prisma, [item]);
  return item;
}

// Newest first, open items before closed ones — the admin's working order.
export async function dbListFeedback(prisma, limit = 300) {
  const rows = await prisma.$queryRaw`
    SELECT * FROM "Feedback"
    ORDER BY CASE "status" WHEN 'NEW' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END,
             "createdAt" DESC
    LIMIT ${limit}`;
  return attachReplies(prisma, rows.map(shapeFeedback));
}

// What the SENDER is allowed to see of their own entry. The admin's private note
// is exactly that — the Feedback tab tells them so — and their own user-agent
// string is noise, so neither leaves the admin side. Every response on the
// member routes goes through this.
export function shapeFeedbackForSender(item) {
  if (!item) return null;
  return {
    id: item.id,
    kind: item.kind,
    message: item.message,
    status: item.status,
    pageUrl: item.pageUrl,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    replies: item.replies,
  };
}

// One member's own submissions with their threads, for the /feedback page.
// Newest first — the plain reading order for "what have I sent, what came back".
// Only ever called with the discordId out of a verified session token.
export async function dbListFeedbackForSender(prisma, discordId, limit = 100) {
  if (!discordId) return [];
  const rows = await prisma.$queryRaw`
    SELECT * FROM "Feedback" WHERE "discordId" = ${discordId}
    ORDER BY "createdAt" DESC LIMIT ${limit}`;
  return attachReplies(prisma, rows.map(shapeFeedback));
}

// Admin edit: the status, a private note, or both. Anything left undefined
// stays as it is.
export async function dbUpdateFeedback(prisma, id, { status, adminNote }) {
  const now = new Date().toISOString();
  if (status !== undefined) {
    const s = sanitizeStatus(status);
    if (!s) {
      const err = new Error("Unknown status");
      err.status = 400;
      throw err;
    }
    await prisma.$executeRaw`UPDATE "Feedback" SET "status" = ${s}, "updatedAt" = ${now} WHERE "id" = ${id}`;
  }
  if (adminNote !== undefined) {
    const note = adminNote === null ? null : String(adminNote).trim().slice(0, MAX_NOTE) || null;
    await prisma.$executeRaw`UPDATE "Feedback" SET "adminNote" = ${note}, "updatedAt" = ${now} WHERE "id" = ${id}`;
  }
  return dbGetFeedback(prisma, id);
}

export async function dbDeleteFeedback(prisma, id) {
  // The thread goes with it — there is no foreign key on a raw-SQL table, so
  // orphaned replies would simply sit there forever.
  await prisma.$executeRaw`DELETE FROM "FeedbackReply" WHERE "feedbackId" = ${id}`;
  await prisma.$executeRaw`DELETE FROM "Feedback" WHERE "id" = ${id}`;
}

// --- the conversation -------------------------------------------------------

// One message in a thread. `author` decides which side of the page it lands on
// and who gets told about it (see the notify helpers below). Bumps the parent's
// updatedAt, so "last activity" means the last message either way.
export async function dbAddFeedbackReply(prisma, { feedbackId, author, authorName, body }) {
  const text = String(body || "").trim().slice(0, MAX_REPLY);
  if (text.length < MIN_REPLY) {
    const err = new Error("Write something first.");
    err.status = 400;
    throw err;
  }
  const who = REPLY_AUTHORS.includes(author) ? author : "SENDER";
  const id = randomUUID();
  const now = new Date().toISOString();
  await prisma.$executeRaw`
    INSERT INTO "FeedbackReply" ("id","feedbackId","author","authorName","body","createdAt")
    VALUES (${id}, ${feedbackId}, ${who},
      ${authorName ? String(authorName).slice(0, 100) : null}, ${text}, ${now})`;
  await prisma.$executeRaw`UPDATE "Feedback" SET "updatedAt" = ${now} WHERE "id" = ${feedbackId}`;
  const rows = await prisma.$queryRaw`SELECT * FROM "FeedbackReply" WHERE "id" = ${id}`;
  return shapeReply(rows[0]);
}

// Ping the admins' bell so a report doesn't sit unseen until somebody happens to
// open the Feedback tab. Personal notifications (one per designated Discord
// admin) — never a broadcast, this is not league news. Best-effort like every
// other notify helper: a failure here must not cost the sender their report.
export async function notifyAdminsOfFeedback(prisma, entry) {
  try {
    const ids = await getAdminDiscordIds(prisma);
    if (!ids || ids.size === 0) return;
    const label = entry.kind === "BUG" ? "Bug report" : entry.kind === "IDEA" ? "Feature idea" : "Feedback";
    const who = entry.senderName || "Someone";
    for (const discordId of ids) {
      await dbCreateNotification(prisma, {
        type: "FEEDBACK",
        title: `${label} from ${who}`,
        body: preview(entry.message),
        link: "/admin?tab=feedback",
        recipientId: discordId,
        dedupeKey: `feedback:${entry.id}:${discordId}`,
      });
    }
  } catch {
    /* a notification must never break the submission that caused it */
  }
}

// A bell body should read like a sentence, not a wall.
function preview(text, max = 120) {
  const t = String(text || "");
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

// The admins answered someone: that person's bell, with a link straight to the
// thread on their own feedback page. Only possible for a sender who was signed
// in — a logged-out one has no account to notify (the admin has their contact
// line instead), so this quietly does nothing.
export async function notifySenderOfReply(prisma, entry, reply) {
  try {
    if (!entry?.discordId || !reply?.id) return;
    await dbCreateNotification(prisma, {
      type: "FEEDBACK",
      title: "The admins replied to your feedback",
      body: preview(reply.body),
      link: `/feedback?id=${entry.id}`,
      recipientId: entry.discordId,
      dedupeKey: `feedback-reply:${reply.id}`,
    });
  } catch {
    /* best-effort */
  }
}

// The other direction: the sender wrote back, so every admin's bell hears about
// it. Same shape as notifyAdminsOfFeedback — one personal row per admin.
export async function notifyAdminsOfReply(prisma, entry, reply) {
  try {
    if (!reply?.id) return;
    const ids = await getAdminDiscordIds(prisma);
    if (!ids || ids.size === 0) return;
    const who = reply.authorName || entry?.senderName || "A member";
    for (const discordId of ids) {
      // The person who wrote it doesn't need to be told they wrote it — an admin
      // can perfectly well send feedback of their own.
      if (discordId === entry?.discordId) continue;
      await dbCreateNotification(prisma, {
        type: "FEEDBACK",
        title: `${who} replied on their feedback`,
        body: preview(reply.body),
        link: "/admin?tab=feedback",
        recipientId: discordId,
        dedupeKey: `feedback-reply:${reply.id}:${discordId}`,
      });
    }
  } catch {
    /* best-effort */
  }
}
