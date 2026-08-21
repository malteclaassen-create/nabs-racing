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
// Files under DATA_DIR/telemetry-laps/s<season>/<trackKey>/<steamId>/<lapTimeMs>.json —
// the steamId is digits-only and the lap time is a number, so both are safe as
// path segments; the trackKey is slugged here. On-disk rather than in the DB
// for the same reason the results archive is: a few tens of KB of arrays per
// lap is a file, not a row.
//
// The SEASON leads the path because a lap only means something inside one. The
// league runs different cars every season, so a Red Bull Ring time from last
// season and one from this season are not two attempts at the same problem —
// they are two different cars, and putting them in one list would invite a
// comparison that says nothing. Each season starts empty, and the season is
// decided HERE, on arrival: the game knows nothing about the league's
// calendar, so the site stamps the active season on a lap as it lands.
//
// The lap TIME is the file name, which makes the three questions this store
// has to answer cheap: what is a driver's best (first name in a sorted list),
// is a new lap worth keeping (compare against the third), and which one has to
// go (the last). It also makes a re-posted identical time overwrite itself
// rather than accumulate.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, statSync } from "fs";
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

// How many seasons of laps are kept. One: the season being raced.
//
// The league asked for the old ones to go when a new season starts, and the
// reason the seasons are separate in the first place is the reason they are
// not worth keeping — the cars change, so last season's times are not
// something anybody is chasing. Raise this to 2 and the season before stays as
// well; nothing else has to change.
export const KEEP_SEASONS = 1;

const LAP_ID_RE = /^\d{4,8}$/; // a lap time in ms: 20s to 30min, the bounds above
export const isLapId = (s) => LAP_ID_RE.test(String(s || ""));

// A season's folder. Season 0 is "we could not tell" — a lap that arrived while
// the site had no active season to name. It is a bucket, not a season, and it
// keeps such laps out of a real one rather than throwing them away.
export const seasonKeyOf = (season) => `s${Number.isFinite(Number(season)) && Number(season) > 0 ? Number(season) : 0}`;

function seasonDir(season) {
  return join(TELEMETRY_LAPS_DIR, seasonKeyOf(season));
}

function driverDir(season, trackKey, steamId) {
  return join(seasonDir(season), trackKey, steamId);
}

function fileFor(season, trackKey, steamId, lapTimeMs) {
  return join(driverDir(season, trackKey, steamId), `${lapTimeMs}.json`);
}

// Laps recorded before the store had seasons in it, in either of the two
// shapes it has had: one file per driver, and one folder per driver. Both sat
// directly under the track, with no season above them.
//
// They can only have been driven in the season running now — the feature has
// never been switched on for longer than that — so they are read as part of it
// and never written again. `season` is compared against the active one by the
// caller; this just says where the old files are.
function legacyDirFor(trackKey, steamId) {
  return join(TELEMETRY_LAPS_DIR, trackKey, steamId);
}

function legacyFileFor(trackKey, steamId) {
  return join(TELEMETRY_LAPS_DIR, trackKey, `${steamId}.json`);
}

// One driver's stored laps at one track in one season, fastest first:
// { lapTimeMs, path }. Reads the file NAMES only — the arrays inside stay on
// disk until somebody opens a comparison.
//
// `legacy` pulls in the pre-season files as well. The caller passes it only
// when the season asked for is the one running now (see activeLegacy below),
// because that is the only season those laps can belong to.
export function lapFilesOf(season, trackKey, steamId, legacy = false) {
  if (!isTrackKey(trackKey) || !isSteamId(steamId)) return [];
  const out = [];
  const add = (dir) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const ms = Number(f.replace(/\.json$/, ""));
      if (!f.endsWith(".json") || !Number.isFinite(ms)) continue;
      // The same time from an older shape is the same lap; keep one.
      if (!out.some((x) => x.lapTimeMs === ms)) out.push({ lapTimeMs: ms, path: join(dir, f) });
    }
  };
  add(driverDir(season, trackKey, steamId));
  if (legacy) {
    add(legacyDirFor(trackKey, steamId));
    const one = legacyFileFor(trackKey, steamId);
    if (existsSync(one)) {
      try {
        const ms = Number(JSON.parse(readFileSync(one, "utf8")).lapTimeMs);
        if (Number.isFinite(ms) && !out.some((x) => x.lapTimeMs === ms)) out.push({ lapTimeMs: ms, path: one });
      } catch {
        /* unreadable: it simply does not exist as far as this goes */
      }
    }
  }
  return out.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
}

