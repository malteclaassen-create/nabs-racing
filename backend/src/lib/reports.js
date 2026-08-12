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
import { discordIdsForDrivers, getPersonGroups } from "./persons.js";
import { isSteward } from "./stewards.js";

// Where a report has got to. NEW is where everything starts; the last three are
// endings, and only an admin can set them.
export const REPORT_STATUSES = ["NEW", "REVIEWING", "PENALTY", "NO_PENALTY", "DISMISSED"];
export const REPORT_DECIDED = ["PENALTY", "NO_PENALTY", "DISMISSED"];
// The writer's relationship TO THIS THREAD, which is not the same thing as
// their rights on the site. Several of this league's drivers are also admins,
// and when one of them answers a report they are party to, they are answering
// as themselves — labelling that "the stewards" hid who was actually talking
// and made every message look like it came from the office.
//
// ADMIN therefore means "not one of the people in this argument", and even then
// the name is shown next to it. VIEWER is somebody an admin let in.
export const MESSAGE_AUTHORS = ["REPORTER", "ACCUSED", "VIEWER", "STEWARD", "ADMIN"];

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
    contactKph: r.contactKph ?? null,
    contactSecond: r.contactSecond ?? null,
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
  if (await isSteward(prisma, discordId)) return true;
  return (await readersOf(prisma, report)).has(String(discordId));
}

// WHY this account can see a report, which is what lets the member's page split
// its list into "yours" and "shown to you". Ordered by how close you are to it:
// being in the argument beats having been let in, which beats being appointed
// to judge it.
export async function roleOn(prisma, report, discordId) {
  if (!discordId) return null;
  const me = String(discordId);
  if (String(report.reporterDiscordId || "") === me) return "REPORTER";
  const accused = await accusedDiscordId(prisma, report);
  if (accused && String(accused) === me) return "ACCUSED";
  const extra = await prisma
    .$queryRawUnsafe(`SELECT 1 FROM "ReportViewer" WHERE "reportId" = ? AND "discordId" = ?`, report.id, me)
    .catch(() => []);
  if (extra.length) return "VIEWER";
  if (await isSteward(prisma, me)) return "STEWARD";
  return null;
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

// The reports one member may see, newest first, each carrying WHY. A steward
// sees every report; everybody else sees the ones they are in or were let into.
export async function dbReportsFor(prisma, discordId) {
  if (!discordId) return [];
  const all = await dbListReports(prisma);
  const mine = [];
  for (const r of all) {
    const role = await roleOn(prisma, r, discordId);
    if (role) mine.push({ ...r, myRole: role });
  }
  return mine;
}

// `meDiscordId` marks the caller's own messages, so a thread can put them down
// one side and everybody else down the other. The id itself never leaves the
// server: what goes out is a boolean about YOU, not who anybody else is.
export async function dbMessages(prisma, reportId, meDiscordId = null, teams = null) {
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
    mine: !!meDiscordId && String(m.authorDiscordId || "") === String(meDiscordId),
    team: teams?.get(String(m.authorDiscordId || "")) || null,
  }));
}

// What may be hung on a message. Pictures and clips because that is what an
// incident IS — a still of the moment or ten seconds of replay says more than a
// paragraph. Nothing that executes: an attachment is opened by the other driver
// and by the stewards, from the league's own domain, so the list is closed
// rather than a blocklist of the extensions somebody thought of.
export const ATTACHMENT_TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "application/pdf": ".pdf",
};
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export async function dbAttachments(prisma, reportId) {
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT * FROM "ReportAttachment" WHERE "reportId" = ? ORDER BY datetime("createdAt") ASC`,
      reportId
    )
    .catch(() => []);
  // storedName stays on the server: it is the path on disk, and the browser has
  // no business knowing it.
  return rows.map((a) => ({
    id: a.id,
    reportId: a.reportId,
    messageId: a.messageId || null,
    name: a.name,
    mime: a.mime,
    size: a.size,
    createdAt: a.createdAt,
    // The file is gone; the row is the tombstone.
    removedAt: a.removedAt || null,
  }));
}

export async function dbGetAttachment(prisma, reportId, id) {
  const rows = await prisma
    .$queryRawUnsafe(`SELECT * FROM "ReportAttachment" WHERE "id" = ? AND "reportId" = ?`, id, reportId)
    .catch(() => []);
  return rows[0] || null;
}

export async function dbAddAttachment(prisma, { reportId, messageId, storedName, name, mime, size, uploaderDiscordId }) {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ReportAttachment" ("id","reportId","messageId","storedName","name","mime","size","uploaderDiscordId")
     VALUES (?,?,?,?,?,?,?,?)`,
    id,
    reportId,
    messageId || null,
    storedName,
    clamp(name, 200) || "file",
    mime,
    Math.max(0, Number(size) || 0),
    uploaderDiscordId ? String(uploaderDiscordId) : null
  );
  return id;
}

