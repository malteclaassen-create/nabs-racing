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
// Managed via raw SQL like Notification/MemberAccount/Download (the running dev
// server locks the generated Prisma client on Windows). Keep the columns in
// sync with the Feedback model in prisma/schema.prisma and the CREATE TABLE in
// lib/ensureSchema.js.
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
  };
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
  return shapeFeedback(rows[0]);
}

// Newest first, open items before closed ones — the admin's working order.
export async function dbListFeedback(prisma, limit = 300) {
  const rows = await prisma.$queryRaw`
    SELECT * FROM "Feedback"
    ORDER BY CASE "status" WHEN 'NEW' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END,
             "createdAt" DESC
    LIMIT ${limit}`;
  return rows.map(shapeFeedback);
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
  await prisma.$executeRaw`DELETE FROM "Feedback" WHERE "id" = ${id}`;
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
    const preview = entry.message.length > 120 ? `${entry.message.slice(0, 117)}...` : entry.message;
    for (const discordId of ids) {
      await dbCreateNotification(prisma, {
        type: "FEEDBACK",
        title: `${label} from ${who}`,
        body: preview,
        link: "/admin?tab=feedback",
        recipientId: discordId,
        dedupeKey: `feedback:${entry.id}:${discordId}`,
      });
    }
  } catch {
    /* a notification must never break the submission that caused it */
  }
}
