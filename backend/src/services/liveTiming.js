// Live timing relay for the Assetto Corsa Server Manager.
//
// The server manager (e.g. https://nabs1.emperorservers.com) streams its live
// data over a WebSocket at /api/race-control, but it rejects cross-origin
// browsers (403 unless the Origin header matches its own host). So we cannot
// connect from the browser directly. Instead this backend holds one upstream
// connection PER RACE SERVER (with the right Origin), keeps each server's
// latest state in memory, and re-broadcasts a clean, throttled "timing board"
// to our own frontend clients over /api/live/ws.
//
// Multi-server: the league runs more than one server (see lib/liveServers.js).
// Every configured server gets its own relay (all the per-session state below
// lives in a per-relay closure); which server a CLIENT follows is decided by
// the series it passes on the WS URL (?series=<slug>), via the admin-managed
// series → server assignment. No series/param = the first server, exactly the
// old single-server behaviour.
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
import { createHash, randomBytes } from "node:crypto";
import prisma from "../lib/prisma.js";
import { LIVE_SERVERS, DEFAULT_SERVER_KEY, serverKeyForSeries } from "../lib/liveServers.js";
import { ON_RAILWAY } from "../lib/deployment.js";
import * as pitRecorder from "./pitRecorder.js";

// ---------------------------------------------------------------------------
// Public driver id for the live board.
//
// Assetto Corsa identifies a driver by their SteamID64, and that is what the
// upstream server manager sends us as the GUID. lib/privacy.js is explicit that
// a Steam id must never reach a public response — the league is pseudonymous,
// and a Steam profile usually carries the real name and the friend list. The
// roster endpoint strips it; the live board, which anyone can open without
// signing in, was handing it out for every driver on track next to their name.
//
// The frontend only ever uses this value as an identity key: React keys, the
// flip-animation id, and the track map's per-car state. It never sends it back
// and never matches a driver with it (that is done by name). So a stable stand-in
// is all it needs.
//
// The salt is required, not decoration: a SteamID64 is "7656119" plus ten
// digits, so an unsalted hash is a ten-digit brute force and reverses in
// seconds. Random per process start means the ids change on restart, which
// costs nothing — the board simply re-keys its rows on the next frame.
const PUBLIC_ID_SALT = randomBytes(16).toString("hex");
const publicIdCache = new Map(); // real guid -> public id (hashing runs per driver, not per frame)
// Ceiling on that cache. It is keyed by Steam id and nothing ever removed an
// entry, so every driver who has touched any of the league's servers since the
// process started stayed in it for the process's lifetime. Five thousand is far
// beyond anything the league will see in one run of the server (a grid is under
// forty), so in practice nothing is ever evicted — and an eviction costs
// nothing anyway: the id is a pure function of the salt and the guid, so a
// re-hash hands back the exact same value. Oldest out first (a Map iterates in
// insertion order).
const PUBLIC_ID_CACHE_MAX = 5000;

function publicDriverId(guid) {
  if (!guid) return guid;
  let id = publicIdCache.get(guid);
  if (!id) {
    id = createHash("sha256").update(PUBLIC_ID_SALT).update(String(guid)).digest("hex").slice(0, 16);
    if (publicIdCache.size >= PUBLIC_ID_CACHE_MAX) publicIdCache.delete(publicIdCache.keys().next().value);
    publicIdCache.set(guid, id);
  }
  return id;
}

const BROADCAST_MS = 700; // how often we push a fresh board to frontend clients
// …but only when the board actually says something new (see the broadcast
// loop). A board that has not moved is still WORTH sending now and then, both
// as a sign of life and because nothing else re-syncs a viewer whose socket
// swallowed a frame — so this is the longest a viewer may go without one.
//
// The number has to sit well under what the live page treats as a gap. The page
// has no arrival timer of its own (useLiveTiming only reacts to messages), and
// the strictest related value on that side is LIVE_GRACE_MS = 40s, the window
// it holds a board for after the feed reports itself down. Fifteen seconds is
// comfortably under half of it, and it also keeps getBoard() being called often
// enough to expire a finished race's frozen result on time.
const KEEPALIVE_MS = 15000;
// How long a finished race's final classification stays on the board after the
// server has already cycled on to the next session. Born after the first race
// of season 8 (2026-08-07): the sim flips back to practice moments after the
// flag, and the result vanished mid-celebration. A fresh RACE session starting
// releases the hold early — a new race is never hidden behind an old one.
const RESULT_HOLD_MS = 15 * 60 * 1000;
// Quiet servers (nobody on track) only send the full snapshot every ~30s and
// no per-car telemetry in between, so the stale threshold must sit comfortably
// above that gap or the badge flaps to "Reconnecting" between snapshots.
const STALE_MS = 75000; // no upstream message for this long => mark stale
// The longest a session could plausibly have been running. A reading past this
// is not a long race, it is an anchor left over from something else.
const MAX_SESSION_S = 6 * 60 * 60;
// How often to ping the race server, and (times two) how long an unanswered
// socket may hang around before it is dropped as dead. Well above the stale
// threshold on purpose: silence is normal and only means "nothing is happening",
// while an unanswered ping means the server is not there at all.
const HEARTBEAT_MS = 30000;
// The same idea for the sockets on the OTHER side — the viewers. The upstream
// connection has had a heartbeat since the day a dead race server could freeze
// the board; the viewer sockets never got one, and they need it for the mirror
// image of the same reason. A phone that walks out of wifi mid-race sends no
// close frame, so its socket sits in wss.clients at readyState OPEN until the
// operating system gives up on the TCP entry, and every broadcast keeps writing
// a board into it. Over a race night that is the shape of a slow memory climb:
// growth in buffered payloads rather than in the JS heap, which is exactly why
// a heap snapshot of the 2026-08-07 climb showed nothing worth looking at.
//
// Browsers answer a ping frame themselves, at the protocol level, without the
// page knowing — so unlike the race server upstream, silence here really does
// mean gone. Two missed rounds before dropping, and the live page reconnects on
// its own with backoff, so the cost of being wrong is a blink.
const CLIENT_HEARTBEAT_MS = 30000;
// A board is a few kB and a healthy socket drains it long before the next tick,
// so anything holding this much has stopped draining altogether: at the ~60-85
// kB/s a full grid generates, a megabyte is a good quarter minute of writing
// into a socket nobody is reading. Far enough above a momentary spike on a slow
// phone to never catch a real viewer.
const MAX_BUFFERED_BYTES = 1024 * 1024;

// Demo board (fabricated cars, moving splines, stint histories) so the track
// map and strategy views can be seen working when no real session is on. It is
// gated OFF anywhere deployed exactly so real visitors can never be shown fake
// timing: a client only receives it when it asks (?demo=1 on the WS URL) AND
// this server allows it. Allowed only when explicitly opted in (LIVE_TIMING_DEMO
// =1) or on a plain local dev box — anything running on Railway (which injects
// RAILWAY_* vars) is treated as live, even if NODE_ENV happens to be unset.
// ON_RAILWAY comes from lib/deployment.js now (it was a third copy of the same
// probe). Deliberately NOT the broader IS_DEPLOYED: the demo board should stay
// reachable on a tunnelled preview build, which carries an https CORS origin.
const DEMO_ENABLED =
  process.env.LIVE_TIMING_DEMO === "1" ||
  (process.env.NODE_ENV !== "production" && !ON_RAILWAY);
const DEMO_RACE_LAPS = 30; // the fabricated race's distance (drives the strategy axis)

const nsToMs = (ns) => (typeof ns === "number" && ns > 0 ? Math.round(ns / 1e6) : null);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const round1 = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : null);

const PNG_SIG = "89504e47"; // first four bytes of every PNG

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

function sessionKeyOf(si, ti) {
  return `${si?.Track || ti?.name || ""}|${si?.CurrentSessionIndex ?? 0}|${si?.Name || ""}`;
}

