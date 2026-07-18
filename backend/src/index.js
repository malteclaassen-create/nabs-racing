import "dotenv/config";
import express from "express";
import cors from "cors";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

import standingsRoutes from "./routes/standings.js";
import driversRoutes from "./routes/drivers.js";
import racesRoutes from "./routes/races.js";
import tracksRoutes from "./routes/tracks.js";
import eventsRoutes from "./routes/events.js";
import marketRoutes from "./routes/market.js";
import meRoutes from "./routes/me.js";
import teamsRoutes from "./routes/teams.js";
import seasonsRoutes from "./routes/seasons.js";
import seriesRoutes from "./routes/series.js";
import settingsRoutes from "./routes/settings.js";
import authRoutes from "./routes/auth.js";
import discordAuthRoutes from "./routes/discordAuth.js";
import downloadsRoutes from "./routes/downloads.js";
import notificationsRoutes from "./routes/notifications.js";
import searchRoutes from "./routes/search.js";
import adminRoutes from "./routes/admin.js";
import { initLiveTiming, getBoard, getTrackMapPng } from "./services/liveTiming.js";
import { serverKeyForSeries } from "./lib/liveServers.js";
import { recordHit } from "./lib/traffic.js";
import { buildLiveChampionship } from "./services/liveChampionshipService.js";
import { isAdminRequest } from "./middleware/auth.js";
import prisma from "./lib/prisma.js";
import { ensureDownloadTables } from "./lib/downloads.js";
import { ensureAppSchema } from "./lib/ensureSchema.js";
import { backfillCardIntro, announceFeatures } from "./lib/notifications.js";
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
app.use(express.json({ limit: "12mb" }));

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
}));

// Live timing (Assetto Corsa Server Manager relay). REST snapshot for fallback/
// debugging; the live stream is the WebSocket at /api/live/ws (set up below).
// Every live read resolves WHICH race server through the series it's for
// (?series=<slug>, admin-assigned; none = the first server).
app.get("/api/live/timing", async (req, res) =>
  res.json(getBoard(await serverKeyForSeries(prisma, req.query.series)))
);

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
app.use("/api/me", meRoutes);
app.use("/api/teams", teamsRoutes);
app.use("/api/seasons", seasonsRoutes);
app.use("/api/series", seriesRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/auth/discord", discordAuthRoutes);
app.use("/api/downloads", downloadsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/search", searchRoutes);

// Admin
app.use("/api/admin", authRoutes); // /api/admin/login
app.use("/api/admin", adminRoutes); // everything else (auth-guarded)

// Optionally serve the built frontend from this same process, so the whole site
// (website + API + downloads) runs as ONE program under ONE origin — no separate
// web server needed. Only kicks in when a production build exists
// (frontend/dist); local dev has no dist, so nothing changes there (the Vite dev
// server keeps serving the site and proxying /api here).
const DIST_DIR = join(__dir, "../../frontend/dist");
if (existsSync(join(DIST_DIR, "index.html"))) {
  app.use(express.static(DIST_DIR, {
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
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(DIST_DIR, "index.html"));
  });
  console.log("Serving built frontend from", DIST_DIR);
}

// 404
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Error handler. Errors may carry an explicit HTTP status (e.g. validation
// failures throw with err.status = 400); everything else is a 500.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`NABS Racing API listening on http://localhost:${PORT}`);
});

// Live timing relay + frontend WebSocket (/api/live/ws).
initLiveTiming(server);
