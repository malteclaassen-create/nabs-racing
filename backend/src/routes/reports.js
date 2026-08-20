import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, isAdminRequest } from "../middleware/auth.js";
import {
  dbCreateReport, dbGetReport, dbReportsFor, dbListReports, dbMessages, dbAddMessage, canRead, dbDeleteReport,
  dbAttachments, roleOn, dbSetAccused, dbThreadVoices,
} from "../lib/reports.js";
import { serveAttachment, saveAttachment, attachmentUpload, removeAttachmentFiles } from "../lib/reportFiles.js";
import { discordIdsForDrivers, getLinkedDriverIds } from "../lib/persons.js";
import { contactsForDriver, roundHasArchive } from "../lib/raceContacts.js";
import { anchorReports } from "../lib/reportAnchor.js";
import { RECENT_ROUNDS, recentRoundIds, withinRounds } from "../lib/reportWindow.js";
import { liveRaceSecond } from "../services/liveTiming.js";
import { serverKeyForSeries } from "../lib/liveServers.js";
import { clockNote } from "../lib/reportClock.js";

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

    // A chosen contact is re-resolved from the RESULT FILE rather than trusted
    // from the browser. The lap, the moment and the impact speed are evidence a
    // steward will act on; taking them from the request would let anybody type
    // "lap 4, 80 km/h" into a report about a tap that never happened.
    let pinned = null;
    if (b.contactId && b.raceId) {
      const race = await prisma.race.findUnique({
        where: { id: String(b.raceId) },
        select: { number: true, season: { select: { number: true } } },
      });
      const guid = race?.season ? await steamIdOf(prisma, me.discordId) : null;
      if (guid) {
        const mine = contactsForDriver(race.season.number, race.number, guid);
        pinned = mine.find((c) => c.id === b.contactId) || null;
      }
      if (!pinned) return res.status(400).json({ error: "That contact is not one of yours in this round" });
    }

    // Picking a contact also names the other car: AC knows exactly who it was,
    // which is better than a dropdown and better than a memory.
    const accusedFromContact = pinned
      ? await prisma.driver
          .findFirst({ where: { steamId: pinned.other.guid }, select: { id: true, name: true } })
          .catch(() => null)
      : null;

    // A report has to be ABOUT somebody, and this is where that is enforced.
    //
    // It used to be optional, and the reports that came in without a name were
    // the ones that went nowhere: the driver being complained about could not
    // see the thread they were the subject of, could not answer it, and a
    // steward reading "he brake-checked me into turn one" had a fortnight-old
    // incident and no idea whose it was. The site's own form now cannot send
    // without a driver — this is the same rule at the door, for anything that
    // posts here directly.
    //
    // A pinned contact counts as naming somebody even when no roster row
    // matches: Assetto Corsa recorded which car it was, which is a better
    // answer than a dropdown, and it is on the league to work out who was
    // driving it. The one thing that is refused is a report that names nobody
    // at all. In-game presses are exempt by construction — they come in through
    // /ingest below, where nobody has been accused yet and the stewards do the
    // naming afterwards.
    //
    // Hand-picked from the dropdown: resolved against the roster rather than
    // taken as sent. The id decides who is let into the thread and who is told
    // about it, and the NAME that goes with it is the league's own, not a
    // string the browser chose to put beside the id.
    const accusedPicked =
      !accusedFromContact && b.accusedDriverId
        ? await prisma.driver
            .findUnique({ where: { id: String(b.accusedDriverId) }, select: { id: true, name: true } })
            .catch(() => null)
        : null;
    if (!accusedFromContact && b.accusedDriverId && !accusedPicked) {
      return res.status(400).json({ error: "No such driver" });
    }
    const accused = accusedFromContact || accusedPicked;
    if (!accused && !pinned?.other?.name) {
      return res.status(400).json({ error: "Pick the driver this report is about" });
    }

    const report = await dbCreateReport(prisma, {
      raceId: b.raceId || null,
      lap: pinned ? pinned.lap : b.lap,
      accusedDriverId: accused?.id || null,
      accusedName: accused?.name || pinned?.other.name || null,
      body: b.body,
      reporterDiscordId: me.discordId,
      reporterName: me.name,
      source: "SITE",
      incidentAt: pinned ? new Date(pinned.at * 1000).toISOString() : null,
      contactKph: pinned ? pinned.kph : null,
      contactSecond: pinned ? pinned.second : null,
      contactIndex: pinned ? pinned.eventIndex : null,
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
    // The files go too. dbDeleteReport hands back what was on disk and this
    // route used to drop that on the floor, so a withdrawn report left its
    // pictures behind: rows gone, bytes still there, and nothing left pointing
    // at them to ever clean them up. The admin delete has always done this.
    removeAttachmentFiles(report.id, await dbDeleteReport(prisma, report.id));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// The Steam GUID this account races under, across every season row the person
// owns. Assetto Corsa knows people by that number and nothing else, and it is
// captured onto Driver.steamId by the result import.
//
// The LOGIN's own Steam id is the fallback, and it matters more than it looks.
// Driver.steamId is written by the result import, so a driver only has one once
// they have been in a race the league has imported — while the id proved on the
// account by "Sign in through Steam" exists from the moment they linked it.
// Without this fallback a newcomer, and anyone whose season row simply never
// picked the id up, asked for their contacts and got an empty list with no
// explanation, on a page whose entire point is that the league already knows
// what happened to them.
async function steamIdOf(prisma, discordId) {
  if (!discordId) return null;
  try {
    const claimed = await prisma.driver.findMany({
      where: { discordUserId: String(discordId) },
      select: { id: true },
    });
    const ids = new Set();
    for (const c of claimed) for (const id of await getLinkedDriverIds(prisma, c.id)) ids.add(id);
    if (ids.size) {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "steamId" FROM "Driver" WHERE "id" IN (${[...ids].map(() => "?").join(",")}) AND "steamId" IS NOT NULL`,
        ...ids
      );
      if (rows[0]?.steamId) return rows[0].steamId;
    }
    const account = await prisma.$queryRawUnsafe(
      `SELECT "steamId" FROM "MemberAccount" WHERE "discordId" = ? AND "steamId" IS NOT NULL`,
      String(discordId)
    );
    return account[0]?.steamId || null;
  } catch {
    return null;
  }
}

// GET /api/reports/contacts?raceId=... -> the contacts YOU were in, that round.
//
// Assetto Corsa records every one of them, and the raw result file is kept, so
// the league already knows what happened and when. This is the list a driver
// picks from instead of writing "he hit me at the hairpin" and sending a
// steward hunting through forty minutes of replay.
//
// Yours only. The file holds everybody's, and who bumped whom two corners away
// is not this account's business.
router.get("/contacts", optionalUser, async (req, res, next) => {
  try {
    const me = caller(req);
    if (!me.discordId) return res.json({ contacts: [], reason: "signed-out" });
    const race = await prisma.race.findUnique({
      where: { id: String(req.query.raceId || "") },
      select: { number: true, season: { select: { number: true } } },
    });
    if (!race?.season) return res.json({ contacts: [], reason: "no-race" });
    const guid = await steamIdOf(prisma, me.discordId);
    if (!guid) return res.json({ contacts: [], reason: "no-steam-id" });
    const contacts = contactsForDriver(race.season.number, race.number, guid);
    // An empty list has two very different causes and the driver deserves the
    // right one: the round's result file has not been imported yet (nobody has
    // contacts, come back tomorrow), or it has and Assetto Corsa recorded no
    // contact for THIS driver. Told the wrong one, they go hunting for a fault
    // that isn't there — which is exactly what happened.
    if (contacts.length) return res.json({ contacts, reason: null });
    res.json({
      contacts: [],
      reason: roundHasArchive(race.season.number, race.number) ? "none-recorded" : "not-imported",
    });
  } catch (e) {
    next(e);
  }
});

// The rounds a set of reports belong to, in the shape the anchor needs: it
// measures "N into the session" against the round's archived result file, and
// finds that file by season number and round number.
async function racesForReports(reports) {
  const ids = [...new Set(reports.map((r) => r.raceId).filter(Boolean))];
  if (!ids.length) return [];
  return prisma.race
    .findMany({
      where: { id: { in: ids } },
      select: { id: true, number: true, track: true, date: true, season: { select: { number: true } } },
    })
    .catch(() => []);
}

// GET /api/reports -> the ones this member may see
//
// ?all=1 drops the round window and serves the lot, which is what the "earlier
// rounds" button asks for. Deliberately a choice somebody makes rather than the
// default: it is the slow read, and on a full season it is slow in proportion
// to how many result files it has to open.
router.get("/", optionalUser, async (req, res, next) => {
  try {
    const me = caller(req);
    if (!me.discordId) return res.json({ reports: [], older: 0, rounds: RECENT_ROUNDS });
    // Read once, then narrow. Roles are worked out for the whole table in three
    // queries (lib/reports.js), so knowing what is behind the window costs
    // nothing and the button can say how much is there.
    const readable = await dbReportsFor(prisma, me.discordId, await dbListReports(prisma));
    const races = await racesForReports(readable);
    const reports =
      String(req.query.all || "") === "1"
        ? readable
        : withinRounds(readable, recentRoundIds(races, RECENT_ROUNDS));
    // Anchored here as well as at the stewards' desk (routes/admin.js), and for
    // the same reason: a report fired from inside the race carries the moment
    // the BUTTON was pressed and nothing else until the round is imported. The
    // position in the session, the lap, the impact speed and the matched
    // contact are all worked out at read time — so serving this list without
    // running it showed the driver, and the steward reading the same page, a
    // row that said only who filed it, while the admin tab showed the incident.
    res.json({
      reports: await anchorReports(prisma, reports, races),
      // What the window is holding back, counted on reports this account may
      // actually read — so the button never offers rounds that turn out to be
      // somebody else's arguments.
      older: readable.length - reports.length,
      rounds: RECENT_ROUNDS,
    });
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
    const teams = await dbThreadVoices(prisma, report.id, report);
    // The same anchor the list carries, so opening a report never shows less
    // than the row it was opened from.
    const [anchored] = await anchorReports(prisma, [report], await racesForReports([report]));
    res.json({
      report: { ...anchored, reporterTeam: teams.get(String(report.reporterDiscordId || "")) || null },
      messages: await dbMessages(prisma, report.id, me.discordId, teams),
      attachments: await dbAttachments(prisma, report.id),
    });
  } catch (e) {
    next(e);
  }
});

// May this caller see this thread? One function, used twice on the route
// below: once as the gate in FRONT of the upload and once in the handler
// itself. Written this way on purpose — a door that checks something slightly
// different from the room behind it is how a gate quietly stops matching what
// it is guarding.
async function readableReport(req) {
  const me = caller(req);
  const report = await dbGetReport(prisma, req.params.id);
  if (!report || !(await canRead(prisma, report, me.discordId, me.isAdmin))) return null;
  return report;
}

// Runs BEFORE multer sees the request. A reply may carry four files of twenty
// megabytes, and until this was here the server took all eighty of them from
// whoever asked and only then looked at whether they were signed in or party to
// the thread: a stranger with no session at all could make it swallow 80 MB per
// request, as often as they liked, and be told "Report not found" afterwards.
// The answer is exactly the same one the handler gives, it just arrives before
// the bytes do.
async function requireReadableReport(req, res, next) {
  try {
    if (!(await readableReport(req))) return res.status(404).json({ error: "Report not found" });
    next();
  } catch (e) {
    next(e);
  }
}

// POST /api/reports/:id/messages  { body }
router.post("/:id/messages", optionalUser, requireReadableReport, attachmentUpload.array("files", 4), async (req, res, next) => {
  try {
    const me = caller(req);
    // Read again, after the upload: a thread can be withdrawn or decided while
    // a clip is still going up, and the message lands in the state the report
    // is in NOW rather than the one it was in when the browser started sending.
    const report = await readableReport(req);
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }
    // Which voice this is written in. Nothing written HERE is ever the
    // stewards: this is the member's view, and speaking as the league office is
    // something you do from the office. Several of this league's drivers are
    // also admins, and having their own replies come out as "Stewards" is
    // exactly the confusion this is fixing — the label follows WHERE you wrote
    // from, not what you are allowed to do. ADMIN comes only from the admin
    // route (routes/admin.js).
    // roleOn answers the same question the member's own list asks, so a name
    // in a thread and the section it is filed under can never disagree.
    const author = (await roleOn(prisma, report, me.discordId)) || "VIEWER";
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
      messages: await dbMessages(prisma, report.id, me.discordId, await dbThreadVoices(prisma, report.id, report)),
      attachments: await dbAttachments(prisma, report.id),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// PUT /api/reports/:id/accused  { accusedDriverId }
//
// Saying who it was, after the fact. For the report you filed and nobody has
// been named on yet: an in-game report knows who sent it and not who they are
// complaining about, and "the blue car at turn three" is what people type at
// midnight. Until this is set, the other driver cannot see the thread.
//
// The REPORTER and nobody else, not even a steward. An accusation belongs to
// the person making it; somebody else re-pointing it would be manufacturing a
// case against a driver nobody complained about, in a thread that reads as if
// the first driver wrote it.
router.put("/:id/accused", optionalUser, async (req, res, next) => {
  try {
    const me = caller(req);
    const report = await dbGetReport(prisma, req.params.id);
    if (!report || !(await canRead(prisma, report, me.discordId, me.isAdmin))) {
      return res.status(404).json({ error: "Report not found" });
    }
    if (!me.discordId || String(report.reporterDiscordId || "") !== String(me.discordId)) {
      return res.status(403).json({ error: "Only the driver who filed a report can say who it is about" });
    }
    const driverId = String(req.body?.accusedDriverId || "").trim();
    const driver = driverId
      ? await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true, name: true } })
      : null;
    if (!driver) return res.status(400).json({ error: "No such driver" });
    const fresh = await dbSetAccused(prisma, report, {
      accusedDriverId: driver.id,
      accusedName: driver.name,
    });
    res.json({ ok: true, report: fresh });
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
    // A whole grid pressing the button in the same incident is a real evening,
    // not an attack, so the ceiling is generous — it exists to stop a stuck
    // key or a loop filling the table, nothing else.
    if (ingestFlooded()) return res.status(429).json({ error: "Too many in-game reports at once" });

    // "13bot | 21:04:11" — the app's own thread title.
    //
    // Split on the LAST pipe, not the first. Plenty of drivers race under a
    // clan tag ("NABS | Malte"), and splitting on the first pipe made the name
    // "NABS" and the time "Malte": no roster match, and no timestamp either,
    // because "Malte" doesn't parse as a clock. The tail is only taken as the
    // time when it actually looks like one; otherwise the whole title is the
    // name and the report simply has no clock from the app.
    const title = String(req.body?.thread_name || "").trim();
    const cut = title.lastIndexOf("|");
    const tail = cut === -1 ? "" : title.slice(cut + 1).trim();
    const looksLikeClock = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(tail);
    const rawName = (looksLikeClock ? title.slice(0, cut) : title).trim();
    const rawTime = looksLikeClock ? tail : "";
    if (!rawName) return res.status(400).json({ error: "No driver in thread_name" });

    // Match the name to a roster driver so the report attaches to a person
    // rather than a string. No match is not a failure: the report still lands,
    // just without the link, and an admin can see who it says it is.
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const drivers = await prisma.driver.findMany({ select: { id: true, name: true, discordName: true } });
    // The whole title first, then the part after the last remaining pipe. A
    // driver racing as "NABS | Maltegoat" is on the roster as "Maltegoat", and
    // matching only the full string left every clan-tagged member unlinked —
    // the report landed, but it could not be shown to them and they could not
    // answer in their own thread.
    const candidates = [rawName];
    const tagCut = rawName.lastIndexOf("|");
    if (tagCut !== -1) candidates.push(rawName.slice(tagCut + 1).trim());
    const hit = candidates
      .filter(Boolean)
      .map((c) => drivers.find((d) => norm(d.name) === norm(c) || norm(d.discordName) === norm(c)))
      .find(Boolean);
    const discordIds = hit ? await discordIdsForDrivers(prisma, [hit.id]).catch(() => new Map()) : new Map();

    // The round it belongs to: whatever race is currently live, or the most
    // recent one. Without this an in-game report lands under "no round given"
    // and an admin has to work out which evening it was from the timestamp.
    const raceId = await currentRaceId(prisma);

    // The same press, relayed twice. Exactly one person in the lobby is meant
    // to have webPenalty's relay switched on, which makes the feature silently
    // dead whenever that person isn't racing — so the league should be free to
    // switch it on for two or three people. That only works if the second and
    // third copies of one press collapse, which is what this does: the same
    // driver, the same round, within a minute, is one incident.
    const dupe = await recentIngestFor(prisma, rawName, raceId);
    if (dupe) return res.json({ ok: true, id: dupe.id, duplicate: true });

    // WHEN it happened is the single most useful field on an in-game report,
    // and it is stamped HERE, on arrival, rather than parsed out of the app's
    // clock string.
    //
    // The app sends a bare wall clock with no date and no zone. Turning that
    // into a real moment meant guessing a date on the server and a timezone
    // nobody had established — three clocks in the chain (the reporting
    // driver's PC, the relaying PC, this server) and a browser rendering a
    // fourth. A session running past midnight in any of them landed a whole
    // day out. The press-to-post path, meanwhile, is a button, a network
    // message inside the lobby and one HTTP request: the arrival time is
    // within a second or two of the incident, and it involves nobody's clock
    // but this machine's.
    //
    // The app's own clock string is still checked against that arrival, and it
    // earns a line in the body only when the two genuinely disagree about the
    // moment — drift stays visible, while the ordinary evening stops printing a
    // second, differently-zoned time under every report for a steward to
    // second-guess the first one with. See lib/reportClock.js.
    const incidentAt = new Date();
    const said = String(req.body?.content || "").trim();
    const body = [
      said || "Reported from inside the race. The driver can add what happened below.",
      clockNote(rawTime, incidentAt),
    ]
      .filter(Boolean)
      .join("\n\n");

    // How far into the session it happened, taken off the live board while the
    // session is still on air.
    //
    // Without this an in-game report carried a wall clock and nothing else
    // until the round's result file was imported — which is the one figure a
    // steward cannot use, because dragging a replay timeline needs "N seconds
    // in", not "20:36 in somebody's timezone". A report filed after the race by
    // picking the contact out of the result file has carried that figure all
    // along; this is the mid-race button catching up with it.
    //
    // Provisional on purpose: the round's result file replaces it the moment it
    // is imported (see lib/reportAnchor.js), first with the same arithmetic
    // measured off the archive and then, where the file can name the contact
    // this report is about, with that contact's own timestamp.
    const sessionSecond = await liveSessionSecond(raceId);

    const report = await dbCreateReport(prisma, {
      body,
      reporterDiscordId: hit ? discordIds.get(hit.id) || null : null,
      reporterName: rawName,
      raceId,
      source: "INGAME",
      incidentAt: incidentAt.toISOString(),
      contactSecond: sessionSecond,
    });
    recordIngest(rawName);
    res.json({ ok: true, id: report.id });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// --- in-game report guards --------------------------------------------------

// How far into the live session we are, for a report arriving from inside it.
// Best-effort in every direction: no live board, no race on air, or two races
// on air at once and the report simply keeps its wall clock, which is what it
// had before this existed.
async function liveSessionSecond(raceId) {
  try {
    const race = raceId
      ? await prisma.race.findUnique({
          where: { id: raceId },
          select: { season: { select: { series: { select: { slug: true } } } } },
        })
      : null;
    const slug = race?.season?.series?.slug || null;
    return liveRaceSecond(slug ? await serverKeyForSeries(prisma, slug) : null);
  } catch {
    return null;
  }
}

// A ceiling on in-game reports as a whole, keyed on nothing: every post
// carries the one shared key, so there is no per-person identity to count here
// (the name in the title is a claim, not an authenticated one). Deliberately
// high — a first-corner pile-up genuinely produces a dozen presses.
const INGEST_WINDOW_MS = 10 * 60 * 1000;
const INGEST_MAX = 40;
let ingestHits = [];

function ingestFlooded() {
  const cutoff = Date.now() - INGEST_WINDOW_MS;
  ingestHits = ingestHits.filter((t) => t > cutoff);
  return ingestHits.length >= INGEST_MAX;
}

function recordIngest() {
  ingestHits.push(Date.now());
}

// The same driver's press already landed for this round, moments ago: almost
// certainly a second relay machine forwarding the same lobby message. Returns
// the existing report so the caller answers OK — the app must not see an error
// for something that worked.
const DUPE_WINDOW_MS = 60 * 1000;
async function recentIngestFor(prisma, name, raceId) {
  try {
    // Raw SQL, like every other read of these tables: the Report models are
    // managed by hand (see lib/reports.js) and the generated client does not
    // expose `prisma.report` at all. Going through the client here failed
    // silently inside the catch below and the dedupe never ran.
    const since = new Date(Date.now() - DUPE_WINDOW_MS).toISOString();
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "raceId" FROM "Report"
        WHERE "source" = 'INGAME' AND "reporterName" = ? AND datetime("createdAt") >= datetime(?)
        ORDER BY datetime("createdAt") DESC LIMIT 5`,
      name,
      since
    );
    return rows.find((r) => (r.raceId || null) === (raceId || null)) || null;
  } catch {
    // A failed lookup must never block a report. Worst case the league gets
    // two rows for one incident, which an admin can delete.
    return null;
  }
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
    // Bounded on BOTH sides. With only an upper bound, a report fired on a
    // quiet Tuesday attached itself to whatever round last happened, however
    // long ago — and an in-game report can only ever be about a session
    // happening right now. An evening's window: from an hour before the
    // scheduled start (grid, formation, a red flag restart) to six hours
    // after, which covers the longest race night the league has ever run.
    const races = await prisma.race.findMany({
      where: {
        date: {
          not: null,
          lte: new Date(now + 60 * 60 * 1000),
          gte: new Date(now - 6 * 60 * 60 * 1000),
        },
      },
      select: { id: true },
      orderBy: { date: "desc" },
      take: 1,
    });
    // Nothing in the window is a real answer: the report lands under "no round
    // given" and an admin moves it, which is honest. Guessing a round from
    // three weeks ago is not.
    return races[0]?.id || null;
  } catch {
    return null;
  }
}

export default router;
