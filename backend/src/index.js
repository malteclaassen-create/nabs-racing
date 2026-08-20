import "dotenv/config";
import express from "express";
import cors from "cors";
import compression from "compression";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";

import standingsRoutes from "./routes/standings.js";
import driversRoutes from "./routes/drivers.js";
import racesRoutes from "./routes/races.js";
import tracksRoutes from "./routes/tracks.js";
import telemetryLapsRoutes from "./routes/telemetryLaps.js";
import eventsRoutes from "./routes/events.js";
import marketRoutes from "./routes/market.js";
import meRoutes from "./routes/me.js";
import cockpitRoutes from "./routes/cockpit.js";
import teamsRoutes from "./routes/teams.js";
import seasonsRoutes from "./routes/seasons.js";
import seriesRoutes from "./routes/series.js";
import settingsRoutes from "./routes/settings.js";
import authRoutes from "./routes/auth.js";
import discordAuthRoutes from "./routes/discordAuth.js";
import steamAuthRoutes from "./routes/steamAuth.js";
import downloadsRoutes from "./routes/downloads.js";
import notificationsRoutes from "./routes/notifications.js";
import feedbackRoutes from "./routes/feedback.js";
import reportsRoutes from "./routes/reports.js";
import devLoginRoutes from "./routes/devLogin.js";
import { sweepReportFiles } from "./services/reportHousekeeping.js";
import { IS_DEPLOYED } from "./lib/deployment.js";
import searchRoutes from "./routes/search.js";
import adminRoutes from "./routes/admin.js";
import { initLiveTiming, getBoard, getTrackMapPng } from "./services/liveTiming.js";
import { startMemoryLog } from "./services/memoryDiagnostics.js";
import { serverKeyForSeries } from "./lib/liveServers.js";
import { recordHit } from "./lib/traffic.js";
import { buildLiveChampionship } from "./services/liveChampionshipService.js";
import { isAdminRequest, resolveAdminContext } from "./middleware/auth.js";
import { buildPageMeta, applyPageMeta, buildOrganizationJsonLd, applyJsonLd } from "./lib/pageMeta.js";
import { buildRobotsTxt, buildSitemapXml } from "./lib/sitemap.js";
import { buildCrawlLinks, applyCrawlLinks } from "./lib/crawlLinks.js";
import { legacyRedirects, canonicalUrl, applyCanonical, isKnownRoute, seriesSlugKnown, applyNoindex } from "./lib/seo.js";
import prisma from "./lib/prisma.js";
import { ensureDownloadTables } from "./lib/downloads.js";
import { ensureAppSchema } from "./lib/ensureSchema.js";
import { backfillCardIntro, announceFeatures, ensureRaceReminders } from "./lib/notifications.js";
import { recomputeStintsOnce } from "./lib/stintRecompute.js";
import { UPLOADS_DIR } from "./lib/dataDirs.js";

// Schema upkeep that runs outside `prisma migrate` (raw SQL — see the comment
// in lib/downloads.js). Idempotent, so it's safe on every boot. Chained so the
// app-wide columns/tables exist before the download tables' backfill runs, and
// the one-time card-unlock catch-up (guarded by its own flag) runs last, once
// the columns it reads are guaranteed to exist.
ensureAppSchema(prisma)
  .then(() => ensureDownloadTables(prisma))
  .then(() => backfillCardIntro(prisma))
  // One-time S8 stint recompute (flag-guarded): carries the pit-detection fix
  // to databases whose races were imported under the old rule — this is the
  // only way it reaches the hosted instance, which has no shell for scripts.
  .then(() => recomputeStintsOnce(prisma))
  // One-off feature announcements (broadcasts, deduped so reboots never repeat).
  .then(() => announceFeatures(prisma))
  .catch((e) => console.error("schema upkeep:", e));

const app = express();
const PORT = process.env.PORT || 4000;

// In production a reverse proxy / hosting edge (Railway, Cloudflare, Caddy, a
// dev tunnel) sits in front, so the direct peer is the proxy. Trust its
// X-Forwarded-* headers so req.ip is the real visitor — otherwise the admin
// login limiter would count ALL visitors as one IP and lock everyone out
// together after a few failed attempts.
app.set("trust proxy", 1);

