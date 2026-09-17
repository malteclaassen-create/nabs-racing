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
// So this is an OVERLAY, written by an admin pressing a button (routes/admin
// .js) and read by the live relay on every board it builds: a set of best laps
// for one track on one race server. The relay merges it in — a driver on the
// board whose imported lap is faster keeps the imported time, a driver who is
// not connected at all appears as a row with their time and nothing else.
//
// Why per SERVER and not per series: the board is built once per race server
// and broadcast to everyone watching it, whatever series they came in through.
// The series decides which telemetry store the times are READ from (the admin
// picks it on import); where they are SHOWN is a server. The two are the same
// thing in practice — each league races on its own server — but only one of
// them is a property of the board.
//
// Files under DATA_DIR/live-best-laps/<serverKey>/<trackKey>.json, one per
// track, small enough to rewrite whole: a few dozen rows of name, car and a
// number. An import replaces its file — it is a snapshot of the telemetry
// store at the moment the admin pressed the button, not an accumulation.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { LIVE_BEST_LAPS_DIR } from "./dataDirs.js";
import { isTrackKey } from "./telemetryLaps.js";

// Same bar as the telemetry store, for the same reason: a number outside this
// is not a lap time and has no business reaching the board.
const MAX_LAP_MS = 1_800_000;
const MIN_LAP_MS = 20_000;

const SERVER_KEY_RE = /^[a-z0-9_-]{1,32}$/;
const STEAM_RE = /^\d{10,20}$/;

function fileFor(serverKey, trackKey) {
  return join(LIVE_BEST_LAPS_DIR, serverKey, `${trackKey}.json`);
}

// The board is rebuilt several times a second, and every one of those would
// otherwise be a stat() and a parse. The cache is invalidated by the writes
// below rather than by mtime: one process owns this file, and it is this one.
const cache = new Map(); // `${serverKey}/${trackKey}` -> parsed file | null

function cacheKey(serverKey, trackKey) {
  return `${serverKey}/${trackKey}`;
}

// One imported lap, or null if it is not one. Written defensively because the
// file on disk outlives the code that wrote it: a store from an older shape,
// a half-written file after a crash, a hand-edited row.
function cleanLap(raw) {
  if (!raw || typeof raw !== "object") return null;
  const steamId = String(raw.steamId || "");
  if (!STEAM_RE.test(steamId)) return null;
  const lapTimeMs = Math.round(Number(raw.lapTimeMs));
  if (!Number.isFinite(lapTimeMs) || lapTimeMs < MIN_LAP_MS || lapTimeMs > MAX_LAP_MS) return null;
  const name = String(raw.name || "").trim().slice(0, 64);
  if (!name) return null;
  return {
    steamId,
    name,
    car: String(raw.car || "").trim().slice(0, 80),
    lapTimeMs,
    recordedAt: raw.recordedAt ? String(raw.recordedAt).slice(0, 40) : null,
  };
}

// What has been imported for one track on one server, or null. Never throws:
// an unreadable overlay must cost the board nothing — it goes back to being
// the session it was before this file existed.
export function readImport(serverKey, trackKey) {
  if (!SERVER_KEY_RE.test(String(serverKey || "")) || !isTrackKey(String(trackKey || ""))) return null;
  const key = cacheKey(serverKey, trackKey);
  if (cache.has(key)) return cache.get(key);

  let parsed = null;
  try {
    const path = fileFor(serverKey, trackKey);
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const laps = (Array.isArray(raw?.laps) ? raw.laps : []).map(cleanLap).filter(Boolean);
      // Fastest first, one row per driver — the file should already be both,
      // but a board that trusts its input is a board that shows a driver twice.
      const byDriver = new Map();
      for (const lap of laps.sort((a, b) => a.lapTimeMs - b.lapTimeMs)) {
        if (!byDriver.has(lap.steamId)) byDriver.set(lap.steamId, lap);
      }
      parsed = byDriver.size
        ? {
            trackKey,
            track: String(raw.track || ""),
            layout: String(raw.layout || ""),
            series: String(raw.series || ""),
            season: Number(raw.season) || null,
            importedAt: raw.importedAt ? String(raw.importedAt) : null,
            laps: [...byDriver.values()],
          }
        : null;
    }
  } catch {
    parsed = null; // see above: a broken overlay is no overlay, not an outage
  }
  cache.set(key, parsed);
  return parsed;
}

