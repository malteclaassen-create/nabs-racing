// ---------------------------------------------------------------------------
// Driver-recorded telemetry laps: what the in-game nabsTelemetry app sends.
//
// The one thing the race server can never provide. Its plugin interface hands
// out lap times, sectors and speeds — but throttle, brake and steering exist
// only on the driver's own PC, inside the sim. So they arrive the same way the
// in-race incident reports do: a CSP Lua app posts JSON to the site with an
// admin-minted key in the URL (the app cannot set headers), and the site
// stores it.
//
// What is kept is deliberately tiny: ONE lap per driver per track — their
// fastest — overwritten only when a faster one arrives. The league already
// concluded that nobody wants an archive of every practice lap ever driven
// (the game server keeps those); what they want is "show me MY best lap
// against YOURS, pedal for pedal". That needs exactly one lap per person.
//
// Channels are sampled by TRACK POSITION, not by time: the app writes a value
// every 1/N of the lap, so two laps line up bucket-for-bucket and "where does
// the time go" is a subtraction, not an interpolation problem.
//
// Files under DATA_DIR/telemetry-laps/<trackKey>/<steamId>.json — the steamId
// is digits-only (validated), so it is safe as a file name; the trackKey is
// slugged here. On-disk rather than in the DB for the same reason the results
// archive is: a few tens of KB of arrays per lap is a file, not a row.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { DATA_ROOT } from "./dataDirs.js";

export const TELEMETRY_LAPS_DIR = join(DATA_ROOT, "telemetry-laps");

// Same bar as everywhere else on the site: above 30 minutes it is not a lap.
const MAX_LAP_MS = 1_800_000;
const MIN_LAP_MS = 20_000;

// Sample-count bounds. The app sends 800; the bounds leave room for a tweak
// on its side without a lockstep deploy, while still refusing nonsense.
const MIN_N = 50;
const MAX_N = 1500;

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export function trackKeyOf(track, layout) {
  const t = slug(track) || "track";
  const l = slug(layout);
  return l ? `${t}--${l}` : t;
}

const TRACK_KEY_RE = /^[a-z0-9-]{1,120}$/;
const STEAM_RE = /^\d{10,20}$/;

export const isTrackKey = (k) => TRACK_KEY_RE.test(String(k || ""));
export const isSteamId = (s) => STEAM_RE.test(String(s || ""));

// One numeric channel: right length, every value a finite number inside its
// range, rounded to integers so a hand-crafted payload of doubles cannot
// balloon the file.
function channel(arr, n, lo, hi) {
  if (!Array.isArray(arr) || arr.length !== n) return null;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = Number(arr[i]);
    if (!Number.isFinite(v)) return null;
    out[i] = Math.round(Math.min(hi, Math.max(lo, v)));
  }
  return out;
}

// Validate an incoming lap into its stored shape, or say what is wrong.
// Returns { ok, lap } | { error }.
export function parseLapPayload(body) {
  if (!body || typeof body !== "object") return { error: "No body" };
  if (Number(body.v) !== 1) return { error: "Unknown payload version" };

  const steamId = String(body.steamId || "").trim();
  if (!isSteamId(steamId)) return { error: "Bad steamId" };
  const name = String(body.name || "").trim().slice(0, 64);
  if (!name) return { error: "No driver name" };
  const car = String(body.car || "").trim().slice(0, 80);
  const track = String(body.track || "").trim().slice(0, 80);
  if (!track) return { error: "No track" };
  const layout = String(body.layout || "").trim().slice(0, 80);

  const lapTimeMs = Math.round(Number(body.lapTimeMs));
  if (!Number.isFinite(lapTimeMs) || lapTimeMs < MIN_LAP_MS || lapTimeMs > MAX_LAP_MS) {
    return { error: "Implausible lap time" };
  }

  const n = Number(body.n);
  if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) return { error: "Bad sample count" };

  const t = channel(body.t, n, 0, lapTimeMs + 10_000);
  const speed = channel(body.speed, n, 0, 500);
  const gas = channel(body.gas, n, 0, 100);
  const brake = channel(body.brake, n, 0, 100);
  const steer = channel(body.steer, n, -12_000, 12_000); // tenths of a degree
  const gear = channel(body.gear, n, -1, 12);
  if (!t || !speed || !gas || !brake || !steer || !gear) return { error: "Bad lap shape" };
  // Time must move forward through the lap, or the delta chart would lie.
  for (let i = 1; i < n; i++) if (t[i] < t[i - 1]) return { error: "Non-monotonic time channel" };

  return {
    ok: true,
    lap: {
      v: 1,
      steamId,
      name,
      car,
      track,
      layout,
      trackKey: trackKeyOf(track, layout),
      lapTimeMs,
      n,
      recordedAt: new Date().toISOString(),
      t,
      speed,
      gas,
      brake,
      steer,
      gear,
    },
  };
}

function fileFor(trackKey, steamId) {
  return join(TELEMETRY_LAPS_DIR, trackKey, `${steamId}.json`);
}

export function readLap(trackKey, steamId) {
  if (!isTrackKey(trackKey) || !isSteamId(steamId)) return null;
  try {
    return JSON.parse(readFileSync(fileFor(trackKey, steamId), "utf8"));
  } catch {
    return null;
  }
}

// Keep the lap ONLY if it beats what is stored. Returns what happened, so the
// app can tell the driver "kept" vs "you already have a 1:31.2 here".
export function keepIfFaster(lap) {
  const existing = readLap(lap.trackKey, lap.steamId);
  if (existing && Number(existing.lapTimeMs) <= lap.lapTimeMs) {
    return { kept: false, bestMs: existing.lapTimeMs };
  }
  const dir = join(TELEMETRY_LAPS_DIR, lap.trackKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fileFor(lap.trackKey, lap.steamId), JSON.stringify(lap));
  return { kept: true, bestMs: lap.lapTimeMs };
}

export function deleteLap(trackKey, steamId) {
  if (!isTrackKey(trackKey) || !isSteamId(steamId)) return false;
  try {
    unlinkSync(fileFor(trackKey, steamId));
    return true;
  } catch {
    return false;
  }
}

// All tracks that have at least one lap, with a light summary each.
export function listTracks() {
  if (!existsSync(TELEMETRY_LAPS_DIR)) return [];
  const out = [];
  for (const dirName of readdirSync(TELEMETRY_LAPS_DIR)) {
    if (!isTrackKey(dirName)) continue;
    const laps = listLaps(dirName);
    if (!laps.length) continue;
    out.push({
      trackKey: dirName,
      track: laps[0].track,
      layout: laps[0].layout,
      laps: laps.length,
      bestMs: laps[0].lapTimeMs,
    });
  }
  return out.sort((a, b) => a.trackKey.localeCompare(b.trackKey));
}

// Every stored lap of one track — metadata only, channels stay on disk until
// somebody actually opens a comparison. Fastest first.
export function listLaps(trackKey) {
  if (!isTrackKey(trackKey)) return [];
  const dir = join(TELEMETRY_LAPS_DIR, trackKey);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const lap = JSON.parse(readFileSync(join(dir, f), "utf8"));
      out.push({
        steamId: lap.steamId,
        name: lap.name,
        car: lap.car,
        track: lap.track,
        layout: lap.layout,
        lapTimeMs: lap.lapTimeMs,
        recordedAt: lap.recordedAt,
      });
    } catch {
      /* an unreadable file is skipped, not fatal */
    }
  }
  return out.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
}
