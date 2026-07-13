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
import prisma from "../lib/prisma.js";

const UPSTREAM_URL = process.env.LIVE_TIMING_WS || "wss://nabs1.emperorservers.com/api/race-control";
const UPSTREAM_ORIGIN = process.env.LIVE_TIMING_ORIGIN || "https://nabs1.emperorservers.com";
const BROADCAST_MS = 700; // how often we push a fresh board to frontend clients
// Quiet servers (nobody on track) only send the full snapshot every ~30s and
// no per-car telemetry in between, so the stale threshold must sit comfortably
// above that gap or the badge flaps to "Reconnecting" between snapshots.
const STALE_MS = 75000; // no upstream message for this long => mark stale

// Demo board (fabricated cars, moving splines, stint histories) so the track
// map and strategy views can be seen working when no real session is on. It is
// gated OFF anywhere deployed exactly so real visitors can never be shown fake
// timing: a client only receives it when it asks (?demo=1 on the WS URL) AND
// this server allows it. Allowed only when explicitly opted in (LIVE_TIMING_DEMO
// =1) or on a plain local dev box — anything running on Railway (which injects
// RAILWAY_* vars) is treated as live, even if NODE_ENV happens to be unset.
const ON_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
const DEMO_ENABLED =
  process.env.LIVE_TIMING_DEMO === "1" ||
  (process.env.NODE_ENV !== "production" && !ON_RAILWAY);
const DEMO_RACE_LAPS = 30; // the fabricated race's distance (drives the strategy axis)

let upstream = null;
let reconnectTimer = null;
let reconnectDelay = 1000;

let status = null; // latest EventType 200 Message (full snapshot)
const liveByCar = new Map(); // CarID -> latest EventType 53 telemetry
let lastMessageAt = 0;

const nsToMs = (ns) => (typeof ns === "number" && ns > 0 ? Math.round(ns / 1e6) : null);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const round1 = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : null);

// ---- Track map assets -------------------------------------------------------
// The server manager publicly serves each track's overhead map (the very PNG its
// own live map draws on) plus a calibration ini. We proxy the PNG through our own
// origin and hand the frontend the calibration, so cars can be placed at their
// REAL world positions (from ET53's Pos) instead of the stylised-spline guess.
// Fetched once per track — on the first snapshot and whenever Track/TrackConfig
// changes — and cached in memory. Any failure just leaves map=null and the
// frontend falls back to the stylised outline; the relay never crashes over it.
const CONTENT_BASE = UPSTREAM_ORIGIN.replace(/\/+$/, "") + "/content/tracks";
const PNG_SIG = "89504e47"; // first four bytes of every PNG

let trackMap = null; // { key, calib:{width,height,scaleFactor,xOffset,zOffset,ver}|null, png:Buffer|null }
let trackMapKey = null; // the "Track|TrackConfig" we last (started to) fetch for

const mapKeyOf = (si) => `${si?.Track || ""}|${si?.TrackConfig || ""}`;

// Tiny stable token so the frontend's <img> URL changes when the track changes
// (busting the browser cache) but stays put between board ticks on one track.
function shortHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// GET a URL with a hard timeout; returns text/Buffer or null (never throws).
async function fetchUpstream(url, ms, kind) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return kind === "buf" ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

function parseMapIni(text) {
  if (!text) return null;
  const num = (re) => {
    const m = text.match(re);
    return m ? parseFloat(m[1]) : null;
  };
  const width = num(/WIDTH\s*=\s*([\d.]+)/i);
  const height = num(/HEIGHT\s*=\s*([\d.]+)/i);
  const scaleFactor = num(/SCALE_FACTOR\s*=\s*([\d.]+)/i);
  const xOffset = num(/X_OFFSET\s*=\s*(-?[\d.]+)/i);
  const zOffset = num(/Z_OFFSET\s*=\s*(-?[\d.]+)/i);
  const padding = num(/PADDING\s*=\s*(-?[\d.]+)/i);
  if (!width || !height || !scaleFactor) return null;
  return { width, height, scaleFactor, xOffset: xOffset ?? 0, zOffset: zOffset ?? 0, padding: padding ?? 0 };
}

