// ---------------------------------------------------------------------------
// Training best laps, carried onto the live board.
//
// The race server's live timing knows exactly one thing: the session it is in
// right now. A practice session that hits its time limit and restarts, a server
// reboot, a deploy — and "Session Best Times" is empty again. Between two race
// weekends that session is the whole week of training, and it was being thrown
// away every few hours.
//
// The times themselves were never lost. The in-game recorder (lib/telemetry
// Laps.js) is served to every driver who joins, so the site already has the
// fastest laps of everyone who has been out there, per series, per season, per
// track, on disk. What was missing was a way to put them back on the board.
//
// WHAT IS STORED HERE IS NOT THE LAPS. It is one line per track saying "this
// board carries the training times of that series' season". The laps themselves
// are read back out of the telemetry store every time the board is built, which
// is the whole point: a driver who goes quicker on the practice server on
// Thursday is quicker on the board on Thursday, without anybody pressing
// anything again. A frozen copy would have gone stale the moment it was taken —
// the next session restart would have put the older time back on the board and
// left it there until an admin noticed.
//
// The relay merges what this hands over, faster-wins per driver, so an imported
// lap behaves exactly like one set in the session on screen: a quicker live lap
// takes the row the moment it is set, and the training time comes back by
// itself when the session resets under it.
//
// Why per SERVER and not per series: the board is built once per race server
// and broadcast to everyone watching it, whatever series they came in through.
// The series decides which telemetry store the times are read FROM; where they
// are SHOWN is a server. The two are the same thing in practice — each league
// races on its own server — but only one of them is a property of the board.
//
// Files under DATA_DIR/live-best-laps/<serverKey>/<trackKey>.json, one per
// track, each a handful of fields.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { LIVE_BEST_LAPS_DIR } from "./dataDirs.js";
import { isTrackKey, bestLapPerDriver } from "./telemetryLaps.js";

// Same bar as the telemetry store, for the same reason: a number outside this
// is not a lap time and has no business reaching the board.
const MAX_LAP_MS = 1_800_000;
const MIN_LAP_MS = 20_000;

const SERVER_KEY_RE = /^[a-z0-9_-]{1,32}$/;
const STEAM_RE = /^\d{10,20}$/;

// How long a read of the telemetry store is reused. The board is rebuilt
// several times a second and the store changes at the pace of somebody
// finishing a lap, so this is the difference between a directory scan per
// frame and one every half minute. It is also the longest a new personal best
// can take to reach a board that is not currently showing the driver who set
// it — on a board that IS showing them, their live lap is already there and
// this changes nothing.
const BESTS_TTL_MS = 30_000;

function fileFor(serverKey, trackKey) {
  return join(LIVE_BEST_LAPS_DIR, serverKey, `${trackKey}.json`);
}

// Two memos, invalidated by the writes below: the source line (which changes
// when an admin presses a button) and the laps read through it (which change
// on their own, hence the TTL).
const sourceCache = new Map(); // `${serverKey}/${trackKey}` -> source | null
const bestsCache = new Map(); // same key -> { at, laps }

function cacheKey(serverKey, trackKey) {
  return `${serverKey}/${trackKey}`;
}

function forget(serverKey, trackKey) {
  sourceCache.delete(cacheKey(serverKey, trackKey));
  bestsCache.delete(cacheKey(serverKey, trackKey));
}

function validKeys(serverKey, trackKey) {
  return SERVER_KEY_RE.test(String(serverKey || "")) && isTrackKey(String(trackKey || ""));
}

// One lap on its way to the board, or null if it is not one. Written
// defensively because what arrives here was read off disk: the store outlives
// the code that wrote it.
function cleanLap(raw) {
  if (!raw || typeof raw !== "object") return null;
  const steamId = String(raw.steamId || "");
  if (!STEAM_RE.test(steamId)) return null;
  const lapTimeMs = Math.round(Number(raw.lapTimeMs));
  if (!Number.isFinite(lapTimeMs) || lapTimeMs < MIN_LAP_MS || lapTimeMs > MAX_LAP_MS) return null;
  const name = String(raw.name || "").trim().slice(0, 64);
  if (!name) return null;
  const top = Number(raw.topSpeedKmh);
  return {
    steamId,
    name,
    car: String(raw.car || "").trim().slice(0, 80),
    lapTimeMs,
    recordedAt: raw.recordedAt ? String(raw.recordedAt).slice(0, 40) : null,
    // Same sanity band as the recorder's own speed channel (0..500 km/h).
    topSpeedKmh: Number.isFinite(top) && top > 0 && top <= 500 ? top : null,
  };
}

// Which telemetry store one track's board reads from, or null when that track
// carries nothing. Never throws: an unreadable line must cost the board
// nothing — it goes back to being the session it was before this existed.
export function readSource(serverKey, trackKey) {
  if (!validKeys(serverKey, trackKey)) return null;
  const key = cacheKey(serverKey, trackKey);
  if (sourceCache.has(key)) return sourceCache.get(key);

  let source = null;
  try {
    const path = fileFor(serverKey, trackKey);
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const series = String(raw?.series || "");
      const season = Number(raw?.season) || 0;
      // Without both there is nothing to read from, and a line that names no
      // store is not a source — it is a file somebody should delete.
      if (series && season > 0) {
        source = {
          trackKey,
          series,
          season,
          legacy: !!raw.legacy,
          track: String(raw.track || ""),
          layout: String(raw.layout || ""),
          addedAt: raw.addedAt ? String(raw.addedAt) : null,
        };
      }
    }
  } catch {
    source = null; // see above: a broken line is no source, not an outage
  }
  sourceCache.set(key, source);
  return source;
}

