import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, isAdminRequest } from "../middleware/auth.js";
import {
  dbCreateReport, dbGetReport, dbReportsFor, dbMessages, dbAddMessage, canRead, dbDeleteReport,
  dbAttachments, accusedDiscordId,
} from "../lib/reports.js";
import { serveAttachment, saveAttachment, attachmentUpload } from "../lib/reportFiles.js";
import { discordIdsForDrivers } from "../lib/persons.js";

const router = Router();

// In-memory rate limit, the same shape and reasoning as the feedback one: it
// only has to make flooding the table impractical, not survive a restart.
// Reports are rarer than feedback and each one pings every admin, so the
// allowance is smaller.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const filedBy = new Map(); // discord id -> { count, first }

function tooMany(who) {
  const rec = filedBy.get(who);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) {
    filedBy.delete(who);
    return false;
  }
  return rec.count >= MAX_PER_WINDOW;
}

function record(who) {
  const rec = filedBy.get(who);
  if (!rec || Date.now() - rec.first > WINDOW_MS) filedBy.set(who, { count: 1, first: Date.now() });
  else rec.count += 1;
}

// ---------------------------------------------------------------------------
// The member's side of incident reports. Everything here is scoped to the
// signed-in account: you get the reports you are party to and nothing else, and
// the check runs on every single read rather than being done once at list time,
// so guessing an id gets you a 404 rather than somebody else's argument.
// ---------------------------------------------------------------------------

// Who the caller is, in one shape. A report needs a real Discord account behind
// it: an anonymous accusation is not something a league can act on, and there
// would be nobody to tell the outcome to.
function caller(req) {
  return {
    discordId: req.user?.discordId ? String(req.user.discordId) : null,
    name: req.user?.driverName || req.user?.discordName || null,
    isAdmin: isAdminRequest(req),
  };
}