// Fetch + cache the PNG and calibration for one track. The upstream layout isn't
// perfectly consistent (ini sometimes under /data/, png with or without the
// config folder), so we probe a few candidate paths defensively with GET.
async function loadTrackMap(track, config) {
  const key = `${track}|${config}`;
  const enc = encodeURIComponent;
  const cfgBase = config ? `${CONTENT_BASE}/${enc(track)}/${enc(config)}` : `${CONTENT_BASE}/${enc(track)}`;
  const noCfgBase = `${CONTENT_BASE}/${enc(track)}`;
  const iniUrls = [`${cfgBase}/data/map.ini`, `${cfgBase}/map.ini`, `${noCfgBase}/data/map.ini`, `${noCfgBase}/map.ini`];
  const pngUrls = [`${cfgBase}/map.png`, `${cfgBase}/data/map.png`, `${noCfgBase}/map.png`];

  let calib = null;
  for (const u of iniUrls) {
    calib = parseMapIni(await fetchUpstream(u, 6000, "text"));
    if (calib) break;
  }
  let png = null;
  for (const u of pngUrls) {
    const buf = await fetchUpstream(u, 8000, "buf");
    if (buf && buf.length > 1000 && buf.slice(0, 4).toString("hex") === PNG_SIG) {
      png = buf;
      break;
    }
  }

  // A usable map needs both the image and its calibration; otherwise mark this
  // track as "no real map" so we don't keep retrying every snapshot.
  if (png && calib && trackMapKey === key) {
    trackMap = { key, calib: { ...calib, ver: shortHash(key) }, png };
    console.log(`[live] track map ready: ${key} (${calib.width}x${calib.height})`);
  } else if (trackMapKey === key) {
    trackMap = { key, calib: null, png: null };
    console.log(`[live] no real track map for ${key} (falling back to outline)`);
  }
}

// Kick off a (re)fetch when the session's track changes. Fire-and-forget: the
// board reports map=null until it resolves, then picks it up on the next tick.
function ensureTrackMap(si) {
  if (!si?.Track) return;
  const key = mapKeyOf(si);
  if (key === trackMapKey) return; // already loaded / loading this track
  trackMapKey = key;
  trackMap = null; // drop the previous track's map while the new one loads
  loadTrackMap(si.Track, si.TrackConfig || "").catch((e) => {
    if (trackMapKey === key) trackMap = { key, calib: null, png: null };
    console.log("[live] track map fetch error:", e?.message || e);
  });
}

// The cached PNG for the current track (served at /api/live/map.png), or null.
export function getTrackMapPng() {
  return trackMap?.png || null;
}

// Calibration to ship on the board, only when it matches the live session's track.
// The snapshot's own TrackMapData is authoritative when present — it is exactly
// what the server manager's live map projects with (offset_x/offset_y/
// scale_factor/padding) — so it overrides the parsed ini values; the ini stays
// as the fallback for older managers that don't send it.
function currentMapCalib(si, tmd) {
  const base = trackMap && trackMap.key === mapKeyOf(si) ? trackMap.calib : null;
  if (!base) return null; // no cached PNG -> no real map, whatever the snapshot says
  if (tmd && Number(tmd.scale_factor) > 0) {
    return {
      ...base,
      width: Number(tmd.width) > 0 ? Number(tmd.width) : base.width,
      height: Number(tmd.height) > 0 ? Number(tmd.height) : base.height,
      scaleFactor: Number(tmd.scale_factor),
      xOffset: Number.isFinite(Number(tmd.offset_x)) ? Number(tmd.offset_x) : base.xOffset,
      zOffset: Number.isFinite(Number(tmd.offset_y)) ? Number(tmd.offset_y) : base.zOffset,
      padding: Number.isFinite(Number(tmd.padding)) ? Number(tmd.padding) : base.padding ?? 0,
    };
  }
  return base;
}

// ---- Tyre stint history -----------------------------------------------------
// The board's per-lap `tyre` is the BEST-LAP tyre, not the one currently fitted,
// so the strategy view can't be built from a single frame. We accumulate a
// per-driver stint list in memory across the session instead: a new stint opens
// on a pit stop (NumPits rises) or a compound change, and the current stint's
// lap span grows as the driver completes laps. Everything is reverse-engineered
// from the upstream snapshot, so every field is null-checked. Reset whenever the
// session changes (a different track / session index / name on EventType 200).
const stintsByGuid = new Map(); // guid -> { stints:[{tyre,fromLap,toLap}], lastPits }
let stintSessionKey = null;

function sessionKeyOf(si, ti) {
  return `${si?.Track || ti?.name || ""}|${si?.CurrentSessionIndex ?? 0}|${si?.Name || ""}`;
}

