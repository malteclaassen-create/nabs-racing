// ---------------------------------------------------------------------------
// Team sign-ups for a coming season ("Season 7 of the Sunday league: which
// team do you want to drive for, and who with?").
//
// One sign-up runs at a time. The admin opens it for a series and gives it a
// name ("Season 7"); while it is open, that series' home page carries a small
// form. A member signed in with Discord fills in the team they want and the
// two drivers. Someone on their own fills in only themselves, and the second
// seat stays empty ("looking for a teammate").
//
// One entry per Discord account per sign-up: sending the form again changes
// the entry instead of adding a second one, and the member can take it back.
// The admin reads them in the Team sign-ups tab and ticks them off once dealt
// with. Nothing here is shown publicly.
//
// Raw SQL like Feedback (the running dev server locks the generated Prisma
// client on Windows). Keep the columns in sync with the TeamSignup model in
// prisma/schema.prisma and the migration team_signups.
// ---------------------------------------------------------------------------
import { randomUUID } from "crypto";
import { dbCreateNotification } from "./notifications.js";
import { getAdminDiscordIds } from "./adminUsers.js";

export const TEAM_SIGNUP_SETTING = "team_signup";
export const SIGNUP_STATUSES = ["NEW", "DONE"];

const MAX_TEAM = 60;
const MAX_NAME = 60;
const MAX_NOTE = 500;
const MAX_LABEL = 60;
const DEFAULT_LABEL = "Next season";

export async function ensureTeamSignupTable(prisma) {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TeamSignup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "senderName" TEXT,
    "teamName" TEXT NOT NULL,
    "driver1" TEXT NOT NULL,
    "driver2" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "TeamSignup_seriesId_label_discordId_key" ON "TeamSignup"("seriesId", "label", "discordId")`
  );
}

// Text from a form field: one line, trimmed, capped. Empty is null.
export function cleanLine(v, max) {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || null;
}

function cleanNote(v) {
  const s = String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_NOTE);
  return s || null;
}

// --- The switch ------------------------------------------------------------

// { open, seriesId, label }. Closed with no series until an admin opens one.
export function parseSignupSettings(raw) {
  let v = null;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  return {
    open: !!v?.open,
    seriesId: typeof v?.seriesId === "string" && v.seriesId ? v.seriesId : null,
    label: cleanLine(v?.label, MAX_LABEL) || DEFAULT_LABEL,
  };
}

export async function readSignupSettings(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: TEAM_SIGNUP_SETTING } });
    return parseSignupSettings(row?.value);
  } catch {
    return parseSignupSettings(null);
  }
}

export async function writeSignupSettings(prisma, patch) {
  const now = await readSignupSettings(prisma);
  const next = {
    open: patch && "open" in patch ? !!patch.open : now.open,
    seriesId: patch && "seriesId" in patch ? (patch.seriesId ? String(patch.seriesId) : null) : now.seriesId,
    label: patch && "label" in patch ? cleanLine(patch.label, MAX_LABEL) || DEFAULT_LABEL : now.label,
  };
  if (next.open && !next.seriesId) {
    const err = new Error("Pick the series the sign-up is for first.");
    err.status = 400;
    throw err;
  }
  const value = JSON.stringify(next);
  await prisma.setting.upsert({
    where: { key: TEAM_SIGNUP_SETTING },
    create: { key: TEAM_SIGNUP_SETTING, value },
    update: { value },
  });
  return next;
}

// --- Entries ---------------------------------------------------------------

function shape(r) {
  if (!r) return null;
  return {
    id: r.id,
    seriesId: r.seriesId || null,
    label: r.label,
    discordId: r.discordId,
    senderName: r.senderName ?? null,
    teamName: r.teamName,
    driver1: r.driver1,
    driver2: r.driver2 ?? null,
    note: r.note ?? null,
    status: SIGNUP_STATUSES.includes(r.status) ? r.status : "NEW",
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
  };
}

// What the member themself sees of their entry: no Discord id, no status.
export function shapeForSender(entry) {
  if (!entry) return null;
  const { id, teamName, driver1, driver2, note, createdAt, updatedAt } = entry;
  return { id, teamName, driver1, driver2, note, createdAt, updatedAt };
}

// The form's fields, checked. Throws a 400 with words a member can act on.
export function parseSignupForm(body) {
  const teamName = cleanLine(body?.teamName, MAX_TEAM);
  const driver1 = cleanLine(body?.driver1, MAX_NAME);
  const driver2 = cleanLine(body?.driver2, MAX_NAME);
  const note = cleanNote(body?.note);
  const fail = (msg) => {
    const err = new Error(msg);
    err.status = 400;
    return err;
  };
  if (!teamName) throw fail("Write down which team you want to drive for.");
  if (!driver1) throw fail("Write down at least one driver.");
  if (driver2 && driver2.toLowerCase() === driver1.toLowerCase()) throw fail("The two drivers are the same name.");
  return { teamName, driver1, driver2, note };
}

export async function dbGetOwnSignup(prisma, { seriesId, label, discordId }) {
  if (!discordId) return null;
  const rows = await prisma.$queryRaw`
    SELECT * FROM "TeamSignup"
    WHERE "seriesId" = ${seriesId || ""} AND "label" = ${label} AND "discordId" = ${discordId}
    LIMIT 1`;
  return shape(rows[0]);
}

// Send or change this member's entry. Returns { entry, created }.
export async function dbSaveSignup(prisma, { seriesId, label, discordId, senderName, form }) {
  const existing = await dbGetOwnSignup(prisma, { seriesId, label, discordId });
  const now = new Date().toISOString();
  if (existing) {
    // A changed entry is worth another look, so it goes back to NEW.
    await prisma.$executeRaw`
      UPDATE "TeamSignup" SET
        "teamName" = ${form.teamName}, "driver1" = ${form.driver1}, "driver2" = ${form.driver2},
        "note" = ${form.note}, "senderName" = ${senderName || null}, "status" = 'NEW', "updatedAt" = ${now}
      WHERE "id" = ${existing.id}`;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "TeamSignup"
        ("id","seriesId","label","discordId","senderName","teamName","driver1","driver2","note","status","createdAt","updatedAt")
      VALUES (${randomUUID()}, ${seriesId || ""}, ${label}, ${discordId}, ${senderName || null},
        ${form.teamName}, ${form.driver1}, ${form.driver2}, ${form.note}, 'NEW', ${now}, NULL)`;
  }
  return { entry: await dbGetOwnSignup(prisma, { seriesId, label, discordId }), created: !existing };
}

