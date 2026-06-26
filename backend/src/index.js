import "dotenv/config";
import express from "express";
import cors from "cors";

import standingsRoutes from "./routes/standings.js";
import driversRoutes from "./routes/drivers.js";
import racesRoutes from "./routes/races.js";
import eventsRoutes from "./routes/events.js";
import meRoutes from "./routes/me.js";
import teamsRoutes from "./routes/teams.js";
import seasonsRoutes from "./routes/seasons.js";
import authRoutes from "./routes/auth.js";
import discordAuthRoutes from "./routes/discordAuth.js";
import adminRoutes from "./routes/admin.js";
import { initLiveTiming, getBoard } from "./services/liveTiming.js";

const app = express();
const PORT = process.env.PORT || 4000;

const origins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

app.use(cors({ origin: origins }));
app.use(express.json({ limit: "12mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Live timing (Assetto Corsa Server Manager relay). REST snapshot for fallback/
// debugging; the live stream is the WebSocket at /api/live/ws (set up below).
app.get("/api/live/timing", (req, res) => res.json(getBoard()));

// Public
app.use("/api/standings", standingsRoutes);
app.use("/api/drivers", driversRoutes);
app.use("/api/races", racesRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/me", meRoutes);
app.use("/api/teams", teamsRoutes);
app.use("/api/seasons", seasonsRoutes);
app.use("/api/auth/discord", discordAuthRoutes);

// Admin
app.use("/api/admin", authRoutes); // /api/admin/login
app.use("/api/admin", adminRoutes); // everything else (auth-guarded)

// 404
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`NABS Racing API listening on http://localhost:${PORT}`);
});

// Live timing relay + frontend WebSocket (/api/live/ws).
initLiveTiming(server);