// Canonical compound key, mirroring the frontend's compoundKey: the upstream
// flips between short codes and long names for the SAME rubber ("M" one
// snapshot, "Medium" the next, depending on which field is populated), which
// used to open a ghost stint on every flip — that's the doubled discs on the
// strategy graphic. Unknown compounds fall back to the stripped string.
const TYRE_SHORT = {
  hs: "hypersoft", us: "ultrasoft", ss: "supersoft", sh: "superhard",
  s: "soft", m: "medium", h: "hard", i: "intermediate", in: "intermediate",
  int: "intermediate", inter: "intermediate", w: "wet", wet: "wet",
};
export function tyreKey(name) {
  const n = String(name || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!n) return "";
  if (TYRE_SHORT[n]) return TYRE_SHORT[n];
  if (n.includes("inter")) return "intermediate";
  if (n.includes("wet")) return "wet";
  if (n.includes("hyper")) return "hypersoft";
  if (n.includes("ultra")) return "ultrasoft";
  if (n.includes("super") && n.includes("soft")) return "supersoft";
  if (n.includes("super") && n.includes("hard")) return "superhard";
  if (n.includes("soft")) return "soft";
  if (n.includes("medium")) return "medium";
  if (n.includes("hard")) return "hard";
  return n;
}

function sessionTypeName(t) {
  return { 0: "Booking", 1: "Practice", 2: "Qualifying", 3: "Race" }[t] || "Session";
}

