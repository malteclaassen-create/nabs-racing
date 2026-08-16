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
// What is kept is deliberately small: the THREE fastest laps per driver per
// track. Nobody wants an archive of every practice lap ever driven — the game
// server keeps those — but one lap each turned out to be too few. A driver's
// best lap is often the one where everything happened to come together, and a
// steward or a team-mate comparing against it learns less than they would from
// the two behind it, which show what the driver does repeatably. Three is the
// smallest number that shows a pattern rather than a peak.
//
// Channels are sampled by TRACK POSITION, not by time: the app writes a value
// every 1/N of the lap, so two laps line up bucket-for-bucket and "where does
// the time go" is a subtraction, not an interpolation problem.
//
// Files under DATA_DIR/telemetry-laps/<trackKey>/<steamId>/<lapTimeMs>.json —
// the steamId is digits-only and the lap time is a number, so both are safe as
// path segments; the trackKey is slugged here. On-disk rather than in the DB
// for the same reason the results archive is: a few tens of KB of arrays per
// lap is a file, not a row.
//
// The lap TIME is the file name, which makes the three questions this store
// has to answer cheap: what is a driver's best (first name in a sorted list),
// is a new lap worth keeping (compare against the third), and which one has to
// go (the last). It also makes a re-posted identical time overwrite itself
// rather than accumulate.
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
  // World position in decimetres (±40 km covers any track), for the map the
  // comparison draws FROM the lap itself — no track files involved.
  const x = channel(body.x, n, -400_000, 400_000);
  const z = channel(body.z, n, -400_000, 400_000);
  if (!t || !speed || !gas || !brake || !steer || !gear || !x || !z) return { error: "Bad lap shape" };
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
      x,
      z,
    },
  };
}

// How many of a driver's laps are kept at one track. Three, and the number
// lives here because every function below has to agree about it.
export const KEEP_PER_DRIVER = 3;

const LAP_ID_RE = /^\d{4,8}$/; // a lap time in ms: 20s to 30min, the bounds above
export const isLapId = (s) => LAP_ID_RE.test(String(s || ""));

function driverDir(trackKey, steamId) {
  return join(TELEMETRY_LAPS_DIR, trackKey, steamId);
}

function fileFor(trackKey, steamId, lapTimeMs) {
  return join(driverDir(trackKey, steamId), `${lapTimeMs}.json`);
}

// Where a lap lived before this store kept more than one: one file per driver,
// named after them. Read wherever laps are read so a round already recorded
// does not vanish when this ships; never written again.
function legacyFileFor(trackKey, steamId) {
  return join(TELEMETRY_LAPS_DIR, trackKey, `${steamId}.json`);
}

// One driver's stored laps at one track, fastest first: { lapTimeMs, path }.
// Reads the file NAMES only — the arrays inside stay on disk until somebody
// opens a comparison.
export function lapFilesOf(trackKey, steamId) {
  if (!isTrackKey(trackKey) || !isSteamId(steamId)) return [];
  const out = [];
  const dir = driverDir(trackKey, steamId);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      const ms = Number(f.replace(/\.json$/, ""));
      if (!f.endsWith(".json") || !Number.isFinite(ms)) continue;
      out.push({ lapTimeMs: ms, path: join(dir, f) });
    }
  }
  const legacy = legacyFileFor(trackKey, steamId);
  if (existsSync(legacy)) {
    try {
      const ms = Number(JSON.parse(readFileSync(legacy, "utf8")).lapTimeMs);
      // Skip it when the same time already sits in the new layout, or the same
      // lap would be offered twice under two names.
      if (Number.isFinite(ms) && !out.some((x) => x.lapTimeMs === ms)) {
        out.push({ lapTimeMs: ms, path: legacy });
      }
    } catch {
      /* unreadable legacy file: it simply does not exist as far as this goes */
    }
  }
  return out.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
}