function accumulateStints(msg) {
  if (!msg) return;
  const si = msg.SessionInfo || {};
  const key = sessionKeyOf(si, msg.TrackInfo || {});
  if (key !== stintSessionKey) {
    stintsByGuid.clear();
    stintSessionKey = key;
  }
  // In Practice/Qualifying a driver teleports back to the pits to end a run and
  // start fresh; in a Race a pit stop just opens the next stint. So resets only
  // apply outside a race (Type 3 = Race).
  const isRace = si.Type === 3;
  const connected = msg.ConnectedDrivers?.Drivers || {};
  for (const [guid, d] of Object.entries(connected)) {
    const ci = d.CarInfo || {};
    if (ci.IsSpectator) continue;
    const car = (d.Cars && ci.CarModel && d.Cars[ci.CarModel]) || null;
    const lap = Math.max(1, car?.NumLaps ?? d.TotalNumLaps ?? 1);
    const tyre = ci.Tyres || car?.TyreBestLap || "";
    const pits = d.NumPits ?? car?.NumPits ?? 0;
    const inPits = !!(d.IsInPits ?? false);
    let st = stintsByGuid.get(guid);
    if (!st) {
      // First sight: seed the pit-edge tracker from the current state so a driver
      // already sitting in the pits at session start isn't treated as a "return"
      // (no spurious reset, and no stint opened until they actually head out).
      st = { stints: [], lastPits: pits, lastInPits: inPits };
      stintsByGuid.set(guid, st);
    }
    // Practice/Quali return to the pits: wipe this driver's history once, on the
    // transition onto pit road, so their next run's stints start from zero. The
    // lap counter doesn't reset upstream, but stints are laps-delta based, so the
    // next stint simply re-anchors from wherever the lap count is now.
    if (!isRace && inPits && !st.lastInPits) {
      st.stints = [];
      st.lastPits = pits; // re-anchor: the return itself isn't a fresh pit stop
    }
    st.lastInPits = inPits;

    const cur = st.stints[st.stints.length - 1];
    const pitted = pits > st.lastPits;
    const tyreChanged = cur && tyre && cur.tyre && cur.tyre !== "?" && norm(tyre) !== norm(cur.tyre);
    if (inPits && !cur) {
      // Sitting in the pits with no active stint: keep the row empty until the
      // driver rejoins the track (covers both a fresh session and a post-reset).
    } else if (!cur) {
      st.stints.push({ tyre: tyre || "?", fromLap: lap, toLap: lap });
    } else if (pitted || tyreChanged) {
      cur.toLap = lap;
      st.stints.push({ tyre: tyre || cur.tyre, fromLap: lap, toLap: lap });
    } else {
      if (lap > cur.toLap) cur.toLap = lap;
      if ((!cur.tyre || cur.tyre === "?") && tyre) cur.tyre = tyre;
    }
    st.lastPits = pits;
  }
}

// The stint list a board entry ships: [{ tyre, laps }] plus the live compound.
function stintsFor(guid) {
  const st = stintsByGuid.get(guid);
  if (!st) return [];
  return st.stints.map((s) => ({ tyre: s.tyre, laps: Math.max(1, (s.toLap - s.fromLap) + 1) }));
}

function sessionTypeName(t) {
  return { 0: "Booking", 1: "Practice", 2: "Qualifying", 3: "Race" }[t] || "Session";
}

// Test hook: the stint accumulator carries module-level state, so tests drive it
// through simulated snapshots and reset between cases (see liveTiming.test.js).
export const __testing = {
  accumulateStints,
  stintsFor,
  reset() {
    stintsByGuid.clear();
    stintSessionKey = null;
  },
};

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
        accumulateStints(status); // grow the per-driver tyre-stint history
        ensureTrackMap(status?.SessionInfo || {}); // (re)load the real map on track change
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
    // The tyre fitted RIGHT NOW (for the strategy view), as opposed to `tyre`
    // above which is the best-lap compound. Prefer a live telemetry field if the
    // upstream carries one, else the CarInfo's current tyre, else the best-lap
    // one as a last resort. All reverse-engineered, so fall through defensively.
    currentTyre: (onTrack ? live.Tyre ?? live.Tyres : null) ?? ci.Tyres ?? car?.TyreBestLap ?? null,
    stints: stintsFor(guid),
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
    // Real world position (X/Z ground plane) for the real-map dots. Only on-track
    // cars carry live telemetry, so it's null otherwise; rounded to keep the board
    // lean. The frontend projects it onto map.png with the ini's calibration.
    pos: onTrack && live.Pos ? { x: round1(live.Pos.X), z: round1(live.Pos.Z) } : null,
    // Race-session running order (from the high-frequency telemetry; null in
    // practice/quali or for cars that left). The championship projection sorts
    // by this, NOT by the board's hot-lap ranking below.
    racePosition: live.RacePosition ?? d.RacePosition ?? null,
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
      // Lap-based sessions (races) carry their distance; the strategy view sizes
      // its shared axis off this so bars read as "of the race", not "of the leader".
      raceLaps: si.Laps > 0 ? si.Laps : null,
      // Real overhead-map calibration when available (see loadTrackMap); null
      // tells the frontend to fall back to the stylised circuit outline.
      map: currentMapCalib(si, status.TrackMapData),
    },
    entries,
    updatedAt: Date.now(),
  };
}