// POST /api/reports  { raceId?, lap?, accusedDriverId?, accusedName?, body }
router.post("/", optionalUser, async (req, res, next) => {
  try {
    const me = caller(req);
    if (!me.discordId) return res.status(401).json({ error: "Sign in with Discord to file a report" });
    // Counted per ACCOUNT rather than per IP: a report needs a Discord login,
    // so there is a real identity to count, and two drivers behind one router
    // must not use up each other's allowance.
    if (tooMany(me.discordId)) {
      return res.status(429).json({ error: "That is a lot of reports at once. Try again in a while." });
    }
    const b = req.body || {};
    const report = await dbCreateReport(prisma, {
      raceId: b.raceId || null,
      lap: b.lap,
      accusedDriverId: b.accusedDriverId || null,
      accusedName: b.accusedName || null,
      body: b.body,
      reporterDiscordId: me.discordId,
      reporterName: me.name,
      source: "SITE",
    });
    record(me.discordId);
    // `accusedReachable` is false when the driver named has never signed in
    // with Discord: the thread exists, the stewards can see it, but the other
    // driver cannot be told and cannot answer. The person filing is told that
    // rather than left to assume it landed.
    res.json({ ok: true, report, accusedReachable: report.accusedReachable !== false });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// DELETE /api/reports/:id — withdrawing one you filed by mistake.
//
// Only the reporter, and only while nothing has happened to it: once the
// stewards have opened it or answered, it is part of a conversation with other
// people in it and taking it away silently is not the reporter's to do. They
// can say so in the thread instead.
router.delete("/:id", optionalUser, async (req, res, next) => {
  try {
    const me = caller(req);
    const report = await dbGetReport(prisma, req.params.id);
    if (!report || !(await canRead(prisma, report, me.discordId, me.isAdmin))) {
      return res.status(404).json({ error: "Report not found" });
    }
    if (String(report.reporterDiscordId || "") !== String(me.discordId || "")) {
      return res.status(403).json({ error: "Only the driver who filed a report can withdraw it" });
    }
    if (report.status !== "NEW") {
      return res.status(409).json({ error: "The stewards have already picked this up. Say so in the thread instead." });
    }
    const messages = await dbMessages(prisma, report.id);
    if (messages.length) {
      return res.status(409).json({ error: "Somebody has answered this already. Say so in the thread instead." });
    }
    await dbDeleteReport(prisma, report.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/reports -> the ones this member may see
router.get("/", optionalUser, async (req, res, next) => {
  try {
    const me = caller(req);
    if (!me.discordId) return res.json({ reports: [] });
    res.json({ reports: await dbReportsFor(prisma, me.discordId) });
  } catch (e) {
    next(e);
  }
});

// GET /api/reports/:id -> one report with its thread
router.get("/:id", optionalUser, async (req, res, next) => {
  try {
    const me = caller(req);
    const report = await dbGetReport(prisma, req.params.id);
    // A report somebody may not read is reported as missing, not as forbidden:
    // "you are not allowed to see this" still confirms it exists, and who it is
    // probably about.
    if (!report || !(await canRead(prisma, report, me.discordId, me.isAdmin))) {
      return res.status(404).json({ error: "Report not found" });
    }
    res.json({
      report,
      messages: await dbMessages(prisma, report.id, me.discordId),
      attachments: await dbAttachments(prisma, report.id),
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/reports/:id/messages  { body }
router.post("/:id/messages", optionalUser, attachmentUpload.array("files", 4), async (req, res, next) => {
  try {
    const me = caller(req);
    const report = await dbGetReport(prisma, req.params.id);
    if (!report || !(await canRead(prisma, report, me.discordId, me.isAdmin))) {
      return res.status(404).json({ error: "Report not found" });
    }
    // Which voice this is written in. Nothing written HERE is ever the
    // stewards: this is the member's view, and speaking as the league office is
    // something you do from the office. Several of this league's drivers are
    // also admins, and having their own replies come out as "Stewards" is
    // exactly the confusion this is fixing — the label follows WHERE you wrote
    // from, not what you are allowed to do. ADMIN comes only from the admin
    // route (routes/admin.js).
    const accused = await accusedDiscordId(prisma, report);
    const author =
      String(report.reporterDiscordId || "") === String(me.discordId)
        ? "REPORTER"
        : accused && String(accused) === String(me.discordId)
          ? "ACCUSED"
          : "VIEWER";
    const { messageId } = await dbAddMessage(prisma, report, {
      author,
      discordId: me.discordId,
      name: me.name,
      body: req.body?.body,
      allowEmpty: (req.files || []).length > 0,
    });
    for (const f of req.files || []) {
      await saveAttachment(prisma, { report, messageId, file: f, uploaderDiscordId: me.discordId });
    }
    res.json({
      ok: true,
      messages: await dbMessages(prisma, report.id, me.discordId),
      attachments: await dbAttachments(prisma, report.id),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// GET /api/reports/:id/files/:attId — a picture or clip from a thread.
//
// Through here and never as a static file. uploads/ is mounted for anyone with
// a URL; a report is a private conversation, so its attachments run the SAME
// read check the thread does, on every single request. Guessing an id gets a
// 404, exactly like guessing a report id does.
router.get("/:id/files/:attId", optionalUser, async (req, res, next) => {
  try {
    const me = caller(req);
    const report = await dbGetReport(prisma, req.params.id);
    if (!report) return res.status(404).json({ error: "Not found" });

    // The SESSION, every time. No signed URL, no ticket, nothing that keeps
    // working once it has been copied out of the page: the first version of
    // this handed out one-hour URLs so an <img> could load them, and a URL that
    // authenticates by existing is a URL that works for whoever it is forwarded
    // to. The browser fetches these with its own token and renders the bytes
    // from memory instead (see ReportChat.jsx), which costs one fetch and takes
    // the leak away entirely.
    if (!(await canRead(prisma, report, me.discordId, me.isAdmin))) {
      return res.status(404).json({ error: "Not found" });
    }

    await serveAttachment(prisma, res, report.id, req.params.attId);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /api/reports/ingest — where the in-game webPenalty app will land.
//
// Built now, deliberately switched OFF until a secret is set. The app posts a
// JSON body of its own shape ({ thread_name, content }), which is what it
// already sends to a Discord forum webhook, so pointing it here is a matter of
// changing one URL in its settings and nothing else. `thread_name` is
// "<driver name> | HH:MM:SS", so the driver and the moment come out of it.
//
// The secret rides in the URL as ?key=, because the app cannot set headers on
// its posts. That makes the key a bearer token in a query string: fine for a
// value that only creates a report, never fine for anything that reads one,
// which is why this endpoint only writes.
//
// The round is filled in from whatever is live (or last ran), and the clock
// time the app sends is turned into a real timestamp against today's date on
// this machine — the one that just received the post.
//
// A report arriving this way names its SENDER, not an accused: mid-race,
// nobody types who hit them. It lands as "someone reported an incident at
// 21:04:11" for the admins to look up in the replay, and the driver can add
// what happened afterwards in the thread.
router.post("/ingest", async (req, res, next) => {
  try {
    const secret = await prisma.setting
      .findUnique({ where: { key: "report_ingest_key" } })
      .then((s) => s?.value || "")
      .catch(() => "");
    if (!secret) return res.status(503).json({ error: "In-game reporting is switched off" });
    if (String(req.query.key || "") !== secret) return res.status(401).json({ error: "Bad key" });

    // "13bot | 21:04:11" — the app's own thread title.
    const title = String(req.body?.thread_name || "").trim();
    const [rawName, rawTime] = title.split("|").map((s) => (s || "").trim());
    if (!rawName) return res.status(400).json({ error: "No driver in thread_name" });

    // Match the name to a roster driver so the report attaches to a person
    // rather than a string. No match is not a failure: the report still lands,
    // just without the link, and an admin can see who it says it is.
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const drivers = await prisma.driver.findMany({ select: { id: true, name: true, discordName: true } });
    const hit = drivers.find((d) => norm(d.name) === norm(rawName) || norm(d.discordName) === norm(rawName));
    const discordIds = hit ? await discordIdsForDrivers(prisma, [hit.id]).catch(() => new Map()) : new Map();

    // The round it belongs to: whatever race is currently live, or the most
    // recent one. Without this an in-game report lands under "no round given"
    // and an admin has to work out which evening it was from the timestamp.
    const raceId = await currentRaceId(prisma);

    // The app sends a wall clock ("21:04:11"), not a date. Combined with
    // today's date on the SERVER, which is the machine that just received it,
    // so an admin gets a real timestamp to scrub the replay to instead of three
    // numbers in a sentence. Kept in the body too, in case the date is wrong
    // for a session that ran past midnight.
    const incidentAt = clockToday(rawTime);

    const report = await dbCreateReport(prisma, {
      body:
        String(req.body?.content || "").trim() ||
        `Reported from inside the race at ${rawTime || "an unknown time"}. The driver can add what happened below.`,
      reporterDiscordId: hit ? discordIds.get(hit.id) || null : null,
      reporterName: rawName,
      raceId,
      source: "INGAME",
      incidentAt,
    });
    res.json({ ok: true, id: report.id });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// "21:04:11" against today's date here. Anything unparseable is simply no
// timestamp, which is better than a wrong one.
function clockToday(hhmmss) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(hhmmss || "").trim());
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3] || 0), 0);
  return d.toISOString();
}

// The race an in-game report belongs to: one running right now, else the most
// recent one that has started. Best-effort — a report with no round is still a
// report, and an admin can move it.
async function currentRaceId(prisma) {
  try {
    const now = Date.now();
    // Bounded by DATE, not by a row count. Taking the twenty newest and then
    // filtering to the ones that have started finds nothing at all in a season
    // whose calendar is published far enough ahead.
    const races = await prisma.race.findMany({
      where: { date: { not: null, lte: new Date(now + 60 * 60 * 1000) } },
      select: { id: true },
      orderBy: { date: "desc" },
      take: 1,
    });
    return races[0]?.id || null;
  } catch {
    return null;
  }
}

export default router;