const origins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

app.use(cors({ origin: origins }));

// Gzip everything compressible on the way out. The built frontend bundle alone
// is ~980 kB of JavaScript and was being sent verbatim; compressed it is ~275 kB,
// so this saves roughly 700 kB on every first visit — the single biggest win for
// anyone loading the site on phone data. Already-compressed formats (png, jpg,
// woff2, zip) are skipped automatically, and a response can opt out with the
// header `Cache-Control: no-transform`.
app.use(
  compression({
    filter(req, res) {
      // The mod catalogue streams with HTTP range support so a multi-gigabyte
      // download can be paused and resumed. Compression rewrites the body and
      // drops Content-Length, which breaks resuming — and those files (zip/7z)
      // are already compressed anyway. Never touch that route, whatever the
      // file inside happens to be.
      if (req.path.startsWith("/api/downloads/") && req.path.endsWith("/file")) return false;
      return compression.filter(req, res);
    },
  })
);

// Baseline browser protections. Deliberately NOT a full Content-Security-Policy
// for the site itself: profile pictures come straight from Discord's CDN and
// the theme switch runs an inline script in index.html, so a strict policy
// would need a careful allowlist first. These four are safe as they stand.
app.use((req, res, next) => {
  // Don't let a browser guess a file's type against what we declared.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Clickjacking: nobody may frame the site to trick members into clicking.
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Don't hand full URLs (which can name a driver or a race) to other sites.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // No page here needs the camera, microphone or location.
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(express.json({ limit: "12mb" }));

// Works out once per request whether this caller is currently an admin, so the
// public read routes can show private seasons to an admin without a database
// round trip each time they ask. Must sit ahead of every router below.
app.use(resolveAdminContext);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Anonymous page-view beacon for the admin Traffic tab (see lib/traffic.js:
// no cookies, nothing personal stored, bots and admin pages filtered out).
// Always answers 204 — analytics must never break or slow the site.
app.post("/api/hit", (req, res) => {
  recordHit(prisma, {
    path: req.body?.path,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  }).catch(() => {});
  res.status(204).end();
});

// User-uploaded files (e.g. driver profile pictures from /api/me/photo). Served
// under /api/* on purpose so they go through the Vite proxy in both dev and the
// shared preview build — see the comment in routes/me.js. Long cache is safe:
// the stored URLs carry a ?v=<timestamp> that changes on every re-upload.
const __dir = dirname(fileURLToPath(import.meta.url));
app.use("/api/uploads", express.static(UPLOADS_DIR, {
  maxAge: "30d",
  immutable: true,
  // These files are uploaded through the admin area and then served from the
  // SAME origin as the site. An SVG is allowed to contain <script>, so opening
  // a booby-trapped logo URL directly would run that script as if the league
  // site had written it. The sandbox + locked-down CSP below neutralises that
  // while leaving the file perfectly usable as an <img> (image rendering never
  // executes scripts anyway), so SVG logos keep working as before.
  setHeaders(res) {
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
  },
}));

// The API answers questions, it is not a set of pages. robots.txt opens the
// public read endpoints for CRAWLING, because a crawler that cannot fetch
// /api/standings/drivers renders this site as a heading above nothing (the whole
// story is in lib/sitemap.js, API_ALLOW). This header is the other half of that
// deal: fetch it to render a page, never list the raw JSON as a result of its
// own. Deliberately mounted BELOW /api/uploads, whose driver photos and team
// logos are the one thing here that IS worth turning up in a search.
app.use("/api", (req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex");
  next();
});

// Live timing (Assetto Corsa Server Manager relay). REST snapshot for fallback/
// debugging; the live stream is the WebSocket at /api/live/ws (set up below).
// Every live read resolves WHICH race server through the series it's for
// (?series=<slug>, admin-assigned; none = the first server).
app.get("/api/live/timing", async (req, res) =>
  res.json(getBoard(await serverKeyForSeries(prisma, req.query.series)))
);

// Is anything actually happening right now? Two numbers and a word, so the nav
// bar can carry a live dot on its Live item without every page pulling the whole
// timing board (which is the full grid with sectors, stints and positions —
// kilobytes, several times a minute, on every page of the site).
//
// Nothing anywhere told a visitor a session was running: Live Timing sat in the
// nav looking exactly the same on a Tuesday afternoon as it does mid-race, so
// the one moment the page is worth opening was the one moment nothing pointed
// at it. `stale` is the relay's own "no upstream data for 75 seconds" flag, and
// a quiet server still reports every ~30s, so this only says live when it is.
app.get("/api/live/status", async (req, res) => {
  try {
    const board = getBoard(await serverKeyForSeries(prisma, req.query.series));
    const onTrack = (board.entries || []).filter((e) => e.onTrack).length;
    res.json({
      live: !!board.ok && !board.stale && !!board.session,
      onTrack,
      session: board.session?.type || null,
      track: board.session?.trackName || board.session?.track || null,
    });
  } catch {
    // Never let a decoration break a page: unknown simply reads as "not live".
    res.json({ live: false, onTrack: 0, session: null, track: null });
  }
});

// The real overhead track map (proxied + cached from the server manager's public
// content), drawn under the live car dots. 404 until a track with a usable map is
// loaded; the frontend then falls back to the stylised outline. The ?v= token in
// the board's session.map busts the browser cache when the track changes.
app.get("/api/live/map.png", async (req, res) => {
  const png = getTrackMapPng(await serverKeyForSeries(prisma, req.query.series));
  if (!png) return res.status(404).json({ error: "No track map" });
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(png);
});

// Live championship projection: standings as if the RUNNING race ended in the
// current order. Only active while a league race is on (see the service's
// guards); otherwise { active: false }. Admins can demo it off race day with
// ?simulate=1 (uses the next uncompleted race + a reshuffled current top).
app.get("/api/live/championship", async (req, res, next) => {
  try {
    const simulate = req.query.simulate === "1" && isAdminRequest(req);
    const board = getBoard(await serverKeyForSeries(prisma, req.query.series));
    res.json(await buildLiveChampionship(prisma, board, { simulate }));
  } catch (e) {
    next(e);
  }
});

// Public
app.use("/api/standings", standingsRoutes);
app.use("/api/drivers", driversRoutes);
app.use("/api/races", racesRoutes);
app.use("/api/tracks", tracksRoutes);
// Telemetry laps: the in-game recorder posts here (key-gated), /tools reads.
app.use("/api/telemetry-laps", telemetryLapsRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/me/cockpit", cockpitRoutes); // before /api/me: the more specific mount wins
app.use("/api/me", meRoutes);
app.use("/api/teams", teamsRoutes);
app.use("/api/seasons", seasonsRoutes);
app.use("/api/series", seriesRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/auth/discord", discordAuthRoutes);
app.use("/api/auth/steam", steamAuthRoutes);
app.use("/api/downloads", downloadsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/reports", reportsRoutes);
// Signing in as any driver, for testing both sides of a report on one machine.
// The router refuses to mount on anything that looks like a deployment, and
// refuses every request that did not come from the loopback address. See the
// note at the top of routes/devLogin.js — it is an authentication bypass and it
// is treated as one.
if (!IS_DEPLOYED) app.use("/api/dev", devLoginRoutes);
app.use("/api/search", searchRoutes);

// Admin
app.use("/api/admin", authRoutes); // /api/admin/login
app.use("/api/admin", adminRoutes); // everything else (auth-guarded)

// Search engines: what may be crawled, and the list of pages worth crawling.
// Generated per request because the site's address is not fixed (localhost, a
// tunnel, the league domain, and whatever the admin uses after the handover) —
// a sitemap naming the wrong host is worse than none. `trust proxy` is set
// above, so the protocol is the one the visitor actually used.
const publicOrigin = (req) => `${req.protocol}://${req.get("host")}`;

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(buildRobotsTxt(publicOrigin(req)));
});

app.get("/sitemap.xml", async (req, res, next) => {
  try {
    const xml = await buildSitemapXml(prisma, publicOrigin(req));
    res.type("application/xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  } catch (e) {
    next(e);
  }
});

// Optionally serve the built frontend from this same process, so the whole site
// (website + API + downloads) runs as ONE program under ONE origin — no separate
// web server needed. Only kicks in when a production build exists
// (frontend/dist); local dev has no dist, so nothing changes there (the Vite dev
// server keeps serving the site and proxying /api here).
const DIST_DIR = join(__dir, "../../frontend/dist");
// The file types the build precompresses, mapped to the Content-Type the
// browser must still see. Written out rather than guessed from the name,
// because the name it would guess from ends in ".br".
// (res.type() appends the charset for the text formats, same as express.static.)
const PRECOMPRESSED_TYPES = {
  js: "application/javascript",
  mjs: "application/javascript",
  css: "text/css",
  json: "application/json",
  map: "application/json",
  svg: "image/svg+xml",
  txt: "text/plain",
  xml: "application/xml",
};
if (existsSync(join(DIST_DIR, "index.html"))) {
  // Old flat addresses (/drivers, /races, …) answer with a real redirect into
  // the series they belong to, instead of the app rewriting the address after
  // it has loaded. Before the static files, so it also catches a crawler.
  app.use(legacyRedirects(prisma));
  // Hand out the ready-made .br / .gz copies the build wrote next to each
  // hashed asset (frontend/scripts/precompress-assets.mjs). The compression
  // middleware above would otherwise gzip the same unchanged bundle again for
  // every visitor, at zlib's fast-and-weak default level; brotli-11 from the
  // build is both smaller and free at request time.
  //
  // Only /assets/ — those names carry a content hash, so the pair of files can
  // never drift apart. Everything else (API answers, uploads, index.html, which
  // is rewritten per request) keeps going through compression() as before.
  app.use("/assets", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    let rel;
    try {
      rel = decodeURIComponent(req.path);
    } catch {
      return next(); // malformed escape: let express.static deal with it
    }
    // Nothing may reach outside the assets folder, and only the file types the
    // build actually precompresses are worth looking up.
    if (rel.includes("\0") || rel.includes("..")) return next();
    const type = PRECOMPRESSED_TYPES[(rel.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase()];
    if (!type) return next();

    // Brotli first where the client takes it (smaller), gzip otherwise. Asked
    // one at a time on purpose: acceptsEncodings() with a list answers with the
    // client's own order, and browsers list "gzip, deflate, br" — which would
    // hand out the bigger file to everyone. Both calls still honour a "br;q=0".
    const encoding = req.acceptsEncodings("br") ? "br" : req.acceptsEncodings("gzip") ? "gzip" : null;
    if (!encoding) return next();

    const original = join(DIST_DIR, "assets", rel);
    const file = original + (encoding === "br" ? ".br" : ".gz");
    if (!existsSync(file)) return next(); // older build, or a file not worth compressing

    // Content-Type must stay the ORIGINAL one: the browser has to run this as
    // JavaScript, not download it as an octet-stream. Setting it here also stops
    // sendFile from guessing "br"/"gz" from the extension.
    res.type(type);
    res.setHeader("Content-Encoding", encoding);
    // Caches must key on the encoding, or a gzip copy could be replayed to a
    // client that only speaks identity.
    res.setHeader("Vary", "Accept-Encoding");
    // Same rule express.static applies to /assets/ below — hashed names never
    // go stale.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    // compression() skips any response that already carries a Content-Encoding,
    // so the body is sent exactly as it lies on disk (no double compression).
    res.sendFile(file, (err) => {
      if (!err) return;
      if (res.headersSent) return res.end(); // mid-stream: nothing left to do
      // Never let a half-set Content-Encoding follow us into the plain
      // delivery below, or the browser would try to un-brotli a raw file.
      res.removeHeader("Content-Encoding");
      res.removeHeader("Content-Type");
      next();
    });
  });
  app.use(express.static(DIST_DIR, {
    // Do NOT answer "/" with index.html from here. The handler below adds the
    // link preview and the canonical address, and static delivery would skip
    // both on the one page that needs them most.
    index: false,
    // Tell browsers to keep static files instead of re-asking on every page
    // switch (matters a lot over a tunnel, where each request costs ~0.5s).
    setHeaders(res, filePath) {
      if (/[\\/]assets[\\/]/.test(filePath)) {
        // Vite build output has a content hash in the file name -> can never
        // go stale, cache "forever".
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (/\.(png|jpe?g|webp|svg|gif|ico|woff2?)$/i.test(filePath)) {
        // Flags, team logos, fonts, hero images: stable files, 7 days.
        res.setHeader("Cache-Control", "public, max-age=604800");
      } else {
        // index.html and friends: always revalidate so a new build shows up.
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }));
  // SPA fallback: any non-API GET returns index.html so client-side routes work
  // on refresh / deep links (e.g. /downloads). API paths fall through to the 404.
  //
  // Shareable routes get their link preview filled in first (see lib/pageMeta):
  // Discord and friends don't run the app's JavaScript, so without this every
  // pasted driver or team link unfurled as the same generic site card.
  app.get("*", async (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    const indexPath = join(DIST_DIR, "index.html");
    let html;
    try {
      html = readFileSync(indexPath, "utf8");
    } catch {
      return res.sendFile(indexPath); // unreadable for once: at least send the file
    }
    // Title and description for the routes that have something of their own to
    // say (a driver, a team, a season's tables, a single round). The query is
    // part of that: ?season= and ?race= are what select which season's tables
    // and which round the page shows.
    try {
      const meta = await buildPageMeta(prisma, req.path, req.query);
      if (meta) html = applyPageMeta(html, meta);
    } catch {
      /* a preview must never cost us the page */
    }
    // Who the league is, in machine-readable form, on the one page everything
    // else links to. Google currently answers "what is NABS Racing" out of
    // SimGrid for want of the league saying so itself.
    if (req.path === "/" || req.path === "/join") {
      try {
        html = applyJsonLd(html, await buildOrganizationJsonLd(prisma, publicOrigin(req)));
      } catch {
        /* same rule */
      }
    }
    // An address the app has no page for. It still gets index.html (the app
    // renders its own 404 screen, which is friendlier than a server error page),
    // but with the honest status and without a canonical tag telling a crawler
    // this nonsense URL is a real page worth keeping.
    const known = isKnownRoute(req.path) && (await seriesSlugKnown(prisma, req.path));
    if (!known) {
      html = applyNoindex(html);
      res.status(404);
    } else {
      // The official address of whatever this renders. Every page gets one: it
      // settles which of several spellings of the same page counts (/races vs
      // /calendar, /drivers vs /drivers?season=<the active one>), and equally
      // which parameters do name a page of their own (an archived season's
      // tables, a single round).
      try {
        html = applyCanonical(html, await canonicalUrl(req, prisma));
      } catch {
        /* same rule: never lose the page over a tag */
      }
      // The links this page renders, written into the root element so they are
      // in the delivered HTML rather than only in the browser's memory once
      // React has run (see lib/crawlLinks.js for why that mattered). Only for
      // addresses that ARE a page: the 404 branch above has nothing to link to.
      try {
        html = applyCrawlLinks(html, await buildCrawlLinks(prisma, req.path, req.query));
      } catch {
        /* same rule again */
      }
    }
    res.setHeader("Cache-Control", "no-cache"); // matches the static index.html
    res.type("html").send(html);
  });
  console.log("Serving built frontend from", DIST_DIR);
}

// 404
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Error handler. Errors may carry an explicit HTTP status (e.g. validation
// failures throw with err.status = 400); everything else is a 500.
//
// Only DELIBERATE errors (4xx, thrown by our own validation) show their text to
// the caller. An unexpected 500 keeps its message on the server: a Prisma
// failure spells out table and column names, and those would otherwise be
// readable by anyone who can trigger the error. The full error still goes to
// the log above, so nothing is lost for debugging.
app.use((err, req, res, next) => {
  console.error(err);
  // multer speaks in codes, and the one that matters here is a file over the
  // limit. Without this it arrives as an unexplained 500, and "something went
  // wrong on our side" is the wrong thing to tell somebody who attached a
  // 40 MB clip.
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "That file is too big. The limit is 20 MB." });
  }
  if (err?.code === "LIMIT_FILE_COUNT" || err?.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({ error: "Too many files at once." });
  }
  const status = err.status || 500;
  // Deliberate 4xx keep their text. An unexpected 500 shows its real message
  // only to a signed-in admin — they are the one who has to fix it, and losing
  // the cause in the UI would make the admin area harder to work with than it
  // was before. Everyone else gets the neutral line.
  const showDetail = (status < 500 || isAdminRequest(req)) && err.message;
  res.status(status).json({ error: showDetail ? err.message : "Something went wrong on our side." });
});

// Last-resort net. This one process is the entire site: the pages, the API, the
// downloads and the live relay. Node's default for an unhandled rejection is to
// end the process, so a single forgotten .catch() somewhere off the request path
// (a background timer, a fire-and-forget write) would take the league offline
// mid-race with nothing in the log to explain it.
//
// Staying up is the right trade here rather than the usual "log and exit": the
// specific failure this was written for, a client socket dying mid-frame, is now
// handled where it happens (see initLiveTiming), so anything reaching this point
// is already unexpected, and a hobby league is better served by a site that is
// still answering than by a clean shutdown nobody is watching for. Express keeps
// its own per-request error handling either way — these only catch what escapes
// it entirely. Anything logged here is a real bug and should be chased down.
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandled promise rejection:", reason?.stack || reason);
});
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaught exception:", err?.stack || err);
});

const server = app.listen(PORT, () => {
  console.log(`NABS Racing API listening on http://localhost:${PORT}`);
});

// A listen failure is the one error we must NOT survive. The handlers above
// deliberately keep the process alive through unexpected faults, but if the port
// could not be taken there is nothing to keep alive: the process would sit there
// answering nothing while a supervisor (Railway, node --watch) believes it is up.
// Say why and stop, so the restart actually happens.
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`[fatal] port ${PORT} is already in use. Is another copy of the server running?`);
  } else {
    console.error("[fatal] server error:", e?.stack || e);
  }
  process.exit(1);
});