// ---- Demo board -------------------------------------------------------------
// A fabricated session so the map + strategy views can be demonstrated with no
// real cars on track. Dev/opt-in only (see DEMO_ENABLED). Built once from the
// active season's real drivers (so the frontend's name→team-colour matcher
// lights the dots up); splines and lap counts are derived from elapsed time on
// every read, so motion stays smooth and deterministic without mutation.
let demoState = null;
let demoBuilding = false;

// Deterministic, varied stint patterns so the strategy bars look like a real
// mid-race spread of one-, two- and three-stoppers. Mixed short codes and long
// names on purpose (the compound mapping understands both), one supersoft opener,
// one still-empty slot (no laps yet) and a couple of clearly-current stints that
// keep growing in getDemoBoard. `grow` marks a car still adding laps.
function seedDemoStints(i) {
  const patterns = [
    // Uses only the league's real compounds (HS/SS/S/M/H), so the demo shows the
    // actual colour scheme (no ultrasoft — the league doesn't run it).
    { stints: [["S", 8], ["M", 14]], grow: true }, // current medium, still running
    { stints: [["SS", 6], ["S", 11]], grow: true }, // supersoft opener, current soft growing
    { stints: [["M", 22]] },
    { stints: [] }, // no laps yet — shows the empty placeholder slot
    { stints: [["Soft", 5], ["Soft", 9], ["Medium", 7]] },
    { stints: [["Hard", 20]] },
    { stints: [["HS", 7], ["S", 10]] },
    { stints: [["Medium", 12], ["Hard", 10]] },
    { stints: [["S", 9], ["M", 8], ["S", 6]] },
    { stints: [["Medium", 16]], grow: true },
    { stints: [["HS", 4], ["Hard", 18]] },
    { stints: [["SS", 6], ["Soft", 12]] },
  ];
  const p = patterns[i % patterns.length];
  return { stints: p.stints.map(([tyre, laps]) => ({ tyre, laps })), grow: !!p.grow };
}

async function ensureDemoState() {
  if (demoState || demoBuilding) return;
  demoBuilding = true;
  let roster = [];
  try {
    const drivers = await prisma.driver.findMany({
      where: { season: { isActive: true }, tier: { in: [1, 2] } },
      select: { name: true },
      orderBy: { tier: "asc" },
      take: 12,
    });
    roster = drivers.map((d) => d.name).filter(Boolean);
  } catch {
    /* DB not ready — fall back to generic names below */
  }
  if (roster.length < 6) {
    roster = ["13bot", "Takoda", "Siggsta", "Steve", "Tball", "JoMilan", "Rikko", "mtimmis", "VxxVitra", "SirTiblet", "ThatDudeGuest", "Rookie"];
  }
  demoState = {
    startedAt: Date.now(),
    track: "monza",
    trackName: "Autodromo di Monza",
    cars: roster.slice(0, 12).map((name, i) => {
      const { stints, grow } = seedDemoStints(i);
      const last = stints[stints.length - 1] || null;
      return {
        guid: `demo-${i}`,
        name,
        raceNumber: i + 2,
        base: (i / 12 + i * 0.017) % 1, // starting spline, spread around the lap
        speed: 0.010 + (i % 5) * 0.0006, // spline per second (a lap ≈ 90-100s)
        pitsAround: i === 5 ? 0.62 : i === 10 ? 0.31 : null, // a couple of pit cars
        stints,
        grow, // a still-current stint that keeps adding laps
        currentTyre: last?.tyre ?? null,
        lapBase: stints.reduce((a, s) => a + s.laps, 0),
      };
    }),
  };
  demoBuilding = false;
}

