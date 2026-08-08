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
import { legacyRedirects, canonicalUrl, applyCanonical, isKnownRoute, applyNoindex } from "./lib/seo.js";
import prisma from "./lib/prisma.js";
import { ensureDownloadTables } from "./lib/downloads.js";
import { ensureAppSchema } from "./lib/ensureSchema.js";
import { backfillCardIntro, announceFeatures, ensureRaceReminders } from "./lib/notifications.js";
import { UPLOADS_DIR } from "./lib/dataDirs.js";

// Schema upkeep that runs outside `prisma migrate` (raw SQL — see the comment
// in lib/downloads.js). Idempotent, so it's safe on every boot. Chained so the
// app-wide columns/tables exist before the download tables' backfill runs, and
// the one-time card-unlock catch-up (guarded by its own flag) runs last, once
// the columns it reads are guaranteed to exist.
ensureAppSchema(prisma)
  .then(() => ensureDownloadTables(prisma))
  .then(() => backfillCardIntro(prisma))
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
if (existsSync(join(DIST_DIR, "index.html"))) {
  // Old flat addresses (/drivers, /races, …) answer with a real redirect into
  // the series they belong to, instead of the app rewriting the address after
  // it has loaded. Before the static files, so it also catches a crawler.
  app.use(legacyRedirects(prisma));
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
    const known = isKnownRoute(req.path);
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
const REMINDER_TICK_MS = 5 * 60 * 1000;
setInterval(() => {
  ensureRaceReminders(prisma).catch((e) => console.error("[reminders]", e?.message || e));
}, REMINDER_TICK_MS).unref();