// ---------------------------------------------------------------------------
// The safety car.
//
// The league runs it as an ordinary entry on the server, which is why it has
// always shown up on this board as just another driver — and, while it is out,
// as the car at the front of the field. Anything that names a race leader has
// to know the difference.
//
// Two questions are asked, because neither is enough on its own.
//
// The SKIN is what the result importer has always gone by (see
// services/telemetryExtractor.js), and the league has renamed it every season
// or so: "!NABS_Safety_Car", "NABS_Racing_Safety_Car", "NABS Safetycar", and in
// season 8 simply "sc". Hence a pattern rather than a list — and hence not the
// skin alone, because season 7 rounds 1-7 ran the pace car under ordinary Kunos
// skin names ("0_AMG", "kunos_zp_121") that say nothing at all.
//
// The MODEL closes that gap. These four cars were checked against every one of
// the 47 events in results-archive: they account for all 112 pace-car and
// broadcast-car entries and not one of the 1673 racing entries, across grids
// that ran formula_2010, rss_formula_2013, rss_formula_hybrid_v12-r and the
// twelve cim_2007_* cars. No overlap in either direction.
//
// NOT by "which model is the odd one out", which is the tempting general rule
// and is wrong here: season 7 is a multi-make grid of twelve 2007 cars with two
// to four drivers in each, and a minority rule flags sixteen real drivers as
// pace cars. Measured, not assumed.
//
// NOT by driver name either, though the importer keeps such a list. It is
// explicitly only a suspicion there, for a good reason: the people who drive
// the pace car also race, and treating a name as proof once threw away a real
// driver's telemetry.
//
// MAINTENANCE: a new pace car needs its model added here (or a skin the pattern
// catches), or the live page will show it leading the race. See README.
const SAFETY_CAR_MODELS = new Set([
  "lotus_exige_240", // seasons 5-6
  "mercedes_sls", // season 5
  "mercedes_sls_gt3", // season 7 — also the broadcast car, equally not racing
  "drf_audi_rs5_dtm_2019", // season 8
]);
function looksLikeSafetyCar(carSkin, carModel) {
  const skin = String(carSkin || "").trim();
  return (
    /safety/i.test(skin) ||
    /^sc$/i.test(skin) ||
    SAFETY_CAR_MODELS.has(String(carModel || "").trim().toLowerCase())
  );
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

// ---------------------------------------------------------------------------
// One relay per race server: upstream socket, snapshot state, track map cache
// and tyre-stint history all live in this closure — nothing is shared between
// servers, so two series following two servers never bleed into each other.
// ---------------------------------------------------------------------------
function createRelay(server) {
  const tag = `[live:${server.key}]`;
  const CONTENT_BASE = server.origin.replace(/\/+$/, "") + "/content/tracks";

  let upstream = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  let heartbeatTimer = null;
  // Last proof the race server is still there: a message OR a pong. Distinct
  // from lastMessageAt below, which is about whether the DATA is fresh; this one
  // is about whether the connection is real (see the heartbeat).
  let lastAliveAt = 0;

  let status = null; // latest EventType 200 Message (full snapshot)
  const liveByCar = new Map(); // CarID -> latest EventType 53 telemetry
  // CarID -> guid, rebuilt from every snapshot: ET53 only carries the CarID,
  // but the follow fast-lane (relayFollowedTelemetry) speaks public driver ids.
  const carIdToGuid = new Map();
  // guid -> last known race position, so a driver who leaves the server right
  // after the flag keeps their slot on the board instead of vanishing to the
  // bottom. Cleared with the stint history on a session change.
  const lastRacePosByGuid = new Map();
  let lastMessageAt = 0;
  // When the last FULL snapshot landed. `lastMessageAt` counts telemetry too,
  // and an in-game report has to know whether the session state it is about to
  // stamp itself with is a live reading or the last thing a dead socket left
  // behind. See raceSecond().
  let lastSnapshotAt = 0;

  // ---- Track map assets -----------------------------------------------------
  // The server manager publicly serves each track's overhead map (the very PNG
  // its own live map draws on) plus a calibration ini. We proxy the PNG through
  // our own origin and hand the frontend the calibration, so cars can be placed
  // at their REAL world positions (from ET53's Pos). Fetched once per track and
  // cached in memory; failures just leave map=null (stylised-outline fallback).
  let trackMap = null; // { key, calib, png } | null
  let trackMapKey = null; // the "Track|TrackConfig" we last (started to) fetch for

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
      trackMap = { key, calib: { ...calib, ver: shortHash(`${server.key}|${key}`) }, png };
      console.log(`${tag} track map ready: ${key} (${calib.width}x${calib.height})`);
    } else if (trackMapKey === key) {
      trackMap = { key, calib: null, png: null };
      console.log(`${tag} no real track map for ${key} (falling back to outline)`);
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
      console.log(`${tag} track map fetch error:`, e?.message || e);
    });
  }

  // Calibration to ship on the board, only when it matches the live session's
  // track. The snapshot's own TrackMapData is authoritative when present — it
  // is exactly what the server manager's live map projects with — so it
  // overrides the parsed ini values; the ini stays as the fallback for older
  // managers that don't send it.
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

  // ---- Tyre stint history ---------------------------------------------------
  // The board's per-lap `tyre` is the BEST-LAP tyre, not the one currently
  // fitted, so the strategy view can't be built from a single frame. We
  // accumulate a per-driver stint list in memory across the session instead: a
  // new stint opens on a pit stop (NumPits rises) or a compound change, and the
  // current stint's lap span grows as the driver completes laps. Everything is
  // reverse-engineered from the upstream snapshot, so every field is
  // null-checked. Reset whenever the session changes.
  const stintsByGuid = new Map(); // guid -> { stints:[{tyre,fromLap,toLap}], lastPits }
  let stintSessionKey = null;
  // Ceiling on one driver's history, oldest dropped first. A genuine entry costs
  // a pit stop or a real compound change, so no session anyone watches can come
  // near this — the longest race the league has ever run is a fraction of it, and
  // outside a race the list is wiped on every return to the pits. It is the
  // dishonest case this is for: a compound name the tyreKey mapping doesn't
  // recognise can read differently from one snapshot to the next, and that opens
  // a stint every time, forever, on a server that sits in an open practice
  // session all week. Deliberately generous rather than the tightest fit: the
  // strategy view sizes its axis off the SUM of a driver's stint laps, so a
  // truncated history would be visibly wrong, and that must never happen to a
  // real one.
  const MAX_STINTS = 128;

  // Every driver seen in the CURRENT race, raw upstream record and all. The
  // upstream forgets a car some time after it disconnects; on race night that
  // meant finishers dropped off the live board one by one as they left the
  // server, and the classification crumbled while people were still looking at
  // it. This map keeps each leaver's last known record so the board can keep
  // showing them (with their held racePosition) until the session changes.
  // Updated on every ET200 snapshot — deliberately NOT in getBoard, which only
  // runs while somebody is watching. Cleared with the stints above.
  const raceRosterByGuid = new Map();

  // Each driver's recent line crossings: which lap, and the upstream's own
  // timestamp for it.
  //
  // This is what a race gap is measured with. Two cars' crossings of the SAME
  // lap differ by exactly the gap between them, both stamped by the same clock
  // on the race server — nothing here has to be extrapolated. The obvious
  // alternative, comparing distance covered, needs the lap counter and the
  // spline to agree, and they arrive at very different rates: the spline wraps
  // to zero on the line while the lap counter waits for the next snapshot, so
  // every car would read almost a full lap behind for that window.
  //
  // Six crossings each is plenty: further back than that and the board says
  // how many laps down, not how many seconds. Cleared with the stints.
  const crossingsByGuid = new Map(); // guid -> [{ lap, at }], oldest first
  const CROSSINGS_KEPT = 6;

  // When the session on air started, in our own clock. Worked out once per
  // session from the snapshot's ElapsedMilliseconds and then left alone, so it
  // does not jitter by a snapshot's worth every tick.
  //
  // It exists for the first lap. Every lap after it can be timed from the
  // driver's last crossing, but on the opening lap nobody has crossed anything
  // — which is why the whole "current lap" column sat empty through the most
  // watched two minutes of the race. In a RACE that lap started at the green
  // light, and this is the green light.
  let sessionStartedAt = null;
  let startedAtKey = null;

  // A finished race's final board, held past the session change (see the ET200
  // handler and RESULT_HOLD_MS).
  let finishedRace = null; // { board, until } | null

  // Note down that this driver has completed another lap, and when. Called for
  // every driver on every snapshot; a lap already on file is ignored, so the
  // list only ever grows by one at a time.
  function recordCrossing(guid, car) {
    const lap = car?.NumLaps ?? 0;
    const at = car?.LastLapCompletedTime ? Date.parse(car.LastLapCompletedTime) || null : null;
    if (!(lap > 0) || at == null) return;
    let list = crossingsByGuid.get(guid);
    if (!list) crossingsByGuid.set(guid, (list = []));
    const last = list[list.length - 1];
    // A counter going BACKWARDS is a different running of the same session —
    // an admin restarting the race in place keeps the session key identical, so
    // nothing else clears this — or a driver who rejoined. Either way the old
    // crossings belong to a race that no longer exists, and pairing them with
    // the new ones hands out the previous race's gaps as if they were today's.
    // (pitRecorder.js documents the same two causes for the same signal.)
    if (last && lap < last.lap) list.length = 0;
    else if (last && last.lap === lap) return;
    list.push({ lap, at });
    if (list.length > CROSSINGS_KEPT) list.shift();
  }

  function accumulateStints(msg) {
    if (!msg) return;
    const si = msg.SessionInfo || {};
    const key = sessionKeyOf(si, msg.TrackInfo || {});
    if (key !== stintSessionKey) {
      stintsByGuid.clear();
      lastRacePosByGuid.clear();
      raceRosterByGuid.clear();
      crossingsByGuid.clear();
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
      recordCrossing(guid, car);
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
      const tyreChanged = cur && tyre && cur.tyre && cur.tyre !== "?" && tyreKey(tyre) !== tyreKey(cur.tyre);
      if (inPits && !cur) {
        // Sitting in the pits with no active stint: keep the row empty until the
        // driver rejoins the track (covers both a fresh session and a post-reset).
      } else if (!cur) {
        st.stints.push({ tyre: tyre || "?", fromLap: lap, toLap: lap });
        if (st.stints.length > MAX_STINTS) st.stints.shift();
      } else if (
        tyreChanged &&
        !pitted &&
        // The compound READING settling, not the compound changing. Two shapes,
        // both born from the ~30s snapshot cadence and both seen as ghost discs
        // on race night (2026-08-21):
        //   - a stint so young the driver hasn't completed a lap on it — the
        //     upstream named the OLD compound when the stint opened (a fresh
        //     stop's new tyre lands a snapshot late);
        //   - the FIRST stint of a session while the field is still on its
        //     opening laps — the first snapshot carries the compound left over
        //     from qualifying, and splitting on the correction painted a
        //     one-lap stint of rubber that was never raced.
        // A car cannot change compound without pitting, so with the pit counter
        // still flat this is a correction: relabel the stint, don't split it.
        ((lap === cur.fromLap && cur.toLap === cur.fromLap) ||
          (st.stints.length === 1 && !cur.pitted && cur.fromLap === 1 && lap <= 2))
      ) {
        cur.tyre = tyre;
        if (lap > cur.toLap) cur.toLap = lap;
      } else if (pitted && !tyreChanged && cur.tc && lap - cur.fromLap <= 1) {
        // The server's pit counter catching up with a compound change that
        // already opened this stint (the counter lags the snapshot; the
        // recorder documents the same). One stop, not two: promote the guess
        // to a counted fact instead of opening a doubled same-compound stint.
        cur.pitted = true;
        cur.tc = false;
        if (lap > cur.toLap) cur.toLap = lap;
      } else if (pitted || tyreChanged) {
        cur.toLap = lap;
        // Remember WHY the stint broke. The server's own pit counter rising is
        // a fact; a compound that merely looks different is a guess, and the
        // repair pass in stintsFor is allowed to undo the guess but not the
        // fact (see the note there). `tc` marks the guess so a counter rising
        // one snapshot later can claim this stint instead of opening another.
        st.stints.push({ tyre: tyre || cur.tyre, fromLap: lap, toLap: lap, pitted, tc: tyreChanged && !pitted });
        if (st.stints.length > MAX_STINTS) st.stints.shift();
      } else {
        if (lap > cur.toLap) cur.toLap = lap;
        if ((!cur.tyre || cur.tyre === "?") && tyre) cur.tyre = tyre;
      }
      st.lastPits = pits;
    }

    // Race roster upkeep: remember everyone's latest record, connected drivers
    // winning over their stored (disconnected) counterpart.
    if (isRace) {
      for (const [guid, d] of Object.entries(msg.DisconnectedDrivers?.Drivers || {})) {
        if (!d.CarInfo?.IsSpectator && !connected[guid]) raceRosterByGuid.set(guid, d);
      }
      for (const [guid, d] of Object.entries(connected)) {
        if (!d.CarInfo?.IsSpectator) raceRosterByGuid.set(guid, d);
      }
    }
  }

  // The stint list a board entry ships: [{ tyre, laps }] plus the live compound.
  function stintsFor(guid) {
    const st = stintsByGuid.get(guid);
    if (!st) return [];
    const out = [];
    for (const s of st.stints) {
      const prev = out[out.length - 1];
      // Repair pass for histories accumulated before the tyreKey fix (and any
      // remaining flip artefact): a same-compound stint that opens on the very
      // lap the previous one ended is a ghost split, not a real stop — merge.
      //
      // Unless the pit counter is what opened it. A driver can and does stop
      // for the same compound again — 13bot went hard-to-hard on lap ten at
      // Hockenheim — and this pass used to swallow exactly those, so the live
      // chart showed a one-stop race the result import then contradicted with
      // three. A stop the SERVER counted is not an artefact of anything.
      if (prev && !s.pitted && tyreKey(prev._tyre) === tyreKey(s.tyre) && s.fromLap <= prev._toLap) {
        prev._toLap = Math.max(prev._toLap, s.toLap);
        continue;
      }
      out.push({ tyre: s.tyre, _tyre: s.tyre, _fromLap: s.fromLap, _toLap: s.toLap });
    }
    return out.map((s) => ({ tyre: s.tyre, laps: Math.max(1, (s._toLap - s._fromLap) + 1) }));
  }

  function upstreamOpen() {
    return upstream && upstream.readyState === WebSocket.OPEN;
  }

  // One full ET200 snapshot, from the wire (or a test). Order matters here:
  // the freeze check has to run BEFORE the new snapshot replaces `status` and
  // before accumulateStints clears the per-session maps, or the result would
  // be built from the wiped state it is supposed to preserve.
  function ingestSnapshot(next) {
    // Session change away from a RACE: freeze the final classification so the
    // result stays on the board for RESULT_HOLD_MS (see getBoard).
    const oldSi = status?.SessionInfo;
    if (
      oldSi?.Type === 3 &&
      sessionKeyOf(next?.SessionInfo || {}, next?.TrackInfo || {}) !==
        sessionKeyOf(oldSi || {}, status?.TrackInfo || {})
    ) {
      const board = buildBoard();
      if (board.ok && board.session) {
        // Frozen means over: the clock must not keep counting down.
        board.session = { ...board.session, remainingMs: 0, finished: true };
        finishedRace = { board, until: Date.now() + RESULT_HOLD_MS };
      }
    }
    status = next;
    lastSnapshotAt = Date.now();
    // Keep the per-car telemetry across snapshots — clearing it here blanked
    // every map dot for a beat (pos gone until each car's next ET53). Only
    // drop cars that actually left the server.
    {
      const alive = new Set();
      carIdToGuid.clear();
      for (const [guid, d] of Object.entries(status?.ConnectedDrivers?.Drivers || {})) {
        if (typeof d?.CarInfo?.CarID === "number") {
          alive.add(d.CarInfo.CarID);
          carIdToGuid.set(d.CarInfo.CarID, guid);
        }
      }
      for (const id of [...liveByCar.keys()]) {
        if (!alive.has(id)) liveByCar.delete(id);
      }
    }
    {
      const si = status?.SessionInfo || {};
      const key = sessionKeyOf(si, status?.TrackInfo || {});
      const elapsed = Number(si.ElapsedMilliseconds) || 0;
      if (key !== startedAtKey) {
        startedAtKey = key;
        sessionStartedAt = null;
      }
      // Only with a real elapsed reading: without one the anchor would be "now"
      // and the opening lap would appear to start whenever we happened to look.
      // Kept trying until one arrives, because the FIRST snapshot of a session
      // reports zero elapsed — anchoring only on the session change would have
      // meant never anchoring at all.
      if (sessionStartedAt == null && elapsed > 0) sessionStartedAt = Date.now() - elapsed;
    }
    accumulateStints(status); // grow the per-driver tyre-stint history
    // Write pit-lane facts to disk while they exist — the stored result JSON
    // carries none, so what this misses tonight is unknowable tomorrow.
    pitRecorder.onSnapshot(server.key, status, sessionKeyOf(status?.SessionInfo || {}, status?.TrackInfo || {}));
    ensureTrackMap(status?.SessionInfo || {}); // (re)load the real map on track change
  }

  function connectUpstream() {
    // perMessageDeflate OFF, explicitly. The ws client OFFERS compression by
    // default; if the server manager accepts, every telemetry message runs
    // through native zlib contexts — memory that lives outside the JS heap,
    // is known (ws docs say so themselves) to fragment under high message
    // rates, and never shows up in a heap snapshot. A race evening is exactly
    // that: hours of high-frequency ET53 messages. The payloads are small
    // JSON — compression buys nothing here worth that risk.
    upstream = new WebSocket(server.ws, {
      headers: { Origin: server.origin },
      perMessageDeflate: false,
    });

    upstream.on("open", () => {
      reconnectDelay = 1000;
      lastAliveAt = Date.now();
      startHeartbeat();
      console.log(`${tag} upstream connected:`, server.ws);
    });

    // The server answering our ping is the only thing that proves it is still
    // there. Silence does not: an open practice session sends nothing at all for
    // minutes on end, which is normal, and a connection that dies without a close
    // frame (a network partition, a box unplugged) leaves readyState at OPEN for
    // as long as the operating system keeps the TCP entry, which can be hours.
    //
    // This matters more than it used to. The live page decides whether it is off
    // air from this socket now, rather than from a silence timer, precisely so a
    // quiet practice session stays on screen — so the socket has to be honest
    // about being alive, or a race finished days ago would still be up there.
    upstream.on("pong", () => {
      lastAliveAt = Date.now();
    });

    upstream.on("message", (buf) => {
      lastMessageAt = Date.now();
      lastAliveAt = Date.now(); // traffic proves liveness as well as a pong does
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      switch (msg.EventType) {
        case 200: // full snapshot — refreshes lap times
          ingestSnapshot(msg.Message);
          break;
        case 53: // per-car telemetry
          if (msg.Message && typeof msg.Message.CarID === "number") {
            liveByCar.set(msg.Message.CarID, msg.Message);
            // Pit-lane edges (IsInPits flipping) are only visible here, at
            // telemetry frequency — the recorder needs them the moment they
            // happen, not at the next 30s snapshot.
            pitRecorder.onTelemetry(server.key, carIdToGuid.get(msg.Message.CarID), msg.Message);
            // Fast lane: followers of THIS car get its cockpit numbers now,
            // not at the next 700ms board tick.
            relayFollowedTelemetry(server.key, carIdToGuid.get(msg.Message.CarID), msg.Message);
          }
          break;
        default:
          break;
      }
    });

    upstream.on("close", () => {
      stopHeartbeat();
      console.log(`${tag} upstream closed; reconnecting…`);
      scheduleReconnect();
    });
    upstream.on("error", (e) => {
      console.log(`${tag} upstream error:`, e.message);
      try {
        upstream.close();
      } catch {
        /* noop */
      }
    });
  }

  // Ping every HEARTBEAT_MS; when nothing has come back for two rounds, check
  // whether the server is actually gone before giving up on the socket.
  //
  // That second check exists because of what a week of Railway logs showed on
  // 2026-08-07: this server manager NEVER answers WebSocket pings, and an
  // empty server sends no messages either — so the old "no pong in 90s means
  // dead" rule tore down a perfectly healthy connection every ~91 seconds,
  // around the clock, on every configured server. Nearly ten thousand
  // reconnects in one week, all false alarms (the moment cars were on track,
  // the message flow counted as life and the churn stopped). So on silence we
  // now ask the manager's HTTP side instead: if the website answers, the box
  // is up and merely quiet — keep the socket. Only when HTTP is dead too is
  // the socket really orphaned; terminate() rather than close(), because a
  // peer that is gone never completes a closing handshake and close() would
  // sit in CLOSING forever.
  let probing = false; // one HTTP probe at a time; ticks during a probe skip
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (Date.now() - lastAliveAt > HEARTBEAT_MS * 2) {
        if (probing) return;
        probing = true;
        const probed = upstream; // the socket this verdict is about — if the
        // connection dies and reconnects while the probe is in flight, the
        // result must not touch its successor.
        fetchUpstream(server.origin, 5000).then((body) => {
          probing = false;
          if (body != null) {
            // Server is up, the socket is just silent (empty track, and the
            // manager doesn't do pongs). Counts as proof of life.
            lastAliveAt = Date.now();
            return;
          }
          if (upstream !== probed) return;
          console.log(`${tag} upstream unresponsive for ${Math.round((Date.now() - lastAliveAt) / 1000)}s and HTTP is down too; dropping it`);
          try {
            upstream.terminate();
          } catch {
            /* already gone */
          }
          // the close handler stops this timer and schedules the reconnect
        });
        return;
      }
      try {
        upstream.ping();
      } catch {
        /* the close handler will pick it up */
      }
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, 15000); // backoff, capped
      connectUpstream();
    }, reconnectDelay);
  }

  function buildEntry(guid, d, onTrack) {
    const ci = d.CarInfo || {};
    const car = (d.Cars && ci.CarModel && d.Cars[ci.CarModel]) || null;
    const live = onTrack ? liveByCar.get(ci.CarID) || {} : {};
    const racePos = live.RacePosition ?? d.RacePosition ?? null;
    if (onTrack && racePos != null) lastRacePosByGuid.set(guid, racePos);
    return {
      // The real GUID stays server-side (it keys the stint and race-position
      // maps above); what leaves the building is the pseudonymous stand-in.
      guid: publicDriverId(guid),
      name: ci.DriverName || "—",
      initials: ci.DriverInitials || "",
      raceNumber: ci.RaceNumber ?? null,
      carModel: ci.CarModel || "",
      carName: ci.CarName || car?.CarName || "",
      carSkin: ci.CarSkin || "",
      // Not a competitor: the pace car. See looksLikeSafetyCar.
      isSafetyCar: looksLikeSafetyCar(ci.CarSkin, ci.CarModel),
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
      // Two decimals, not a whole number: on a long straight two cars are often
      // within a tenth of a km/h of each other, and rounding threw exactly the
      // digits away that tell them apart. The frontend decides how many of them
      // to print.
      topSpeed: car && car.TopSpeedBestLap ? Math.round(car.TopSpeedBestLap * 100) / 100 : null,
      sectors: sectorsOf(car?.BestLapSplits),
      potentialMs: potentialOf(car?.BestSplits),
      inPits: live.IsInPits ?? d.IsInPits ?? false,
      numPits: live.NumPits ?? d.NumPits ?? 0,
      // Cockpit readouts for the map's follow mode. Speed is the magnitude of
      // the ET53 velocity vector (m/s components -> km/h); gear stays in AC's
      // raw convention (0 = reverse, 1 = neutral, 2 = first) — translating is
      // the frontend's job. Only an on-track car streams telemetry.
      speedKmh:
        onTrack && live.Velocity
          ? Math.round(Math.hypot(live.Velocity.X || 0, live.Velocity.Y || 0, live.Velocity.Z || 0) * 3.6)
          : null,
      gear: onTrack ? live.Gear ?? null : null,
      rpm: onTrack ? live.EngineRPM ?? null : null,
      ping: live.Ping ?? d.Ping ?? null,
      drs: live.DRSActive ?? d.DRSActive ?? false,
      deltaSelfMs: onTrack ? live.DeltaToSelf ?? d.DeltaToSelf ?? null : null,
      spline: live.NormalisedSplinePos ?? d.NormalisedSplinePos ?? 0,
      // Real world position (X/Z ground plane) for the real-map dots. Only on-track
      // cars carry live telemetry, so it's null otherwise; rounded to keep the board
      // lean. The frontend projects it onto map.png with the ini's calibration.
      pos: onTrack && live.Pos ? { x: round1(live.Pos.X), z: round1(live.Pos.Z) } : null,
      // Race-session running order (from the high-frequency telemetry). A car
      // that left the server keeps its LAST known position (see lastRacePosByGuid)
      // so the finishing order survives the post-race exodus for a while.
      racePosition: racePos ?? lastRacePosByGuid.get(guid) ?? null,
    };
  }

  // What the frontend gets. Usually the live board; for RESULT_HOLD_MS after a
  // race session ended, the frozen final classification instead (a race result
  // must survive the server cycling back to practice). A new RACE session
  // releases the hold immediately.
  function getBoard() {
    if (finishedRace) {
      if (Date.now() > finishedRace.until || status?.SessionInfo?.Type === 3) {
        finishedRace = null;
      } else {
        return { ...finishedRace.board, connected: upstreamOpen(), updatedAt: Date.now() };
      }
    }
    return buildBoard();
  }

  // Build the clean board we hand to the frontend.
  function buildBoard() {
    if (!status) {
      return { ok: false, connected: upstreamOpen(), server: server.key, session: null, entries: [], updatedAt: Date.now() };
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
    // In a race, drivers the upstream has already forgotten (left the server,
    // aged out of DisconnectedDrivers) come back from our own roster so the
    // classification stays complete until the session changes.
    const resurrected = new Set(); // public ids of roster-only entries
    if (si.Type === 3) {
      for (const [guid, d] of raceRosterByGuid) {
        if (!byGuid.has(guid)) {
          const e = buildEntry(guid, d, false);
          byGuid.set(guid, e);
          resurrected.add(e.guid);
        }
      }
    }
    const entries = [...byGuid.values()];

    // Ranking. A RACE orders by the actual running order (telemetry
    // RacePosition, held for leavers) — sorting a race by best lap made the
    // board's leader flip on every quick lap. Other sessions keep the hot-lap
    // ranking: fastest best lap first; drivers without a lap go last.
    const isRace = si.Type === 3;

    // Getting this wrong would cost a real driver their place, so the safety-car
    // flag only takes effect while safety cars are the small minority of the
    // field they always are in a league round. A session where a quarter of the
    // grid looks like a pace car is something else entirely — a mixed-class
    // event, a bad skin name — and is left exactly as it was.
    const scSeen = entries.filter((e) => e.isSafetyCar).length;
    if (!isRace || scSeen === 0 || scSeen > Math.max(1, Math.floor(entries.length / 4))) {
      for (const e of entries) e.isSafetyCar = false;
    }

    if (isRace) {
      // A resurrected leaver's held position goes stale as the race moves on:
      // a lap-3 quitter would sit mid-field for the rest of the evening. So a
      // leaver who has fallen more than a lap behind the leader is classified
      // at the BOTTOM, by distance covered — a DNF, the way a timing tower
      // shows one. A driver who left on (or near) full distance keeps their
      // held position: that is the finisher who closed the game after the
      // flag, the exact case the roster exists for.
      const maxLaps = entries.reduce((m, e) => Math.max(m, e.lapCount || 0), 0);
      const dropped = (e) => resurrected.has(e.guid) && (e.lapCount || 0) < maxLaps - 1;
      entries.sort((a, b) => {
        // The safety car is not in the race, so it is not in the order either:
        // it sits below the classified runners however far up the road it is.
        if (a.isSafetyCar !== b.isSafetyCar) return a.isSafetyCar ? 1 : -1;
        const da = dropped(a);
        const db = dropped(b);
        if (da !== db) return da ? 1 : -1;
        if (da && db) {
          return (b.lapCount || 0) - (a.lapCount || 0) || (a.racePosition ?? 99) - (b.racePosition ?? 99);
        }
        if (a.racePosition != null && b.racePosition != null) {
          if (a.racePosition !== b.racePosition) return a.racePosition - b.racePosition;
          // Same slot (the sim re-issues a leaver's position to the next car):
          // more laps first, then the car still on the server.
          if ((a.lapCount || 0) !== (b.lapCount || 0)) return (b.lapCount || 0) - (a.lapCount || 0);
          return a.onTrack === b.onTrack ? 0 : a.onTrack ? -1 : 1;
        }
        if (a.racePosition != null) return -1;
        if (b.racePosition != null) return 1;
        return (b.lapCount || 0) - (a.lapCount || 0) || (b.spline || 0) - (a.spline || 0);
      });
    } else {
      entries.sort((a, b) => {
        if (a.bestLapMs && b.bestLapMs) return a.bestLapMs - b.bestLapMs;
        if (a.bestLapMs) return -1;
        if (b.bestLapMs) return 1;
        return (b.lapCount || 0) - (a.lapCount || 0);
      });
    }
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
    // The session's actual fastest lap, which is a different question. In
    // practice and qualifying the board is sorted by lap time, so the first
    // entry holds it and the two agree — but a race is sorted by running order,
    // and there the leader is very often not the quickest. The header card says
    // "session best" and now means it.
    const competitors = entries.filter((e) => !e.isSafetyCar);
    const fastestLapMs = competitors.reduce(
      (best, e) => (e.bestLapMs && (best == null || e.bestLapMs < best) ? e.bestLapMs : best),
      null
    );
    entries.forEach((e, i) => {
      e.position = i + 1;
      e.gapToBestMs = e.bestLapMs && leaderBestMs ? e.bestLapMs - leaderBestMs : null;
    });

    // --- Race gap ------------------------------------------------------------
    // gapToBestMs above compares two fastest laps, set at two unrelated moments.
    // That is the right question in practice and qualifying and the wrong one in
    // a race, where what matters is how far up the road the leader is NOW. So a
    // race also gets gapToLeaderMs / intervalMs (to the car ahead) and lapsDown,
    // measured off the line crossings; practice and qualifying leave them null
    // and keep using the lap gap.
    if (isRace) {
      // crossingsByGuid is keyed by the real Steam id, which never leaves this
      // module — the entries carry the pseudonym. Walk back through the map the
      // entries were built from to pair them up again.
      const realGuid = new Map([...byGuid].map(([guid, entry]) => [entry, guid]));
      const crossedAt = (entry, lap) => {
        const list = crossingsByGuid.get(realGuid.get(entry));
        return list?.find((c) => c.lap === lap)?.at ?? null;
      };
      // How far this car was behind that one when they last crossed the same
      // line. Null when either of them hasn't been seen crossing it (too far
      // back, or joined after).
      const gapBetween = (behind, ahead) => {
        const lap = Math.min(behind.lapCount || 0, ahead.lapCount || 0);
        if (lap < 1) return null;
        const mine = crossedAt(behind, lap);
        const theirs = crossedAt(ahead, lap);
        if (mine == null || theirs == null) return null;
        // Crossed that lap FIRST, yet ranked behind: the two facts disagree,
        // which happens when a car that has left the server holds a position
        // the race has since moved past. Clamping that to zero would print
        // "0.000" — the one number a reader would take as certain. Unknown.
        return mine >= theirs ? mine - theirs : null;
      };

      const running = entries.filter((e) => !e.isSafetyCar);
      running.forEach((e, i) => {
        const leader = running[0]; // there is one, or this loop doesn't run
        const ahead = i > 0 ? running[i - 1] : null;
        // Laps down, with the correction every timing tower needs: for the few
        // seconds between the leader crossing the line and the car behind doing
        // the same, the counters differ by one without anybody having been
        // lapped. That car is simply further round the lap — which is the two
        // splines COMPARED, not either of them trusted as a measurement.
        let down = (leader.lapCount || 0) - (e.lapCount || 0);
        if (down === 1 && e.onTrack && leader.onTrack && (e.spline || 0) > (leader.spline || 0)) down = 0;
        // Negative means more laps than the leader has — the same disagreement
        // gapBetween guards against. Not "level with the leader": unknown.
        e.lapsDown = Math.max(0, down);
        e.gapToLeaderMs = down === 0 ? gapBetween(e, leader) : null;
        e.intervalMs = ahead && (e.lapCount || 0) === (ahead.lapCount || 0) ? gapBetween(e, ahead) : null;
      });
      // The pace car is not racing anybody.
      for (const e of entries) {
        if (!e.isSafetyCar) continue;
        e.lapsDown = 0;
        e.gapToLeaderMs = null;
        e.intervalMs = null;
      }
    } else {
      for (const e of entries) {
        e.lapsDown = 0;
        e.gapToLeaderMs = null;
        e.intervalMs = null;
      }
    }

    // Session remaining time (Time is in minutes; ElapsedMilliseconds from the
    // last full snapshot). Frontend ticks it down locally between snapshots.
    const remainingMs =
      si.Time > 0 ? Math.max(0, si.Time * 60000 - (si.ElapsedMilliseconds || 0)) : null;

    return {
      ok: true,
      connected: upstreamOpen(),
      server: server.key,
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
        bestLapMs: fastestLapMs ?? sessionBestMs,
        // Counted over the competitors: a pace car in the field would otherwise
        // make a 39-car race read as 40, and the "fastest lap" line under the
        // leader would be open to a car that is not in the race.
        driverCount: competitors.length,
        onTrackCount: competitors.filter((e) => e.onTrack).length,
        // Is the pace car out there right now? Sitting in its garage all evening
        // (which is where it usually is) does not count, and neither does the
        // lap it spends coming back in.
        safetyCar: entries.some((e) => e.isSafetyCar && e.onTrack && !e.inPits),
        // The green light, so the opening lap can be timed (see sessionStartedAt).
        startedAt: sessionStartedAt,
        // The car actually leading the race — never the safety car, and never a
        // driver who happens to hold the fastest lap. Null outside a race.
        leaderName: isRace ? competitors[0]?.name ?? null : null,
        // How many laps the leader still has to do, for a lap-limited race.
        lapsLeft: isRace && si.Laps > 0 ? Math.max(0, si.Laps - (competitors[0]?.lapCount ?? 0)) : null,
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

  // How far into the race that is on air RIGHT NOW, in seconds — or null when
  // this server is not running one.
  //
  // The reason it exists is the in-game report button. A report fired mid-race
  // knows the moment it happened as a wall clock and nothing else, and the one
  // figure a steward actually wants — how far into the session to drag the
  // replay — could only be worked out after the round's result file was
  // imported, which is hours later. The session is on air while the button is
  // being pressed, so the figure is knowable at that instant: this hands it
  // over. See routes/reports.js POST /ingest.
  //
  // Measured from `sessionStartedAt`, which is the same anchor the board's
  // opening-lap timer uses: the start of the SESSION, grid wait included, which
  // is also where the replay file begins. That is what makes this number and
  // the one derived from the archive afterwards mean the same thing.
  //
  // Null rather than a guess whenever the reading cannot be trusted: no
  // snapshot recently (a dead socket keeps the last one forever), not a race,
  // no anchor yet, or a figure outside any plausible session length.
  function raceSecond() {
    const si = status?.SessionInfo;
    if (!si || si.Type !== 3) return null;
    if (sessionStartedAt == null) return null;
    if (!lastSnapshotAt || Date.now() - lastSnapshotAt > STALE_MS) return null;
    const second = Math.round((Date.now() - sessionStartedAt) / 1000);
    return second >= 0 && second <= MAX_SESSION_S ? second : null;
  }

  return {
    key: server.key,
    connect: connectUpstream,
    getBoard,
    raceSecond,
    getTrackMapPng: () => trackMap?.png || null,
    // Size of every per-relay structure that can grow, for the memory
    // diagnostics. Counts only — the point is spotting the one that climbs.
    stats: () => ({
      connected: upstreamOpen(),
      lastMessageAgoS: lastMessageAt ? Math.round((Date.now() - lastMessageAt) / 1000) : null,
      cars: liveByCar.size,
      stintDrivers: stintsByGuid.size,
      heldPositions: lastRacePosByGuid.size,
      crossingDrivers: crossingsByGuid.size, // capped at CROSSINGS_KEPT each

      raceRoster: raceRosterByGuid.size,
      resultHold: !!finishedRace,
      trackMapKb: trackMap?.png ? Math.round(trackMap.png.length / 1024) : 0,
    }),
    // Test hooks (state is per-relay, so tests drive an unconnected instance).
    __accumulateStints: accumulateStints,
    __stintsFor: stintsFor,
    __ingest: ingestSnapshot,
    __getBoard: getBoard,
    __reset() {
      stintsByGuid.clear();
      raceRosterByGuid.clear();
      lastRacePosByGuid.clear();
      crossingsByGuid.clear();
      liveByCar.clear();
      finishedRace = null;
      stintSessionKey = null;
      status = null;
      sessionStartedAt = null;
      startedAtKey = null;
      lastSnapshotAt = 0;
    },
  };
}

// All configured relays, keyed by server key. Created up front (no sockets yet
// — initLiveTiming connects them), so REST reads before init don't crash.
const relays = new Map(LIVE_SERVERS.map((s) => [s.key, createRelay(s)]));

function relayFor(key) {
  return relays.get(key) || relays.get(DEFAULT_SERVER_KEY);
}

// Public board read. `serverKey` optional — default: the first server (the old
// single-server behaviour).
export function getBoard(serverKey) {
  return relayFor(serverKey).getBoard();
}

export function getTrackMapPng(serverKey) {
  return relayFor(serverKey).getTrackMapPng();
}

// How far into a live race we are, in seconds, for something that has to stamp
// itself with "this happened N seconds into the session" while the session is
// still running (routes/reports.js POST /ingest).
//
// `serverKey` is the server the round's SERIES is assigned to, and it is asked
// first — with two servers the league can run two races at once, and the round
// a report belongs to knows which one it is. But that assignment is admin
// managed and can be out of date, so a server that turns out not to be racing
// falls through to the one that is. Two races on air at the same time and no
// usable assignment is genuinely ambiguous: null, and the report keeps its
// wall-clock anchor alone until the result file settles the question.
export function liveRaceSecond(serverKey) {
  const preferred = serverKey && relays.has(serverKey) ? relays.get(serverKey).raceSecond() : null;
  if (preferred != null) return preferred;
  const running = [...relays.values()].map((r) => r.raceSecond()).filter((s) => s != null);
  return running.length === 1 ? running[0] : null;
}

// Live-timing internals for the memory diagnostics (services/memoryDiagnostics
// .js): how many frontend viewers hang on our socket, how many ids the
// pseudonym cache holds, and each relay's growable structures. `clientWss` is
// set once the frontend WebSocket exists — before initLiveTiming (or in tests)
// the honest answer is simply zero viewers.
let clientWss = null;

// The follow fast-lane. The 700ms board tick is fine for the tables, but the
// cockpit readout (speed/gear/revs) next to a followed car looked laggy next
// to the server manager's own page, which repaints on every telemetry message.
// So a client may declare ONE car it follows ({follow: <public id>} on the
// socket, see initLiveTiming); that car's numbers are then relayed the moment
// its ET53 arrives. A tiny message, one car, only to its followers — the
// broadcast cadence for everyone else stays untouched.
function relayFollowedTelemetry(serverKey, guid, live) {
  if (!clientWss || !guid) return;
  let json = null; // built lazily — most ticks nobody follows this car
  for (const c of clientWss.clients) {
    if (c.readyState !== WebSocket.OPEN || c.isDemo || !c.followGuid) continue;
    if ((c.serverKey || DEFAULT_SERVER_KEY) !== serverKey) continue;
    if (c.followGuid !== publicDriverId(guid)) continue;
    json ??= JSON.stringify({
      car: {
        guid: publicDriverId(guid),
        speedKmh: live.Velocity
          ? Math.round(Math.hypot(live.Velocity.X || 0, live.Velocity.Y || 0, live.Velocity.Z || 0) * 3.6)
          : null,
        gear: live.Gear ?? null,
        rpm: live.EngineRPM ?? null,
      },
    });
    try {
      c.send(json);
    } catch {
      /* dead socket — ws will clean it up */
    }
  }
}

export function getLiveStats() {
  return {
    viewers: clientWss ? clientWss.clients.size : 0,
    publicIds: publicIdCache.size,
    servers: Object.fromEntries([...relays].map(([key, r]) => [key, r.stats()])),
  };
}

// What the viewer sockets were still holding on the last broadcast tick.
//
// The suspicion behind the race-night memory climb is buffered payloads rather
// than the JS heap (see CLIENT_HEARTBEAT_MS): a socket nobody reads keeps every
// board ws has handed it, and none of that shows up in a heap snapshot. The
// broadcast loop already reads bufferedAmount per viewer to decide whether to
// drop the socket, so the numbers are free — this just keeps the last tick's
// total and worst offender around for the memory diagnostics to print.
//
// Sampling only, no behaviour. `sampledAt` stays null until the broadcast loop
// has run once at all — that is, until initLiveTiming has built the client
// socket server (before that, and in tests, there is nothing to sample). A tick
// with nobody connected is still a sample: it writes zeros, so the reading is
// always "right now", never a stale race-night high-water mark left behind.
let viewerBufferStats = { viewers: 0, totalBufferedBytes: 0, maxBufferedBytes: 0, sampledAt: null };

export function getViewerBufferStats() {
  return viewerBufferStats;
}

// Test hook: the stint accumulator carries per-relay state; tests drive a
// dedicated detached relay (never connected) and reset between cases.
const testRelay = createRelay({ key: "test", origin: "https://test.invalid", ws: "wss://test.invalid" });
export const __testing = {
  accumulateStints: testRelay.__accumulateStints,
  stintsFor: testRelay.__stintsFor,
  ingest: testRelay.__ingest,
  getBoard: testRelay.__getBoard,
  raceSecond: testRelay.raceSecond,
  reset: testRelay.__reset,
};

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
    // The demo grid uses the primary series' active roster (several seasons can
    // be active now — one per series).
    const { getActiveSeason } = await import("./seasonService.js");
    const active = await getActiveSeason(prisma);
    const drivers = await prisma.driver.findMany({
      where: { seasonId: active?.id, tier: { in: [1, 2] } },
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
      // Each car crossed the line when ITS current lap began (spline progress),
      // so the "current lap" clocks tick apart like a real field — one shared
      // timestamp made every clock run in lockstep.
      lastLapAt: Date.now() - Math.round(spline * (80500 + idx * 200)),
      lapCount: c.lapBase + lapsDone,
      // Fractional, like the real thing (see buildEntry), so the demo exercises
      // the two decimals the timing table prints.
      topSpeed: Math.round((330.4 - idx * 1.37) * 100) / 100,
      sectors: [null, null, null],
      // No sector times in the demo, but an ideal lap the table can sort by:
      // a few tenths under each car's best, as a real one always is.
      potentialMs: 80000 + idx * 180 - (140 + idx * 9),
      numPits: Math.max(0, c.stints.length - 1),
      ping: 30 + idx,
      drs: false,
      deltaSelfMs: null,
      spline,
      // Filled in below from actual race progress, so the demo has real
      // overtakes (exercises the Driving-Now / projection flip animations).
      racePosition: 0,
      position: 0,
      gapToBestMs: idx === 0 ? 0 : idx * 300,
      _prog: prog,
    };
  });
  // Order by distance covered — the cars run at slightly different speeds, so
  // the running order genuinely changes over time, like a real race.
  entries.sort((a, b) => b._prog - a._prog);
  const leadProg = entries[0]?._prog ?? 0;
  entries.forEach((e, i) => {
    e.position = i + 1;
    e.racePosition = i + 1;
    // Same shape the real board ships, so the race columns are exercised here
    // too — a field missing from the demo is a column that reads blank in every
    // dev session, which is exactly where it gets looked at first. Including
    // the real board's rule that a car laps down has no interval either.
    e.isSafetyCar = false;
    e.lapsDown = Math.floor(leadProg - e._prog);
    e.gapToLeaderMs = e.lapsDown === 0 ? Math.round((leadProg - e._prog) * 82000) : null;
    const ahead = i > 0 ? entries[i - 1] : null;
    e.intervalMs =
      ahead && Math.floor(ahead._prog) === Math.floor(e._prog)
        ? Math.round((ahead._prog - e._prog) * 82000)
        : null;
  });
  // _prog is read across rows above (each car against the one ahead), so it can
  // only be dropped once every row is done with it.
  for (const e of entries) delete e._prog;
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
      // The FASTEST lap, not the leader's — the demo is ordered by distance
      // covered, so those are different cars, exactly as in a real race.
      bestLapMs: entries.reduce((b, e) => (e.bestLapMs && (b == null || e.bestLapMs < b) ? e.bestLapMs : b), null),
      driverCount: entries.length,
      onTrackCount: entries.filter((e) => e.onTrack).length,
      safetyCar: false,
      leaderName: entries[0]?.name ?? null,
      lapsLeft: Math.max(0, DEMO_RACE_LAPS - (entries[0]?.lapCount ?? 0)),
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

// The series slug a client asked for on the WS URL (?series=<slug>), if any.
function seriesOf(req) {
  const m = /[?&]series=([a-z0-9-]+)/i.exec(req?.url || "");
  return m ? m[1].toLowerCase() : null;
}

// Attach the frontend-facing WebSocket and start the upstream connections.
export function initLiveTiming(server) {
  for (const r of relays.values()) r.connect();

  const wss = new WebSocketServer({ server, path: "/api/live/ws" });
  clientWss = wss; // memory diagnostics read the viewer count from here

  // A socket that errors with no 'error' listener re-throws inside ws, and an
  // uncaught exception ends the process — which here is the whole site, the API
  // and the downloads, not just live timing. Sockets die for entirely ordinary
  // reasons on race night (a phone leaving wifi mid-frame, a proxy resetting an
  // idle connection), so this needs a listener on both the server and every
  // client. There is nothing to do about it beyond not dying: ws closes the
  // socket itself, and the next broadcast simply skips it.
  wss.on("error", (e) => console.error("[live] client WS server error:", e.message));

  wss.on("connection", async (ws, req) => {
    ws.on("error", (e) => console.error("[live] client socket error:", e.message));
    // Liveness for the sweep below. The browser's own stack answers the ping,
    // so this flips back to true for every viewer that still exists.
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    // The one thing a client may say to us: which car it follows (the map's
    // focus mode). Anything else on the socket is ignored.
    ws.on("message", (buf) => {
      try {
        const m = JSON.parse(buf.toString());
        if ("follow" in m) {
          ws.followGuid = typeof m.follow === "string" && m.follow.length <= 64 ? m.follow : null;
        }
      } catch {
        /* not a follow message — ignore */
      }
    });
    ws.isDemo = wantsDemo(req);
    if (ws.isDemo) await ensureDemoState();
    // Which race server this client follows: resolved once, from the series it
    // passes on the URL (admin-managed assignment; default = first server).
    ws.serverKey = DEFAULT_SERVER_KEY;
    try {
      ws.serverKey = await serverKeyForSeries(prisma, seriesOf(req));
    } catch {
      /* settings unreadable — stay on the default server */
    }
    // send a snapshot immediately so the board paints without waiting a tick
    try {
      ws.send(JSON.stringify(ws.isDemo ? getDemoBoard() : getBoard(ws.serverKey)));
    } catch {
      /* noop */
    }
  });

  // The last frame each board variant went out as: the serialized board with
  // its timestamp blanked, and when we sent it. Keyed by server key (plus the
  // demo), exactly like the per-tick build below.
  const lastFrameByKey = new Map();

  // The frame to send for one board, or null when there is nothing to say.
  //
  // A board that is byte-for-byte what this variant last received is not worth
  // sending again, and the finished-race hold makes that the normal case rather
  // than a corner one: for RESULT_HOLD_MS (fifteen minutes) after the flag the
  // classification is frozen, and every viewer was handed the same unchanging
  // result about one and a half times a second for the whole quarter of an hour.
  //
  // `updatedAt` has to sit outside the comparison or none of this works: it is
  // Date.now() on every build, so no two boards ever compare equal. It is
  // blanked for the comparison only — the board that goes on the wire carries
  // the real value, so "when was this frame produced" means on the frontend
  // exactly what it always did.
  //
  // Blanking mutates the board, which is safe because every path that produces
  // one returns a fresh object (buildBoard, the frozen-result copy, the demo).
  //
  // The demo board never reaches this as "unchanged": its splines and lap clocks
  // are derived from Date.now() on every read, so it moves on every tick — which
  // is the point of it.
  function frameFor(key, board, now) {
    const at = board.updatedAt;
    board.updatedAt = 0;
    const cmp = JSON.stringify(board);
    const prev = lastFrameByKey.get(key);
    if (prev && prev.cmp === cmp && now - prev.at < KEEPALIVE_MS) return null;
    lastFrameByKey.set(key, { cmp, at: now });
    board.updatedAt = at;
    return JSON.stringify(board);
  }

  setInterval(() => {
    const now = Date.now();
    if (wss.clients.size === 0) {
      viewerBufferStats = { viewers: 0, totalBufferedBytes: 0, maxBufferedBytes: 0, sampledAt: now };
      return;
    }
    // Build each variant at most once per tick (demo + one per server), then
    // fan out to the clients following it. Note that the board is still BUILT
    // every tick even when it is not sent: getBoard() is what expires a
    // finished race's frozen result (see the hold in the relay), and it must
    // keep being asked at the old cadence.
    const frameByKey = new Map(); // key -> json to send, or null when unchanged
    let demoFrame; // undefined = not built this tick
    let viewers = 0;
    let totalBuffered = 0;
    let maxBuffered = 0;
    for (const c of wss.clients) {
      if (c.readyState !== WebSocket.OPEN) continue;
      // OPEN can go stale between the check and the send (the socket dies in
      // between), and one client's failure must not cost the rest of the grid
      // its update — so each send stands on its own, same as the snapshot sent
      // on connect.
      // A socket still carrying a backlog is not reading. Writing more into it
      // only grows the backlog, so drop it instead: ws would otherwise hold
      // every unsent board for as long as the TCP entry survives. terminate()
      // rather than close(), for the same reason as upstream — a peer that is
      // already gone never finishes a closing handshake.
      // Read once: it is both the drop criterion and the sample the memory
      // diagnostics report (getViewerBufferStats).
      const buffered = c.bufferedAmount;
      viewers += 1;
      totalBuffered += buffered;
      if (buffered > maxBuffered) maxBuffered = buffered;
      if (buffered > MAX_BUFFERED_BYTES) {
        console.log(`[live] dropping a viewer socket with ${Math.round(buffered / 1024)} kB unsent`);
        try {
          c.terminate();
        } catch {
          /* already gone */
        }
        continue;
      }
      try {
        if (c.isDemo) {
          if (demoFrame === undefined) demoFrame = frameFor("demo", getDemoBoard(), now);
          if (demoFrame) c.send(demoFrame);
        } else {
          const key = c.serverKey || DEFAULT_SERVER_KEY;
          if (!frameByKey.has(key)) frameByKey.set(key, frameFor(key, getBoard(key), now));
          const frame = frameByKey.get(key);
          // Nothing new for this board. A viewer who joined during a quiet spell
          // is not left waiting by that: the connection handler above sends them
          // the current board the moment they arrive, and "current" is by
          // definition the very frame being skipped here.
          if (frame) c.send(frame);
        }
      } catch {
        /* dead socket — ws will clean it up */
      }
    }
    viewerBufferStats = { viewers, totalBufferedBytes: totalBuffered, maxBufferedBytes: maxBuffered, sampledAt: now };
  }, BROADCAST_MS);

  // Ping every viewer; anything that has not answered since the last round is
  // gone and leaves wss.clients here rather than lingering for hours.
  setInterval(() => {
    for (const c of wss.clients) {
      if (c.isAlive === false) {
        try {
          c.terminate();
        } catch {
          /* already gone */
        }
        continue;
      }
      c.isAlive = false;
      try {
        c.ping();
      } catch {
        /* the next round terminates it */
      }
    }
  }, CLIENT_HEARTBEAT_MS);

  console.log(
    `[live] frontend WS ready on /api/live/ws (servers: ${LIVE_SERVERS.map((s) => s.key).join(", ")})` +
      (DEMO_ENABLED ? " (demo available via ?demo=1)" : "")
  );
}