function getDemoBoard() {
  if (!demoState) {
    return { ok: false, connected: false, demo: true, stale: false, session: null, entries: [], updatedAt: Date.now() };
  }
  const secs = (Date.now() - demoState.startedAt) / 1000;
  const entries = demoState.cars.map((c, idx) => {
    const prog = c.base + c.speed * secs; // total laps of progress (fractional)
    const spline = ((prog % 1) + 1) % 1;
    const lapsDone = Math.floor(prog);
    // A pit car dips off track for a slice of each lap near its pit window.
    const inPits = c.pitsAround != null && Math.abs(spline - c.pitsAround) < 0.04;
    // Grow the current stint over the demo's lifetime so the "still out there"
    // live indicator has something to tick up (fresh copy so state stays pure) —
    // capped at the demo race distance so a long-running demo can't outgrow
    // the strategy view's race-length axis.
    const stints = c.stints.map((s) => ({ ...s }));
    if (c.grow && stints.length) {
      const room = Math.max(0, DEMO_RACE_LAPS - stints.reduce((a, s) => a + s.laps, 0));
      stints[stints.length - 1].laps += Math.min(room, Math.floor(secs / 12));
    }
    return {
      guid: c.guid,
      name: c.name,
      initials: c.name.slice(0, 3).toUpperCase(),
      raceNumber: c.raceNumber,
      carName: "",
      tyre: c.currentTyre,
      currentTyre: c.currentTyre,
      stints,
      pos: null, // demo has no real world positions — uses the stylised map
      // Mirrors the real board, where onTrack means CONNECTED (a car sitting in
      // the pit lane is still on the server); the pit state rides on inPits.
      onTrack: true,
      inPits,
      bestLapMs: 80000 + idx * 180,
      lastLapMs: 80500 + idx * 200,
      lastLapAt: Date.now() - 3000,
      lapCount: c.lapBase + lapsDone,
      topSpeed: 330 - idx,
      sectors: [null, null, null],
      potentialMs: null,
      numPits: Math.max(0, c.stints.length - 1),
      ping: 30 + idx,
      drs: false,
      deltaSelfMs: null,
      spline,
      racePosition: idx + 1,
      position: idx + 1,
      gapToBestMs: idx === 0 ? 0 : idx * 300,
    };
  });
  return {
    ok: true,
    connected: true,
    demo: true,
    stale: false,
    session: {
      type: "Race",
      name: "Demo Race",
      serverName: "NABS demo session (not a real race)",
      track: demoState.track,
      trackName: demoState.trackName,
      country: "Italy",
      ambientTemp: 26,
      roadTemp: 34,
      weather: "3_clear",
      bestLapMs: entries[0]?.bestLapMs ?? null,
      driverCount: entries.length,
      onTrackCount: entries.filter((e) => e.onTrack).length,
      sessionIndex: 0,
      sessionCount: 1,
      remainingMs: 32 * 60000,
      raceLaps: DEMO_RACE_LAPS, // lap-based demo race: the strategy axis runs the distance
      map: null, // the demo carries no world positions — stylised outline only
    },
    entries,
    updatedAt: Date.now(),
  };
}

function wantsDemo(req) {
  return DEMO_ENABLED && /[?&]demo=1/.test(req?.url || "");
}

// Attach the frontend-facing WebSocket and start the upstream connection.
export function initLiveTiming(server) {
  connectUpstream();

  const wss = new WebSocketServer({ server, path: "/api/live/ws" });

  wss.on("connection", async (ws, req) => {
    ws.isDemo = wantsDemo(req);
    if (ws.isDemo) await ensureDemoState();
    // send a snapshot immediately so the board paints without waiting a tick
    try {
      ws.send(JSON.stringify(ws.isDemo ? getDemoBoard() : getBoard()));
    } catch {
      /* noop */
    }
  });

  setInterval(() => {
    if (wss.clients.size === 0) return;
    // Build each variant at most once per tick (real vs. demo), then fan out.
    let realJson = null;
    let demoJson = null;
    for (const c of wss.clients) {
      if (c.readyState !== WebSocket.OPEN) continue;
      if (c.isDemo) {
        demoJson ??= JSON.stringify(getDemoBoard());
        c.send(demoJson);
      } else {
        realJson ??= JSON.stringify(getBoard());
        c.send(realJson);
      }
    }
  }, BROADCAST_MS);

  console.log("[live] frontend WS ready on /api/live/ws" + (DEMO_ENABLED ? " (demo available via ?demo=1)" : ""));
}
