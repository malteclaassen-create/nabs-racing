// ---------------------------------------------------------------------------
// Incident reports: "someone hit me on lap 14".
//
// A report is a PRIVATE conversation, and that is the whole design. Four kinds
// of people can see one: whoever filed it, the driver it names, the admins, and
// anybody an admin has explicitly let in. Nobody else, ever — not other
// drivers, not the public site. A league argues about incidents quite enough
// without an audience.
//
// The verdict does NOT touch the classification. An admin writing "5 seconds"
// here records what was decided; entering it in the result stays a separate,
// deliberate act in the results editor, which is where the penalty column
// already lives. Two places that both write the same number would eventually
// disagree, and the one that decides points has to be the one a human typed.
//
// `source` tells a report written on the site (SITE) from one the in-game
// webPenalty app fired mid-race (INGAME). The in-game one carries a wall-clock
// timestamp rather than a lap, because that is what the app knows and what an
// admin needs to find the moment in the replay.
//
// Raw SQL like Feedback and Notification (the running dev server locks the
// generated Prisma client on Windows). Keep in sync with the Report /
// ReportMessage / ReportViewer models in prisma/schema.prisma and the
// CREATE TABLEs in lib/ensureSchema.js.
// ---------------------------------------------------------------------------
import { randomUUID } from "crypto";
import { dbCreateNotification } from "./notifications.js";
import { getAdminDiscordIds } from "./adminUsers.js";
import { discordIdsForDrivers } from "./persons.js";

// Where a report has got to. NEW is where everything starts; the last three are
// endings, and only an admin can set them.
export const REPORT_STATUSES = ["NEW", "REVIEWING", "PENALTY", "NO_PENALTY", "DISMISSED"];
export const REPORT_DECIDED = ["PENALTY", "NO_PENALTY", "DISMISSED"];
export const MESSAGE_AUTHORS = ["REPORTER", "ACCUSED", "ADMIN"];

const MAX_BODY = 4000;
const MIN_BODY = 5;
const MAX_MSG = 4000;
const MIN_MSG = 1;

const clamp = (v, max) => String(v ?? "").trim().slice(0, max);

export function sanitizeStatus(s) {
  const v = String(s || "").toUpperCase();
  return REPORT_STATUSES.includes(v) ? v : null;
}

function shape(r) {
  if (!r) return null;
  return {
    id: r.id,
    raceId: r.raceId || null,
    lap: r.lap ?? null,
    reporterDiscordId: r.reporterDiscordId || null,
    reporterName: r.reporterName || null,
    accusedDriverId: r.accusedDriverId || null,
    accusedName: r.accusedName || null,
    body: r.body || "",
    source: r.source || "SITE",
    incidentAt: r.incidentAt || null,
    status: r.status || "NEW",
    verdict: r.verdict || null,
    penaltySeconds: r.penaltySeconds ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt || null,
  };
}

// --- who may see what -------------------------------------------------------

// The Discord id of the driver a report names. Resolved through the person
// links, like the results post's mentions: the id lives on ONE row per person
// and moves on login, so the accused's current-season row may not carry it.
export async function accusedDiscordId(prisma, report) {
  if (!report?.accusedDriverId) return null;
  const map = await discordIdsForDrivers(prisma, [report.accusedDriverId]).catch(() => new Map());
  return map.get(report.accusedDriverId) || null;
}

// Everyone entitled to read one report, as a Set of Discord ids. Admins are NOT
// in here: they are allowed by being admins, which is checked separately, so
// that removing somebody's admin rights removes their access to every thread at
// once rather than leaving them listed on old ones.
export async function readersOf(prisma, report) {
  const out = new Set();
  if (report.reporterDiscordId) out.add(String(report.reporterDiscordId));
  const accused = await accusedDiscordId(prisma, report);
  if (accused) out.add(String(accused));
  const extra = await prisma
    .$queryRawUnsafe(`SELECT "discordId" FROM "ReportViewer" WHERE "reportId" = ?`, report.id)
    .catch(() => []);
  for (const v of extra) out.add(String(v.discordId));
  return out;
}

export async function canRead(prisma, report, discordId, isAdmin) {
  if (isAdmin) return true;
  if (!discordId) return false;
  return (await readersOf(prisma, report)).has(String(discordId));
}

// --- reading ----------------------------------------------------------------

export async function dbGetReport(prisma, id) {
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "Report" WHERE "id" = ?`, id).catch(() => []);
  return shape(rows[0]);
}

export async function dbListReports(prisma) {
  const rows = await prisma
    .$queryRawUnsafe(`SELECT * FROM "Report" ORDER BY datetime("createdAt") DESC`)
    .catch(() => []);
  return rows.map(shape);
}

// The reports one member is party to, newest first.
export async function dbReportsFor(prisma, discordId) {
  if (!discordId) return [];
  const all = await dbListReports(prisma);
  const mine = [];
  for (const r of all) if (await canRead(prisma, r, discordId, false)) mine.push(r);
  return mine;
}

export async function dbMessages(prisma, reportId) {
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT * FROM "ReportMessage" WHERE "reportId" = ? ORDER BY datetime("createdAt") ASC`,
      reportId
    )
    .catch(() => []);
  return rows.map((m) => ({
    id: m.id,
    author: m.author,
    authorName: m.authorName || null,
    body: m.body,
    createdAt: m.createdAt,
  }));
}