// Replace one track's overlay. Returns what was actually stored, so the caller
// reports the rows that survived cleaning rather than the rows it offered.
export function writeImport(serverKey, trackKey, { track, layout, series, season, laps }) {
  if (!SERVER_KEY_RE.test(String(serverKey || ""))) throw new Error("Bad server key");
  if (!isTrackKey(String(trackKey || ""))) throw new Error("Bad track key");

  const byDriver = new Map();
  for (const lap of (Array.isArray(laps) ? laps : []).map(cleanLap).filter(Boolean)) {
    const seen = byDriver.get(lap.steamId);
    if (!seen || lap.lapTimeMs < seen.lapTimeMs) byDriver.set(lap.steamId, lap);
  }
  const clean = [...byDriver.values()].sort((a, b) => a.lapTimeMs - b.lapTimeMs);

  // Nothing to carry is not an empty file: it is no overlay at all, which is
  // also what an admin clearing a track expects to be left with.
  if (!clean.length) {
    clearImport(serverKey, trackKey);
    return { trackKey, laps: [] };
  }

  const payload = {
    v: 1,
    trackKey,
    track: String(track || ""),
    layout: String(layout || ""),
    series: String(series || ""),
    season: Number(season) || null,
    importedAt: new Date().toISOString(),
    laps: clean,
  };
  mkdirSync(join(LIVE_BEST_LAPS_DIR, serverKey), { recursive: true });
  writeFileSync(fileFor(serverKey, trackKey), JSON.stringify(payload));
  cache.set(cacheKey(serverKey, trackKey), { ...payload, season: payload.season });
  return payload;
}

// Take one track's overlay off the board again. The board goes back to showing
// the session and nothing else, which is what it did before any of this.
export function clearImport(serverKey, trackKey) {
  if (!SERVER_KEY_RE.test(String(serverKey || "")) || !isTrackKey(String(trackKey || ""))) return false;
  let removed = false;
  try {
    const path = fileFor(serverKey, trackKey);
    if (existsSync(path)) {
      unlinkSync(path);
      removed = true;
    }
  } catch {
    /* it stays until the next attempt; the cache below still lets go of it */
  }
  cache.set(cacheKey(serverKey, trackKey), null);
  return removed;
}

// Every track this server carries an overlay for, newest import first — the
// admin card's "what is currently on the board" list.
export function listImports(serverKey) {
  if (!SERVER_KEY_RE.test(String(serverKey || ""))) return [];
  const dir = join(LIVE_BEST_LAPS_DIR, serverKey);
  if (!existsSync(dir)) return [];
  const out = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const trackKey = name.slice(0, -5);
      const stored = readImport(serverKey, trackKey);
      if (!stored) continue;
      out.push({
        trackKey,
        track: stored.track,
        layout: stored.layout,
        series: stored.series,
        season: stored.season,
        importedAt: stored.importedAt,
        laps: stored.laps.length,
        bestMs: stored.laps[0]?.lapTimeMs ?? null,
      });
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => String(b.importedAt || "").localeCompare(String(a.importedAt || "")));
}

// What pressing the import button does to one driver's row, for the admin
// card's preview. It has to answer the same question the board's merge answers
// (faster wins, per driver) or the preview would promise something else than
// the board then shows.
//
//   new     nothing about this driver is on the board yet
//   faster  their telemetry best beats what the board shows — it takes the row
//   same    the board already shows exactly this time; nothing changes
//   slower  they have gone quicker on the server since; the live lap stays
//
// `liveMs` is a lap the driver set in the session on screen, `importedMs` one
// an earlier import already carried over. The board shows whichever of the two
// is quicker, so that is what this compares against.
export function importEffect(telemetryMs, { liveMs = null, importedMs = null } = {}) {
  const candidates = [liveMs, importedMs].filter((ms) => Number.isFinite(ms) && ms > 0);
  const shown = candidates.length ? Math.min(...candidates) : null;
  if (shown == null) return "new";
  if (shown === telemetryMs) return "same";
  return shown < telemetryMs ? "slower" : "faster";
}

// Tests drive the store through the filesystem, so they need the memo cleared
// between cases; nothing in the running server calls this.
export function __clearCache() {
  cache.clear();
}