// Live timing relay + frontend WebSocket (/api/live/ws).
initLiveTiming(server);

// A [mem] line every 5 minutes: total memory vs JS heap vs native buffers,
// plus live-timing sizes. Exists so the next unexplained memory climb (like
// race night 2026-08-07) can be read straight out of the Railway logs instead
// of being reconstructed from guesses. Same report as GET /api/admin/memory.
startMemoryLog();

// Race reminders on a clock of their own. They used to exist only as a side
// effect of somebody's bell polling, which meant the reminder that matters most
// (the one an hour before lights out) was never created at all if no member
// happened to have a tab open in that hour — and it is never caught up later,
// because each offset only fires inside its own slice of the countdown.
// ensureRaceReminders throttles itself to one real check per 5 minutes and
// dedupes what it posts, so calling it here as well costs nothing and simply
// removes the dependency on someone being online. unref() so this timer never
// holds the process open on its own.
// Housekeeping for report attachments. Hourly is plenty for a window measured
// in days, and once at boot so a freshly-changed setting takes effect without
// waiting. unref() so it never holds the process open on its own.
const REPORT_SWEEP_MS = 60 * 60 * 1000;
const sweepReports = () =>
  sweepReportFiles(prisma).catch((e) => console.error("[reports]", e?.message || e));
setTimeout(sweepReports, 20_000).unref();
setInterval(sweepReports, REPORT_SWEEP_MS).unref();

const REMINDER_TICK_MS = 5 * 60 * 1000;
setInterval(() => {
  ensureRaceReminders(prisma).catch((e) => console.error("[reminders]", e?.message || e));
}, REMINDER_TICK_MS).unref();