// The team badge behind each name in a thread.
//
// Resolved from the writer's DISCORD id, not from a name: names repeat across
// seasons and a driver's row changes every year, while the login follows the
// person. Where somebody has rows in several seasons the active one wins, so a
// badge is the team they are racing for now rather than the one they were in
// when the incident happened. That is the right way round for a conversation
// you are having today.
//
// One query for the whole thread, not one per message.
export async function teamsByDiscordId(prisma, discordIds) {
  const ids = [...new Set((discordIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  try {
    // The id sits on ONE driver row per person and does not move when a new
    // season's roster is built, so the row carrying it is often an old one.
    // Going straight from id to row put Steve in Ferrari while the roster had
    // him at Brawn. Follow the PERSON links out from that row, exactly as the
    // results post does to find who to mention, and take the row from the
    // season that is running.
    const claimed = await prisma.driver.findMany({
      where: { discordUserId: { in: ids } },
      select: { id: true, discordUserId: true },
    });
    if (!claimed.length) return new Map();

    const { byDriver, byPerson } = await getPersonGroups(prisma);
    const wanted = new Map(); // driver row id -> the discord id it stands for
    for (const c of claimed) {
      const personId = byDriver.get(c.id);
      const family = personId ? byPerson.get(personId) || [c.id] : [c.id];
      for (const rowId of family) wanted.set(rowId, String(c.discordUserId));
    }

    const rows = await prisma.driver.findMany({
      where: { id: { in: [...wanted.keys()] } },
      select: {
        id: true,
        team: { select: { id: true, name: true, color: true, logoUrl: true } },
        season: { select: { isActive: true, number: true } },
      },
    });

    // The season that is running wins; among archived rows, the newest. A badge
    // is who somebody races for NOW, which is the right tense for a
    // conversation happening today.
    const rank = (x) => (x.season?.isActive ? 1_000_000 : 0) + (x.season?.number ?? 0);
    const best = new Map();
    for (const r of rows) {
      if (!r.team) continue;
      const key = wanted.get(r.id);
      const prev = best.get(key);
      if (!prev || rank(r) > rank(prev)) best.set(key, r);
    }
    return new Map([...best].map(([k, v]) => [k, v.team]));
  } catch {
    return new Map();
  }
}

// Messages with their author's team attached, plus the reporter's, so the
// opening bubble is badged like every other one.
export async function dbThreadVoices(prisma, reportId, report) {
  const rows = await prisma
    .$queryRawUnsafe(`SELECT "authorDiscordId" FROM "ReportMessage" WHERE "reportId" = ?`, reportId)
    .catch(() => []);
  const ids = rows.map((r) => r.authorDiscordId);
  if (report?.reporterDiscordId) ids.push(report.reporterDiscordId);
  const accused = await accusedDiscordId(prisma, report).catch(() => null);
  if (accused) ids.push(accused);
  return teamsByDiscordId(prisma, ids);
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
  // Pinned to a recorded contact: the impact speed has no column of its own in
  // the insert above, and writing it separately keeps that statement readable.
  if (input.contactKph != null) {
    await prisma
      .$executeRawUnsafe(`UPDATE "Report" SET "contactKph" = ? WHERE "id" = ?`, Math.round(input.contactKph), id)
      .catch(() => {});
  }
  if (input.contactSecond != null) {
    await prisma
      .$executeRawUnsafe(`UPDATE "Report" SET "contactSecond" = ? WHERE "id" = ?`, Math.round(input.contactSecond), id)
      .catch(() => {});
  }
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

// `allowEmpty` is for a message that is a PICTURE. "Here, look" with a clip
// attached is a complete thought, and refusing it would make somebody type a
// full stop to send a video.
export async function dbAddMessage(prisma, report, { author, discordId, name, body, allowEmpty = false }) {
  const text = clamp(body, MAX_MSG);
  if (!allowEmpty && text.length < MIN_MSG) throw Object.assign(new Error("The message is empty"), { status: 400 });
  if (!MESSAGE_AUTHORS.includes(author)) throw Object.assign(new Error("Unknown author"), { status: 400 });
  const messageId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ReportMessage" ("id","reportId","author","authorDiscordId","authorName","body") VALUES (?,?,?,?,?,?)`,
    messageId,
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
  return { messageId, messages: await dbMessages(prisma, report.id) };
}

// The admin's decision. Writes what was decided; it deliberately does not touch
// the race result — see the note at the top of this file.
export async function dbDecideReport(prisma, report, { status, verdict, penaltySeconds }) {
  const decidedAt = new Date().toISOString();
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
    decidedAt,
    report.id
  );
  const fresh = await dbGetReport(prisma, report.id);
  // Only an ENDING is worth a notification. "Reviewing" is the admins saying
  // they have opened it, which is not news to anyone waiting for an answer.
  let told = 0;
  if (REPORT_DECIDED.includes(s)) {
    const readers = await readersOf(prisma, fresh);
    told = readers.size;
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
        // Per recipient, per SAVE. Keyed on the status alone, the two drivers
        // shared one slot so only one of them ever heard. Keyed on the content,
        // a correction that happened to be the same length as the last one was
        // swallowed as a repeat — so the moment of saving is what makes it
        // unique. A save only happens when a steward changed something and
        // pressed the button, which is exactly when the drivers want telling.
        dedupeKey: `report_done:${fresh.id}:${rid}:${decidedAt}`,
      }).catch(() => {});
    }
  }
  // How many people that actually reached. The desk says "both drivers have
  // been told" and has to be able to stop saying it: a report whose accused has
  // never signed in with Discord, or which names nobody at all, has one person
  // on it or none.
  return { ...fresh, told };
}

