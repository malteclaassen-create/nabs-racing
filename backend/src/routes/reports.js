import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, isAdminRequest } from "../middleware/auth.js";
import {
  dbCreateReport, dbGetReport, dbReportsFor, dbMessages, dbAddMessage, canRead,
} from "../lib/reports.js";
import { discordIdsForDrivers } from "../lib/persons.js";

const router = Router();

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
    res.json({ ok: true, report });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
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
    res.json({ report, messages: await dbMessages(prisma, report.id) });
  } catch (e) {
    next(e);
  }
});

// POST /api/reports/:id/messages  { body }
router.post("/:id/messages", optionalUser, async (req, res, next) => {
  try {
    const me = caller(req);
    const report = await dbGetReport(prisma, req.params.id);
    if (!report || !(await canRead(prisma, report, me.discordId, me.isAdmin))) {
      return res.status(404).json({ error: "Report not found" });
    }
    // Which voice this is written in. An admin writing in a thread is the
    // league office speaking, even when they are also one of the two drivers.
    const author = me.isAdmin
      ? "ADMIN"
      : report.reporterDiscordId === me.discordId
        ? "REPORTER"
        : "ACCUSED";
    const messages = await dbAddMessage(prisma, report, {
      author,
      discordId: me.discordId,
      name: me.name,
      body: req.body?.body,
    });
    res.json({ ok: true, messages });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
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

    const report = await dbCreateReport(prisma, {
      body:
        String(req.body?.content || "").trim() ||
        `Reported from inside the race at ${rawTime || "an unknown time"}. The driver can add what happened below.`,
      reporterDiscordId: hit ? discordIds.get(hit.id) || null : null,
      reporterName: rawName,
      source: "INGAME",
      incidentAt: null, // the app sends a clock time, not a date; rawTime is in the body
    });
    res.json({ ok: true, id: report.id });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

export default router;