// One stored lap, channels and all. `lapId` is the lap time in milliseconds;
// without one, the driver's fastest in that season.
export function readLap(season, trackKey, steamId, lapId = null, legacy = false) {
  if (!isTrackKey(trackKey) || !isSteamId(steamId)) return null;
  const files = lapFilesOf(season, trackKey, steamId, legacy);
  if (!files.length) return null;
  const want = lapId == null ? files[0] : files.find((f) => String(f.lapTimeMs) === String(lapId));
  if (!want) return null;
  try {
    return JSON.parse(readFileSync(want.path, "utf8"));
  } catch {
    return null;
  }
}

// Keep the lap if it belongs in this driver's fastest three at this track THIS
// SEASON, and drop whatever it pushed out. `lap.season` is stamped by the
// ingest; a lap without one lands in the season-0 bucket rather than in
// somebody's real season.
//
// Legacy files count towards the three here: they are this season's laps in an
// older shape, and ignoring them would let a driver keep six.
export function keepIfFaster(lap) {
  const season = lap.season;
  const files = lapFilesOf(season, lap.trackKey, lap.steamId, true);
  const best = files.length ? files[0].lapTimeMs : null;

  if (files.some((f) => f.lapTimeMs === lap.lapTimeMs)) {
    return { kept: false, bestMs: best, stored: files.length };
  }
  if (files.length >= KEEP_PER_DRIVER && lap.lapTimeMs >= files[KEEP_PER_DRIVER - 1].lapTimeMs) {
    return { kept: false, bestMs: best, stored: files.length };
  }

  mkdirSync(driverDir(season, lap.trackKey, lap.steamId), { recursive: true });
  writeFileSync(fileFor(season, lap.trackKey, lap.steamId, lap.lapTimeMs), JSON.stringify(lap));

  for (const extra of lapFilesOf(season, lap.trackKey, lap.steamId, true).slice(KEEP_PER_DRIVER)) {
    try {
      unlinkSync(extra.path);
    } catch {
      /* it will be pruned on the next post */
    }
  }
  return {
    kept: true,
    bestMs: Math.min(lap.lapTimeMs, best ?? lap.lapTimeMs),
    stored: Math.min(files.length + 1, KEEP_PER_DRIVER),
  };
}

// Remove one lap, or every lap this driver has at this track this season.
export function deleteLap(season, trackKey, steamId, lapId = null) {
  if (!isTrackKey(trackKey) || !isSteamId(steamId)) return false;
  const files = lapFilesOf(season, trackKey, steamId, true);
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

// Throw away the seasons nobody is racing any more.
//
// Triggered by the first lap of a new season arriving (routes/telemetryLaps.js)
// rather than by a clock or a button: that is the exact moment the old ones
// stop being current, and it needs nobody to remember to press anything.
//
// The season-0 bucket is left alone. Those are laps that arrived while the site
// could not name a season, so there is no number to compare them against, and
// throwing away data we cannot place is worse than keeping a few files.
//
// Returns the season numbers it removed, so the caller can say so in the log —
// a silent deletion is a thing nobody can debug afterwards.
export function pruneSeasonsBefore(season) {
  const keepFrom = Number(season) - (KEEP_SEASONS - 1);
  if (!Number.isFinite(keepFrom) || keepFrom <= 0) return [];
  if (!existsSync(TELEMETRY_LAPS_DIR)) return [];
  const gone = [];
  for (const name of readdirSync(TELEMETRY_LAPS_DIR)) {
    const m = /^s(\d+)$/.exec(name);
    const n = m ? Number(m[1]) : null;
    // s0 is the "could not tell" bucket, never pruned by number.
    if (!n || n >= keepFrom) continue;
    try {
      rmSync(join(TELEMETRY_LAPS_DIR, name), { recursive: true, force: true });
      gone.push(n);
    } catch {
      /* left for the next new season to try again */
    }
  }
  return gone.sort((a, b) => a - b);
}

// All tracks in one season that have at least one lap, with a light summary
// each. `legacy` folds in the pre-season files, and is passed only for the
// season running now.
export function listTracks(season, legacy = false) {
  const dirs = [seasonDir(season)];
  // The old shape put track folders directly under the root. Read alongside,
  // and merged below, so a track that exists in both appears once.
  if (legacy && existsSync(TELEMETRY_LAPS_DIR)) dirs.push(TELEMETRY_LAPS_DIR);
  const byTrack = new Map();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const dirName of readdirSync(dir)) {
      // Season folders live at the root next to the old track folders; they are
      // not tracks.
      if (!isTrackKey(dirName) || /^s\d+$/.test(dirName)) continue;
      const laps = listLaps(season, dirName, legacy);
      if (!laps.length || byTrack.has(dirName)) continue;
      byTrack.set(dirName, {
        trackKey: dirName,
        track: laps[0].track,
        layout: laps[0].layout,
        laps: laps.length,
        bestMs: laps[0].lapTimeMs,
      });
    }
  }
  return [...byTrack.values()].sort((a, b) => a.trackKey.localeCompare(b.trackKey));
}

