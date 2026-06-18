// Live timing relay for the Assetto Corsa Server Manager.
//
// The server manager (https://nabs1.emperorservers.com) streams its live data
// over a WebSocket at /api/race-control, but it rejects cross-origin browsers
// (403 unless the Origin header matches its own host). So we cannot connect
// from the browser directly. Instead this backend holds a single upstream
// connection (with the right Origin), keeps the latest state in memory, and
// re-broadcasts a clean, throttled "timing board" to our own frontend clients
// over /api/live/ws.
//
// Upstream protocol (reverse-engineered from server-manager.js v2.4.15):
//   EventType 200 — full status snapshot (sent on connect + every ~30s).
//                   Carries SessionInfo, TrackInfo, ConnectedDrivers and, per
//                   driver, Cars[carModel] with BestLap/LastLap/NumLaps/
//                   TopSpeedBestLap (lap times are in NANOseconds).
//   EventType 53  — high-frequency per-car telemetry (RacePosition, Gap,
//                   IsInPits, DRSActive, NumPits, NormalisedSplinePos…).
//   EventType 57  — chat (ignored).
import { WebSocketServer, WebSocket } from "ws";

const UPSTREAM_URL = process.env.LIVE_TIMING_WS || "wss://nabs1.emperorservers.com/api/race-control";
const UPSTREAM_ORIGIN = process.env.LIVE_TIMING_ORIGIN || "https://nabs1.emperorservers.com";
const BROADCAST_MS = 700; // how often we push a fresh board to frontend clients
const STALE_MS = 15000; // no upstream message for this long => mark stale

let upstream = null;
let reconnectTimer = null;
let reconnectDelay = 1000;

let status = null; // latest EventType 200 Message (full snapshot)
const liveByCar = new Map(); // CarID -> latest EventType 53 telemetry
let lastMessageAt = 0;

const nsToMs = (ns) => (typeof ns === "number" && ns > 0 ? Math.round(ns / 1e6) : null);

function sessionTypeName(t) {
  return { 0: "Booking", 1: "Practice", 2: "Qualifying", 3: "Race" }[t] || "Session";
}

function upstreamOpen() {
  return upstream && upstream.readyState === WebSocket.OPEN;
}

function connectUpstream() {
  upstream = new WebSocket(UPSTREAM_URL, { headers: { Origin: UPSTREAM_ORIGIN } });

  upstream.on("open", () => {
    reconnectDelay = 1000;
    console.log("[live] upstream connected:", UPSTREAM_URL);
  });

  upstream.on("message", (buf) => {
    lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    switch (msg.EventType) {
      case 200: // full snapshot — refreshes lap times; reset stale telemetry
        status = msg.Message;
        liveByCar.clear();
        break;
      case 53: // per-car telemetry
        if (msg.Message && typeof msg.Message.CarID === "number") {
          liveByCar.set(msg.Message.CarID, msg.Message);
        }
        break;
      default:
        break;
    }
  });

  upstream.on("close", () => {
    console.log("[live] upstream closed; reconnecting…");
    scheduleReconnect();
  });
  upstream.on("error", (e) => {
    console.log("[live] upstream error:", e.message);
    try {
      upstream.close();
    } catch {
      /* noop */
    }
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 15000); // backoff, capped
    connectUpstream();
  }, reconnectDelay);
}

// Pull the three best-lap sector boxes (with colour flags) off a car record.
function sectorsOf(splitObj) {
  if (!splitObj) return [null, null, null];
  return [0, 1, 2].map((i) => {
    const sp = splitObj[i] ?? splitObj[String(i)];
    if (!sp) return null;
    return {
      ms: nsToMs(sp.SplitTime),
      best: !!sp.IsBest, // overall fastest sector in the session (purple)
      driversBest: !!sp.IsDriversBest, // driver's own best sector (green)
      cuts: sp.Cuts || 0,
    };
  });
}

// "Potential" = sum of a driver's three best sectors (the ideal lap).
function potentialOf(bestSplits) {
  if (!bestSplits) return null;
  const arr = [0, 1, 2].map((i) => bestSplits[i] ?? bestSplits[String(i)]);
  if (!arr.every((x) => x && x.SplitTime > 0)) return null;
  return Math.round(arr.reduce((a, x) => a + x.SplitTime, 0) / 1e6);
}

function buildEntry(guid, d, onTrack) {
  const ci = d.CarInfo || {};
  const car = (d.Cars && ci.CarModel && d.Cars[ci.CarModel]) || null;
  const live = onTrack ? liveByCar.get(ci.CarID) || {} : {};
  return {
    guid,
    name: ci.DriverName || "—",
    initials: ci.DriverInitials || "",
    raceNumber: ci.RaceNumber ?? null,
    carModel: ci.CarModel || "",
    carName: ci.CarName || car?.CarName || "",
    carSkin: ci.CarSkin || "",
    tyre: car?.TyreBestLap || ci.Tyres || "",
    onTrack,
    bestLapMs: car ? nsToMs(car.BestLap) : null,
    lastLapMs: car ? nsToMs(car.LastLap) : null,
    // epoch ms of the last completed lap — frontend ticks the live current-lap
    // clock from here (now - lastLapAt) for on-track drivers.
    lastLapAt: car?.LastLapCompletedTime ? Date.parse(car.LastLapCompletedTime) || null : null,
    lapCount: car?.NumLaps ?? d.TotalNumLaps ?? 0,
    topSpeed: car && car.TopSpeedBestLap ? Math.round(car.TopSpeedBestLap) : null,
    sectors: sectorsOf(car?.BestLapSplits),
    potentialMs: potentialOf(car?.BestSplits),
    inPits: live.IsInPits ?? d.IsInPits ?? false,
    numPits: live.NumPits ?? d.NumPits ?? 0,
    ping: live.Ping ?? d.Ping ?? null,
    drs: live.DRSActive ?? d.DRSActive ?? false,
    deltaSelfMs: onTrack ? live.DeltaToSelf ?? d.DeltaToSelf ?? null : null,
    spline: live.NormalisedSplinePos ?? d.NormalisedSplinePos ?? 0,
  };
}