export async function dbWithdrawSignup(prisma, { seriesId, label, discordId }) {
  await prisma.$executeRaw`
    DELETE FROM "TeamSignup"
    WHERE "seriesId" = ${seriesId || ""} AND "label" = ${label} AND "discordId" = ${discordId}`;
}

// Every entry, newest first. The admin view groups them by series and name.
export async function dbListSignups(prisma) {
  const rows = await prisma.$queryRaw`SELECT * FROM "TeamSignup" ORDER BY "createdAt" DESC LIMIT 1000`;
  return rows.map(shape);
}

export async function dbSetSignupStatus(prisma, id, status) {
  const s = String(status || "").toUpperCase();
  if (!SIGNUP_STATUSES.includes(s)) {
    const err = new Error("Unknown status");
    err.status = 400;
    throw err;
  }
  await prisma.$executeRaw`UPDATE "TeamSignup" SET "status" = ${s} WHERE "id" = ${id}`;
}

export async function dbDeleteSignup(prisma, id) {
  await prisma.$executeRaw`DELETE FROM "TeamSignup" WHERE "id" = ${id}`;
}

// Tell the admins' bell. Never makes the member wait, never fails the save.
export async function notifyAdminsOfSignup(prisma, entry, { created }) {
  try {
    const ids = await getAdminDiscordIds(prisma);
    if (!ids || ids.size === 0) return;
    const drivers = entry.driver2 ? `${entry.driver1} and ${entry.driver2}` : `${entry.driver1}, no teammate yet`;
    const stamp = entry.updatedAt || entry.createdAt;
    for (const discordId of ids) {
      await dbCreateNotification(prisma, {
        type: "SIGNUP",
        title: `${created ? "Team sign-up" : "Team sign-up changed"}: ${entry.teamName}`,
        body: `${entry.label}: ${drivers}`,
        link: "/admin?tab=teamsignups",
        recipientId: discordId,
        dedupeKey: `team-signup:${entry.id}:${stamp}:${discordId}`,
      });
    }
  } catch {
    /* the bell is a courtesy */
  }
}