// The training bests one track's board is carrying right now, fastest first.
// Empty when that track carries nothing.
//
// This is the call the live relay makes, so it is the one that has to be cheap:
// the TTL above decides how often it actually touches the disk, and
// bestLapPerDriver reads the times off file names rather than parsing laps.
export function currentBests(serverKey, trackKey) {
  const source = readSource(serverKey, trackKey);
  if (!source) return [];

  const key = cacheKey(serverKey, trackKey);
  const memo = bestsCache.get(key);
  if (memo && Date.now() - memo.at < BESTS_TTL_MS) return memo.laps;

  let laps = [];
  try {
    const byDriver = new Map();
    for (const lap of bestLapPerDriver(source.series, source.season, trackKey, source.legacy)) {
      const clean = cleanLap(lap);
      // bestLapPerDriver already answers one row per driver, fastest first;
      // the guard is here because the board is what pays for a wrong one.
      if (clean && !byDriver.has(clean.steamId)) byDriver.set(clean.steamId, clean);
    }
    laps = [...byDriver.values()].sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  } catch {
    laps = [];
  }
  bestsCache.set(key, { at: Date.now(), laps });
  return laps;
}

// Start carrying one track's training times on one server's board. Idempotent:
// pressing the button again re-points the same line, which is how a board moves
// to a new season.
export function addSource(serverKey, trackKey, { series, season, track, layout, legacy = false }) {
  if (!SERVER_KEY_RE.test(String(serverKey || ""))) throw new Error("Bad server key");
  if (!isTrackKey(String(trackKey || ""))) throw new Error("Bad track key");
  const cleanSeries = String(series || "");
  const cleanSeason = Number(season) || 0;
  if (!cleanSeries || cleanSeason <= 0) throw new Error("A series and a season are required");

  const payload = {
    v: 2,
    trackKey,
    series: cleanSeries,
    season: cleanSeason,
    legacy: !!legacy,
    track: String(track || ""),
    layout: String(layout || ""),
    addedAt: new Date().toISOString(),
  };
  mkdirSync(join(LIVE_BEST_LAPS_DIR, serverKey), { recursive: true });
  writeFileSync(fileFor(serverKey, trackKey), JSON.stringify(payload));
  forget(serverKey, trackKey);
  return payload;
}

// Take one track's training times back off the board. The board goes back to
// showing the session the server is in and nothing else.
export function clearSource(serverKey, trackKey) {
  if (!validKeys(serverKey, trackKey)) return false;
  let removed = false;
  try {
    const path = fileFor(serverKey, trackKey);
    if (existsSync(path)) {
      unlinkSync(path);
      removed = true;
    }
  } catch {
    /* it stays until the next attempt; the memos below still let go of it */
  }
  forget(serverKey, trackKey);
  return removed;
}

// Every track this server carries training times for, newest first — the admin
// card's "what is currently on the board" list. It counts the laps, so it reads
// them: an admin opening the card is exactly the moment to be accurate rather
// than cheap.
export function listSources(serverKey) {
  if (!SERVER_KEY_RE.test(String(serverKey || ""))) return [];
  const dir = join(LIVE_BEST_LAPS_DIR, serverKey);
  if (!existsSync(dir)) return [];
  const out = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const trackKey = name.slice(0, -5);
      const source = readSource(serverKey, trackKey);
      if (!source) continue;
      const laps = currentBests(serverKey, trackKey);
      out.push({
        trackKey,
        track: source.track,
        layout: source.layout,
        series: source.series,
        season: source.season,
        addedAt: source.addedAt,
        laps: laps.length,
        bestMs: laps[0]?.lapTimeMs ?? null,
      });
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || "")));
}

// What pressing the button does to one driver's row, for the admin card's
// preview. It has to answer the same question the board's merge answers
// (faster wins, per driver) or the preview would promise something else than
// the board then shows.
//
//   new     nothing about this driver is on the board yet
//   faster  their telemetry best beats what the board shows — it takes the row
//   same    the board already shows exactly this time; nothing changes
//   slower  they have gone quicker on the server since; the live lap stays
//
// `liveMs` is a lap the driver set in the session on screen, `importedMs` a
// training best the board is already carrying. The board shows whichever of
// the two is quicker, so that is what this compares against.
export function importEffect(telemetryMs, { liveMs = null, importedMs = null } = {}) {
  const candidates = [liveMs, importedMs].filter((ms) => Number.isFinite(ms) && ms > 0);
  const shown = candidates.length ? Math.min(...candidates) : null;
  if (shown == null) return "new";
  if (shown === telemetryMs) return "same";
  return shown < telemetryMs ? "slower" : "faster";
}

// Tests drive the store through the filesystem, so they need the memos cleared
// between cases; nothing in the running server calls this.
export function __clearCache() {
  sourceCache.clear();
  bestsCache.clear();
}