// Every stored lap of one track in one season — metadata only, channels stay on
// disk until somebody actually opens a comparison. Fastest first, and every
// entry carries a `lapId` because a driver has up to three: it is the lap time
// in milliseconds, unique per driver per track per season by construction.
export function listLaps(season, trackKey, legacy = false) {
  if (!isTrackKey(trackKey)) return [];
  const out = [];
  const seen = new Set(); // steamId:lapTimeMs, so an old shape cannot double up
  const read = (path, lapId) => {
    try {
      const lap = JSON.parse(readFileSync(path, "utf8"));
      const key = `${lap.steamId}:${lap.lapTimeMs}`;
      if (seen.has(key)) return;
      seen.add(key);
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

  // Everybody who has a folder here, in this season and (when asked) in the
  // shapes that predate seasons.
  const drivers = new Set();
  for (const dir of [join(seasonDir(season), trackKey), ...(legacy ? [join(TELEMETRY_LAPS_DIR, trackKey)] : [])]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && isSteamId(entry.name)) drivers.add(entry.name);
      else if (legacy && entry.isFile() && entry.name.endsWith(".json")) {
        const steamId = entry.name.replace(/\.json$/, "");
        if (isSteamId(steamId)) drivers.add(steamId);
      }
    }
  }
  for (const steamId of drivers) {
    for (const f of lapFilesOf(season, trackKey, steamId, legacy)) read(f.path, f.lapTimeMs);
  }
  return out.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
}

// How much is on disk, and when the newest of it landed — the half of the
// ingest diagnostic that survives a restart (lib/telemetryIngestLog.js holds
// the other half, and only for as long as the process lives).
//
// Deliberately does NOT read the files. A lap is tens of KB of channel arrays
// and none of it is needed to answer "how many, and how recent": the count is
// the number of file names and the arrival time is the file's own mtime, which
// is exactly when the ingest wrote it. listLaps parses every lap it touches,
// which is the right trade for a comparison and the wrong one for a panel that
// polls.
export function storedSummary(season, legacy = false) {
  let laps = 0;
  let newest = 0;
  const walkTrack = (trackDir) => {
    if (!existsSync(trackDir)) return;
    for (const entry of readdirSync(trackDir, { withFileTypes: true })) {
      // A driver folder of laps, or — in the shape that predates seasons — one
      // lap sitting directly under the track.
      const paths = entry.isDirectory()
        ? readdirSync(join(trackDir, entry.name))
            .filter((f) => f.endsWith(".json"))
            .map((f) => join(trackDir, entry.name, f))
        : entry.name.endsWith(".json")
          ? [join(trackDir, entry.name)]
          : [];
      for (const p of paths) {
        try {
          newest = Math.max(newest, statSync(p).mtimeMs);
          laps += 1;
        } catch {
          /* a file that vanished between the listing and the stat is not a lap */
        }
      }
    }
  };
  const roots = [seasonDir(season), ...(legacy ? [TELEMETRY_LAPS_DIR] : [])];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      // Season folders sit at the root next to the pre-season track folders.
      if (!isTrackKey(name) || /^s\d+$/.test(name)) continue;
      walkTrack(join(root, name));
    }
  }
  return { laps, newestAt: newest ? new Date(newest).toISOString() : null };
}