export async function dbViewers(prisma, reportId) {
  return prisma
    .$queryRawUnsafe(`SELECT "discordId", "name" FROM "ReportViewer" WHERE "reportId" = ?`, reportId)
    .catch(() => []);
}

// --- writing ----------------------------------------------------------------

export async function dbCreateReport(prisma, input) {
  const body = clamp(input.body, MAX_BODY);
  if (body.length < MIN_BODY) throw Object.assign(new Error("Say a little more about what happened"), { status: 400 });
  const id = randomUUID();
  const lap = Number.isFinite(Number(input.lap)) && input.lap !== "" && input.lap !== null ? Number(input.lap) : null;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Report" ("id","raceId","lap","reporterDiscordId","reporterName","accusedDriverId","accusedName","body","source","incidentAt","status")
     VALUES (?,?,?,?,?,?,?,?,?,?,'NEW')`,
    id,
    input.raceId || null,
    lap,
    input.reporterDiscordId ? String(input.reporterDiscordId) : null,
    clamp(input.reporterName, 120) || null,
    input.accusedDriverId || null,
    clamp(input.accusedName, 120) || null,
    body,
    input.source === "INGAME" ? "INGAME" : "SITE",
    input.incidentAt ? new Date(input.incidentAt).toISOString() : null
  );
  const report = await dbGetReport(prisma, id);
  await notifyAdmins(prisma, report, "A new incident report is waiting");

  // And the driver it names. They can read the thread from the moment it
  // exists, so being told about it is the difference between a conversation and
  // an ambush — and between answering the same evening and finding out weeks
  // later that a penalty was decided without them.
  const accused = await accusedDiscordId(prisma, report);
  if (accused && accused !== String(report.reporterDiscordId || "")) {
    await dbCreateNotification(prisma, {
      type: "REPORT",
      title: "An incident report names you",
      body: `${report.reporterName || "A driver"} filed a report about an incident. You can read it and reply.`,
      link: `/reports?id=${report.id}`,
      recipientId: accused,
      dedupeKey: `report_new:${report.id}:${accused}`,
    }).catch(() => {});
  }
  // Whether that worked is the caller's business: a driver who has never logged
  // in with Discord has no id to reach, cannot open the thread, and the person
  // filing needs telling rather than being left to assume it landed.
  return { ...report, accusedReachable: !report.accusedDriverId || !!accused };
}

export async function dbAddMessage(prisma, report, { author, discordId, name, body }) {
  const text = clamp(body, MAX_MSG);
  if (text.length < MIN_MSG) throw Object.assign(new Error("The message is empty"), { status: 400 });
  if (!MESSAGE_AUTHORS.includes(author)) throw Object.assign(new Error("Unknown author"), { status: 400 });
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ReportMessage" ("id","reportId","author","authorDiscordId","authorName","body") VALUES (?,?,?,?,?,?)`,
    randomUUID(),
    report.id,
    author,
    discordId ? String(discordId) : null,
    clamp(name, 120) || null,
    text
  );
  await prisma.$executeRawUnsafe(`UPDATE "Report" SET "updatedAt" = ? WHERE "id" = ?`, new Date().toISOString(), report.id);

  // Everybody on the thread except whoever just wrote.
  const readers = await readersOf(prisma, report);
  if (discordId) readers.delete(String(discordId));
  for (const rid of readers) {
    await dbCreateNotification(prisma, {
      type: "REPORT",
      title: "New message on an incident report",
      body: `${clamp(name, 120) || "Someone"} wrote in the report you are part of.`,
      link: `/reports?id=${report.id}`,
      recipientId: rid,
      // Per RECIPIENT. Without the id in the key, two people on one thread
      // share one dedupe slot and only the first is ever told.
      dedupeKey: `report_msg:${report.id}:${rid}:${Date.now()}`,
    }).catch(() => {});
  }
  if (author !== "ADMIN") await notifyAdmins(prisma, report, "New message on an incident report");
  return dbMessages(prisma, report.id);
}