// Build the clean board we hand to the frontend.
export function getBoard() {
  if (!status) {
    return { ok: false, connected: upstreamOpen(), session: null, entries: [], updatedAt: Date.now() };
  }
  const si = status.SessionInfo || {};
  const ti = status.TrackInfo || {};
  const connected = status.ConnectedDrivers?.Drivers || {};
  const disconnected = status.DisconnectedDrivers?.Drivers || {};
  const sessionBestMs = nsToMs(status.BestLap);

  // Merge stored (disconnected) + on-track (connected) drivers, keyed by GUID;
  // a currently-connected entry overrides its stored counterpart.
  const byGuid = new Map();
  for (const [guid, d] of Object.entries(disconnected)) {
    if (d.CarInfo?.IsSpectator) continue;
    byGuid.set(guid, buildEntry(guid, d, false));
  }
  for (const [guid, d] of Object.entries(connected)) {
    if (d.CarInfo?.IsSpectator) continue;
    byGuid.set(guid, buildEntry(guid, d, true));
  }
  const entries = [...byGuid.values()];

  // Hot-lap ranking: fastest best lap first; drivers without a lap go last.
  entries.sort((a, b) => {
    if (a.bestLapMs && b.bestLapMs) return a.bestLapMs - b.bestLapMs;
    if (a.bestLapMs) return -1;
    if (b.bestLapMs) return 1;
    return (b.lapCount || 0) - (a.lapCount || 0);
  });
  // Sector colours: the upstream per-lap "IsBest" flag is unreliable (it can
  // mark a sector best that's since been beaten on another lap). Recompute
  // "purple" against the session's actual best sector times (top-level
  // BestSplits); "green" (driver's own best sector) keeps the IsDriversBest flag.
  const sessionBestSectors = Array.isArray(status.BestSplits)
    ? [0, 1, 2].map((i) => (status.BestSplits[i] ? nsToMs(status.BestSplits[i].SplitTime) : null))
    : [null, null, null];
  for (const e of entries) {
    e.sectors.forEach((s, i) => {
      if (s) s.best = sessionBestSectors[i] != null && s.ms === sessionBestSectors[i];
    });
  }

  // Gap is measured against the current leader's best lap (P1 = 0.000).
  const leaderBestMs = entries.find((e) => e.bestLapMs)?.bestLapMs || null;
  entries.forEach((e, i) => {
    e.position = i + 1;
    e.gapToBestMs = e.bestLapMs && leaderBestMs ? e.bestLapMs - leaderBestMs : null;
  });

  // Session remaining time (Time is in minutes; ElapsedMilliseconds from the
  // last full snapshot). Frontend ticks it down locally between snapshots.
  const remainingMs =
    si.Time > 0 ? Math.max(0, si.Time * 60000 - (si.ElapsedMilliseconds || 0)) : null;

  return {
    ok: true,
    connected: upstreamOpen(),
    stale: Date.now() - lastMessageAt > STALE_MS,
    session: {
      type: sessionTypeName(si.Type),
      name: si.Name || "",
      serverName: si.ServerName || "",
      track: si.Track || "",
      trackName: ti.name || si.Track || "",
      country: ti.country || "",
      ambientTemp: si.AmbientTemp ?? null,
      roadTemp: si.RoadTemp ?? null,
      weather: si.WeatherGraphics || "",
      bestLapMs: leaderBestMs ?? sessionBestMs,
      driverCount: entries.length,
      onTrackCount: entries.filter((e) => e.onTrack).length,
      sessionIndex: si.CurrentSessionIndex ?? 0,
      sessionCount: si.SessionCount ?? 1,
      remainingMs,
    },
    entries,
    updatedAt: Date.now(),
  };
}

// Attach the frontend-facing WebSocket and start the upstream connection.
export function initLiveTiming(server) {
  connectUpstream();

  const wss = new WebSocketServer({ server, path: "/api/live/ws" });

  wss.on("connection", (ws) => {
    // send a snapshot immediately so the board paints without waiting a tick
    try {
      ws.send(JSON.stringify(getBoard()));
    } catch {
      /* noop */
    }
  });

  setInterval(() => {
    if (wss.clients.size === 0) return;
    const json = JSON.stringify(getBoard());
    for (const c of wss.clients) {
      if (c.readyState === WebSocket.OPEN) c.send(json);
    }
  }, BROADCAST_MS);

  console.log("[live] frontend WS ready on /api/live/ws");
}