// One stored lap, channels and all. `lapId` is the lap time in milliseconds;
// without one, the driver's fastest — which is what a caller that has not
// chosen wants, and what every caller wanted before there was a choice.
export function readLap(trackKey, steamId, lapId = null) {
  if (!isTrackKey(trackKey) || !isSteamId(steamId)) return null;
  const files = lapFilesOf(trackKey, steamId);
  if (!files.length) return null;
  const want = lapId == null ? files[0] : files.find((f) => String(f.lapTimeMs) === String(lapId));
  if (!want) return null;
  try {
    return JSON.parse(readFileSync(want.path, "utf8"));
  } catch {
    return null;
  }
}

// Keep the lap if it belongs in this driver's fastest three here, and drop
// whatever it pushed out. Returns what happened, so the app can tell the
// driver "kept" or "your stored three are all quicker".
export function keepIfFaster(lap) {
  const files = lapFilesOf(lap.trackKey, lap.steamId);
  const best = files.length ? files[0].lapTimeMs : null;

  // Already stored, to the millisecond: nothing to write, and nothing lost.
  if (files.some((f) => f.lapTimeMs === lap.lapTimeMs)) {
    return { kept: false, bestMs: best, stored: files.length };
  }
  // Slower than all three of them, and there are already three.
  if (files.length >= KEEP_PER_DRIVER && lap.lapTimeMs >= files[KEEP_PER_DRIVER - 1].lapTimeMs) {
    return { kept: false, bestMs: best, stored: files.length };
  }

  mkdirSync(driverDir(lap.trackKey, lap.steamId), { recursive: true });
  writeFileSync(fileFor(lap.trackKey, lap.steamId, lap.lapTimeMs), JSON.stringify(lap));

  // Prune from the slow end. Recomputed rather than assumed: a legacy file or
  // a hand-dropped one means the count before the write is not always what is
  // on disk after it.
  for (const extra of lapFilesOf(lap.trackKey, lap.steamId).slice(KEEP_PER_DRIVER)) {
    try {
      unlinkSync(extra.path);
    } catch {
      /* it will be pruned on the next post */
    }
  }
  return { kept: true, bestMs: Math.min(lap.lapTimeMs, best ?? lap.lapTimeMs), stored: Math.min(files.length + 1, KEEP_PER_DRIVER) };
}

// Remove one lap, or every lap this driver has at this track when no lap is
// named. The admin card removes a modded-car time or somebody else's entry;
// removing the person means all of them.
export function deleteLap(trackKey, steamId, lapId = null) {
  if (!isTrackKey(trackKey) || !isSteamId(steamId)) return false;
  const files = lapFilesOf(trackKey, steamId);
  const targets = lapId == null ? files : files.filter((f) => String(f.lapTimeMs) === String(lapId));
  if (!targets.length) return false;
  let gone = false;
  for (const t of targets) {
    try {
      unlinkSync(t.path);
      gone = true;
    } catch {
      /* already gone */
    }
  }
  return gone;
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
// somebody actually opens a comparison. Fastest first, and every entry carries
// a `lapId` because a driver now has more than one: it is the lap time in
// milliseconds, which is unique per driver per track by construction.
export function listLaps(trackKey) {
  if (!isTrackKey(trackKey)) return [];
  const dir = join(TELEMETRY_LAPS_DIR, trackKey);
  if (!existsSync(dir)) return [];
  const out = [];
  const read = (path, lapId) => {
    try {
      const lap = JSON.parse(readFileSync(path, "utf8"));
      out.push({
        steamId: lap.steamId,
        lapId: String(lapId ?? lap.lapTimeMs),
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
  };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // A driver's folder: their laps, one file each.
    if (entry.isDirectory() && isSteamId(entry.name)) {
      for (const f of lapFilesOf(trackKey, entry.name)) read(f.path, f.lapTimeMs);
      continue;
    }
    // The old one-file-per-driver layout, still read (see legacyFileFor). Skip
    // it where that driver has a folder, or the same lap appears twice.
    if (entry.isFile() && entry.name.endsWith(".json")) {
      const steamId = entry.name.replace(/\.json$/, "");
      if (isSteamId(steamId) && existsSync(join(dir, steamId))) continue;
      read(join(dir, entry.name), null);
    }
  }
  return out.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
}