// The admin's decision. Writes what was decided; it deliberately does not touch
// the race result — see the note at the top of this file.
export async function dbDecideReport(prisma, report, { status, verdict, penaltySeconds }) {
  const s = sanitizeStatus(status);
  if (!s) throw Object.assign(new Error("Unknown status"), { status: 400 });
  const secs =
    penaltySeconds === "" || penaltySeconds === null || penaltySeconds === undefined
      ? null
      : Math.max(0, Math.min(600, Math.round(Number(penaltySeconds) || 0)));
  await prisma.$executeRawUnsafe(
    `UPDATE "Report" SET "status" = ?, "verdict" = ?, "penaltySeconds" = ?, "updatedAt" = ? WHERE "id" = ?`,
    s,
    clamp(verdict, MAX_BODY) || null,
    secs,
    new Date().toISOString(),
    report.id
  );
  const fresh = await dbGetReport(prisma, report.id);
  // Only an ENDING is worth a notification. "Reviewing" is the admins saying
  // they have opened it, which is not news to anyone waiting for an answer.
  if (REPORT_DECIDED.includes(s)) {
    const readers = await readersOf(prisma, fresh);
    const outcome =
      s === "PENALTY"
        ? secs != null
          ? `Penalty: ${secs} seconds.`
          : "A penalty was given."
        : s === "NO_PENALTY"
          ? "No penalty was given."
          : "The report was closed without a decision.";
    for (const rid of readers) {
      await dbCreateNotification(prisma, {
        type: "REPORT",
        title: "Your incident report has been decided",
        body: outcome,
        link: `/reports?id=${fresh.id}`,
        recipientId: rid,
        // Per recipient, and per DECISION. Keyed on the status alone, the two
        // drivers shared one slot so only one of them ever heard, and a
        // correction ("actually 10 seconds, not 5") was swallowed as a repeat
        // of a message nobody had sent yet.
        dedupeKey: `report_done:${fresh.id}:${rid}:${s}:${secs ?? "-"}:${(clamp(verdict, 200) || "").length}`,
      }).catch(() => {});
    }
  }
  return fresh;
}

// Point a report at a different driver, or at one for the first time. Needed
// because a report can arrive without one: the in-game app knows who SENT it
// and not who they are complaining about, and a driver typing at midnight
// writes "the blue car" as often as a name. Until an admin sets this, the other
// driver cannot see the thread they are the subject of.
export async function dbSetAccused(prisma, report, { accusedDriverId, accusedName }) {
  const id = accusedDriverId || null;
  await prisma.$executeRawUnsafe(
    `UPDATE "Report" SET "accusedDriverId" = ?, "accusedName" = ?, "updatedAt" = ? WHERE "id" = ?`,
    id,
    clamp(accusedName, 120) || null,
    new Date().toISOString(),
    report.id
  );
  const fresh = await dbGetReport(prisma, report.id);
  // Newly named, so tell them, the same way creation does. Keyed on the driver
  // rather than the report, so correcting a wrong name tells the right person
  // without a second copy going to the one who was named by mistake.
  const accused = await accusedDiscordId(prisma, fresh);
  if (id && accused && accused !== String(fresh.reporterDiscordId || "")) {
    await dbCreateNotification(prisma, {
      type: "REPORT",
      title: "An incident report names you",
      body: "The stewards have linked an incident report to you. You can read it and reply.",
      link: `/reports?id=${fresh.id}`,
      recipientId: accused,
      dedupeKey: `report_new:${fresh.id}:${accused}`,
    }).catch(() => {});
  }
  return { ...fresh, accusedReachable: !id || !!accused };
}

// The decided penalties for one round, for the results editor to check itself
// against. Deciding "5 seconds" here does NOT put 5 seconds on the driver — see
// the note at the top — so this is what makes the gap between what was agreed
// and what is in the classification visible instead of remembered.
export async function dbDecidedForRace(prisma, raceId) {
  if (!raceId) return [];
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT * FROM "Report" WHERE "raceId" = ? AND "status" IN ('PENALTY','NO_PENALTY','DISMISSED')
        ORDER BY datetime("updatedAt") DESC, datetime("createdAt") DESC`,
      raceId
    )
    .catch(() => []);
  return rows.map(shape);
}

export async function dbAddViewer(prisma, reportId, discordId, name) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ReportViewer" ("reportId","discordId","name") VALUES (?,?,?)
     ON CONFLICT("reportId","discordId") DO UPDATE SET "name" = ?`,
    reportId,
    String(discordId),
    clamp(name, 120) || null,
    clamp(name, 120) || null
  );
  return dbViewers(prisma, reportId);
}

export async function dbRemoveViewer(prisma, reportId, discordId) {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "ReportViewer" WHERE "reportId" = ? AND "discordId" = ?`,
    reportId,
    String(discordId)
  );
  return dbViewers(prisma, reportId);
}

export async function dbDeleteReport(prisma, id) {
  await prisma.$executeRawUnsafe(`DELETE FROM "ReportMessage" WHERE "reportId" = ?`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "ReportViewer" WHERE "reportId" = ?`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "Report" WHERE "id" = ?`, id);
}

async function notifyAdmins(prisma, report, title) {
  const ids = await getAdminDiscordIds(prisma).catch(() => []);
  for (const id of ids) {
    await dbCreateNotification(prisma, {
      type: "REPORT",
      title,
      body: report.accusedName ? `About ${report.accusedName}.` : "Someone filed a report.",
      link: "/admin?tab=reports",
      recipientId: id,
      dedupeKey: `report_admin:${report.id}:${id}:${Date.now()}`,
    }).catch(() => {});
  }
}