// Name the driver a report is about, for the FIRST time.
//
// It is needed because a report can arrive without one: the in-game app knows
// who sent it and not who they are complaining about, and a driver typing at
// midnight writes "the blue car" as often as a name. Until this is set, the
// other driver cannot see the thread they are the subject of.
//
// Two rules, and they are the point of this function rather than decoration:
//
//   Only the REPORTER may do it. An accusation belongs to the person making it.
//   A steward who could re-point a report at somebody else would be able to
//   manufacture a case against a driver nobody complained about, in a thread
//   that then looks like the first driver wrote it.
//
//   Only ONCE, while it is still blank. Naming somebody lets them in and tells
//   them; changing it afterwards would leave a driver sitting in a thread that
//   is no longer about them, having already read it.
//
// The routes enforce who is asking; this enforces that there is nothing there
// yet, so no caller can get it wrong.
export async function dbSetAccused(prisma, report, { accusedDriverId, accusedName }) {
  if (report.accusedDriverId) {
    throw Object.assign(new Error("This report already names a driver"), { status: 409 });
  }
  const id = accusedDriverId || null;
  if (!id) throw Object.assign(new Error("Pick a driver"), { status: 400 });
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

// --- housekeeping -----------------------------------------------------------

// How long a finished report keeps its pictures, in days. 0 means forever,
// which is the shipped default: throwing away evidence is not something to
// start doing without somebody deciding to.
const RETENTION_KEY = "report_file_retention_days";
export const RETENTION_CHOICES = [0, 1, 7, 30, 90, 180, 365];

export async function readFileRetentionDays(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: RETENTION_KEY } });
    const n = Number(row?.value);
    return RETENTION_CHOICES.includes(n) ? n : 0;
  } catch {
    return 0;
  }
}

export async function writeFileRetentionDays(prisma, days) {
  const n = RETENTION_CHOICES.includes(Number(days)) ? Number(days) : 0;
  const value = String(n);
  await prisma.setting.upsert({ where: { key: RETENTION_KEY }, create: { key: RETENTION_KEY, value }, update: { value } });
  return n;
}

// Attachments on reports that have been DECIDED and left alone for longer than
// the retention window. Returns what to unlink; the caller does the unlinking,
// because this file does not know where the disk is.
//
// Only decided ones, and dated from when the decision was last touched rather
// than from when the report was filed: an argument that is still running keeps
// its evidence however old the crash is.
export async function dbExpiredAttachments(prisma, days) {
  const n = Number(days) || 0;
  if (!n) return [];
  const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  return prisma
    .$queryRawUnsafe(
      `SELECT a."id", a."reportId", a."storedName"
         FROM "ReportAttachment" a
         JOIN "Report" r ON r."id" = a."reportId"
        WHERE a."removedAt" IS NULL
          AND r."status" IN ('PENALTY','NO_PENALTY','DISMISSED')
          AND datetime(COALESCE(r."updatedAt", r."createdAt")) < datetime(?)`,
      cutoff
    )
    .catch(() => []);
}

export async function dbMarkAttachmentRemoved(prisma, id) {
  await prisma
    .$executeRawUnsafe(`UPDATE "ReportAttachment" SET "removedAt" = ? WHERE "id" = ?`, new Date().toISOString(), id)
    .catch(() => {});
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

// Returns the files that were hanging on it, so the caller can take them off
// disk too. A deleted private conversation that leaves its clips lying in a
// folder has not really been deleted.
export async function dbDeleteReport(prisma, id) {
  const files = await prisma
    .$queryRawUnsafe(`SELECT "storedName" FROM "ReportAttachment" WHERE "reportId" = ?`, id)
    .catch(() => []);
  await prisma.$executeRawUnsafe(`DELETE FROM "ReportAttachment" WHERE "reportId" = ?`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "ReportMessage" WHERE "reportId" = ?`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "ReportViewer" WHERE "reportId" = ?`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "Report" WHERE "id" = ?`, id);
  return files.map((f) => f.storedName);
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
