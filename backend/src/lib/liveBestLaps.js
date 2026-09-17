// ---------------------------------------------------------------------------
// Training best laps, carried onto the live board.
//
// The race server's live timing knows exactly one thing: the session it is in
// right now. A practice session that hits its time limit and restarts, a server
// reboot, a deploy — and "Session Best Times" is empty again. Between two race
// weekends that session is the whole week of training, and it was being thrown
// away every few hours.
//
// Two places still have the times, and this carries either or both onto the
// board, per track, per race server:
//
//   FILES     The server manager writes a result JSON for every session it
//             runs, practice included, with every lap and the server's own
//             sector splits in it (lib/practiceJson.js). An admin hands the
//             site those files, and their fastest clean lap per driver is kept
//             here — sectors and all, drawn on the board exactly as a live
//             lap's are. This is the source the league asked for.
//
//   RECORDER  The in-game recorder (lib/telemetryLaps.js) is served to every
//             driver who joins, so the telemetry store holds each driver's
//             fastest laps too. It knows the time and the top speed but not
//             the sector lines. Switching it on for a track is one line here
//             saying which series' season to read; the laps are re-read as the
//             board is built, so a quicker lap posted later reaches the board
//             by itself.
//
// Per driver the faster lap wins whichever source it came from, and on the
// board itself a live lap beats either the moment it is quicker (services/
// liveTiming.js). A tie between the two sources goes to the file: it has the
// sectors.
//
// Why per SERVER and not per series: the board is built once per race server
// and broadcast to everyone watching it, whatever series they came in through.
// Where the laps are SHOWN is a server; a series only decides which recorder
// store is read.
//
// Files under DATA_DIR/live-best-laps/<serverKey>/<trackKey>.json, one per
// track: the recorder switch, the laps kept from uploaded files, and a line
// per file so the admin card can say what it has been given.
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

// How many uploaded files a track remembers by name. The laps kept from them
// are one row per driver regardless; this is only the list on the admin card.
const FILES_MAX = 50;

function fileFor(serverKey, trackKey) {
  return join(LIVE_BEST_LAPS_DIR, serverKey, `${trackKey}.json`);
}

// Two memos, invalidated by the writes below: the track's file (which changes
// when an admin does something) and the recorder's laps read through it
// (which change on their own, hence the TTL).
const trackCache = new Map(); // `${serverKey}/${trackKey}` -> track record | null
const recorderCache = new Map(); // same key -> { at, laps }

function cacheKey(serverKey, trackKey) {
  return `${serverKey}/${trackKey}`;
}

function forget(serverKey, trackKey) {
  trackCache.delete(cacheKey(serverKey, trackKey));
  recorderCache.delete(cacheKey(serverKey, trackKey));
}

function validKeys(serverKey, trackKey) {
  return SERVER_KEY_RE.test(String(serverKey || "")) && isTrackKey(String(trackKey || ""));
}

// One lap on its way to the board, or null if it is not one. Written
// defensively because what arrives here was read off disk or out of a file
// somebody uploaded: neither is under this code's control.
function cleanLap(raw, from) {
  if (!raw || typeof raw !== "object") return null;
  const steamId = String(raw.steamId || "");
  if (!STEAM_RE.test(steamId)) return null;
  const lapTimeMs = Math.round(Number(raw.lapTimeMs));
  if (!Number.isFinite(lapTimeMs) || lapTimeMs < MIN_LAP_MS || lapTimeMs > MAX_LAP_MS) return null;
  const name = String(raw.name || "").trim().slice(0, 64);
  if (!name) return null;
  const top = Number(raw.topSpeedKmh);
  // Three positive splits that add up to the lap, or none. Checked again here
  // even though practiceJson.js checked on the way in: this is the last stop
  // before a number is printed beside a driver's name.
  let sectorsMs = null;
  if (Array.isArray(raw.sectorsMs) && raw.sectorsMs.length === 3) {
    const s = raw.sectorsMs.map((v) => Math.round(Number(v)));
    if (s.every((v) => Number.isFinite(v) && v > 0) && Math.abs(s[0] + s[1] + s[2] - lapTimeMs) <= 3) sectorsMs = s;
  }
  return {
    steamId,
    name,
    car: String(raw.car || "").trim().slice(0, 80),
    lapTimeMs,
    sectorsMs,
    // Same sanity band as the recorder's own speed channel (0..500 km/h).
    topSpeedKmh: Number.isFinite(top) && top > 0 && top <= 500 ? top : null,
    recordedAt: raw.recordedAt ? String(raw.recordedAt).slice(0, 40) : null,
    from,
  };
}

// A track's record as stored, or null. Reads the shape before files were part
// of it (v2: the recorder switch at the top level) as a record with that
// switch and no laps. Never throws — a broken file is no record, not an
// outage; the board goes back to being the session it was.
function readTrack(serverKey, trackKey) {
  if (!validKeys(serverKey, trackKey)) return null;
  const key = cacheKey(serverKey, trackKey);
  if (trackCache.has(key)) return trackCache.get(key);

  let rec = null;
  try {
    const path = fileFor(serverKey, trackKey);
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const src = raw?.source ?? (raw?.series ? raw : null);
      const series = String(src?.series || "");
      const season = Number(src?.season) || 0;
      const source =
        series && season > 0
          ? {
              series,
              season,
              legacy: !!src.legacy,
              addedAt: src.addedAt ? String(src.addedAt) : null,
            }
          : null;
      const laps = (Array.isArray(raw?.laps) ? raw.laps : []).map((l) => cleanLap(l, "file")).filter(Boolean);
      const files = (Array.isArray(raw?.files) ? raw.files : [])
        .map((f) => ({
          name: String(f?.name || "").slice(0, 120),
          type: String(f?.type || "").slice(0, 20),
          date: f?.date ? String(f.date).slice(0, 40) : null,
          uploadedAt: f?.uploadedAt ? String(f.uploadedAt) : null,
          laps: Number(f?.laps) || 0,
        }))
        .filter((f) => f.name);
      rec = {
        trackKey,
        track: String(raw?.track || src?.track || ""),
        layout: String(raw?.layout || src?.layout || ""),
        source,
        laps: onePerDriver(laps),
        files,
      };
      if (!rec.source && !rec.laps.length) rec = null;
    }
  } catch {
    rec = null;
  }
  trackCache.set(key, rec);
  return rec;
}

function writeTrack(serverKey, trackKey, rec) {
  const payload = {
    v: 3,
    trackKey,
    track: rec.track || "",
    layout: rec.layout || "",
    source: rec.source,
    laps: rec.laps,
    files: rec.files.slice(-FILES_MAX),
  };
  mkdirSync(join(LIVE_BEST_LAPS_DIR, serverKey), { recursive: true });
  writeFileSync(fileFor(serverKey, trackKey), JSON.stringify(payload));
  forget(serverKey, trackKey);
  return payload;
}

// Fastest first, one row per driver. Where two sources have the same time to
// the millisecond it is the same lap, and the one with sectors is kept.
function onePerDriver(laps) {
  const byDriver = new Map();
  for (const lap of laps) {
    const seen = byDriver.get(lap.steamId);
    if (!seen || lap.lapTimeMs < seen.lapTimeMs || (lap.lapTimeMs === seen.lapTimeMs && lap.sectorsMs && !seen.sectorsMs)) {
      byDriver.set(lap.steamId, lap);
    }
  }
  return [...byDriver.values()].sort((a, b) => a.lapTimeMs - b.lapTimeMs);
}

// Which telemetry store one track's board reads from, or null when the
// recorder is not switched on for it.
export function readSource(serverKey, trackKey) {
  return readTrack(serverKey, trackKey)?.source ?? null;
}

// The laps kept from uploaded files for one track, fastest first.
export function uploadedLaps(serverKey, trackKey) {
  return readTrack(serverKey, trackKey)?.laps ?? [];
}

// What the recorder's store currently has for this track, through the switch
// — memoised for BESTS_TTL_MS, because the board asks several times a second.
function recorderBests(serverKey, trackKey, source) {
  const key = cacheKey(serverKey, trackKey);
  const memo = recorderCache.get(key);
  if (memo && Date.now() - memo.at < BESTS_TTL_MS) return memo.laps;
  let laps = [];
  try {
    laps = bestLapPerDriver(source.series, source.season, trackKey, source.legacy)
      .map((l) => cleanLap(l, "recorder"))
      .filter(Boolean);
  } catch {
    laps = [];
  }
  recorderCache.set(key, { at: Date.now(), laps });
  return laps;
}

// The training bests one track's board is carrying right now, fastest first,
// one row per driver across both sources. Empty when that track carries
// nothing. This is the call the live relay makes, so it is the one that has
// to be cheap: the file record is memoised until something writes it, the
// recorder read for half a minute, and merging a few dozen rows is nothing.
export function currentBests(serverKey, trackKey) {
  const rec = readTrack(serverKey, trackKey);
  if (!rec) return [];
  const fromRecorder = rec.source ? recorderBests(serverKey, trackKey, rec.source) : [];
  return onePerDriver([...rec.laps, ...fromRecorder]);
}

// Keep the laps of one uploaded session file for a track. What is kept is the
// fastest per driver across everything this track has been given so far — a
// second file for the same evening adds the drivers it has and improves the
// times it beats, and never takes a time away.
export function addUploadedLaps(serverKey, trackKey, { track, layout, laps, file }) {
  if (!SERVER_KEY_RE.test(String(serverKey || ""))) throw new Error("Bad server key");
  if (!isTrackKey(String(trackKey || ""))) throw new Error("Bad track key");
  const rec = readTrack(serverKey, trackKey) || { trackKey, track: "", layout: "", source: null, laps: [], files: [] };
  const incoming = (Array.isArray(laps) ? laps : []).map((l) => cleanLap(l, "file")).filter(Boolean);
  const before = new Map(rec.laps.map((l) => [l.steamId, l.lapTimeMs]));
  const merged = onePerDriver([...rec.laps, ...incoming]);
  const improved = merged.filter((l) => before.get(l.steamId) == null || l.lapTimeMs < before.get(l.steamId)).length;
  const written = writeTrack(serverKey, trackKey, {
    track: track || rec.track,
    layout: layout ?? rec.layout,
    source: rec.source,
    laps: merged,
    files: [
      ...rec.files,
      {
        name: String(file?.name || "").slice(0, 120),
        type: String(file?.type || "").slice(0, 20),
        date: file?.date ? String(file.date).slice(0, 40) : null,
        uploadedAt: new Date().toISOString(),
        laps: incoming.length,
      },
    ],
  });
  return { kept: written.laps.length, read: incoming.length, improved };
}

// Switch the recorder on for one track on one server's board. Idempotent:
// pressing the button again re-points the same line, which is how a board
// moves to a new season. Leaves uploaded laps exactly as they are.
export function addSource(serverKey, trackKey, { series, season, track, layout, legacy = false }) {
  if (!SERVER_KEY_RE.test(String(serverKey || ""))) throw new Error("Bad server key");
  if (!isTrackKey(String(trackKey || ""))) throw new Error("Bad track key");
  const cleanSeries = String(series || "");
  const cleanSeason = Number(season) || 0;
  if (!cleanSeries || cleanSeason <= 0) throw new Error("A series and a season are required");

  const rec = readTrack(serverKey, trackKey) || { trackKey, track: "", layout: "", source: null, laps: [], files: [] };
  const source = { series: cleanSeries, season: cleanSeason, legacy: !!legacy, addedAt: new Date().toISOString() };
  writeTrack(serverKey, trackKey, {
    track: track || rec.track,
    layout: layout ?? rec.layout,
    source,
    laps: rec.laps,
    files: rec.files,
  });
  return source;
}

// Take one track off the board entirely — the recorder switch and every lap
// kept from a file. The board goes back to showing the session the server is
// in and nothing else.
export function clearTrack(serverKey, trackKey) {
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

// Every track this server carries training times for, newest change first —
// the admin card's "what is on the board" list. It counts what the board is
// carrying, so it reads it: an admin opening the card is exactly the moment to
// be accurate rather than cheap.
export function listTracks(serverKey) {
  if (!SERVER_KEY_RE.test(String(serverKey || ""))) return [];
  const dir = join(LIVE_BEST_LAPS_DIR, serverKey);
  if (!existsSync(dir)) return [];
  const out = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const trackKey = name.slice(0, -5);
      const rec = readTrack(serverKey, trackKey);
      if (!rec) continue;
      const laps = currentBests(serverKey, trackKey);
      const stamps = [rec.source?.addedAt, ...rec.files.map((f) => f.uploadedAt)].filter(Boolean).sort();
      out.push({
        trackKey,
        track: rec.track,
        layout: rec.layout,
        recorder: rec.source ? { series: rec.source.series, season: rec.source.season } : null,
        files: rec.files.length,
        fileLaps: rec.laps.length,
        laps: laps.length,
        bestMs: laps[0]?.lapTimeMs ?? null,
        changedAt: stamps[stamps.length - 1] || null,
      });
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => String(b.changedAt || "").localeCompare(String(a.changedAt || "")));
}

// The files one track has been given, for the admin card.
export function uploadedFiles(serverKey, trackKey) {
  return readTrack(serverKey, trackKey)?.files ?? [];
}

// What pressing the recorder button does to one driver's row, for the admin
// card's preview. It has to answer the same question the board's merge answers
// (faster wins, per driver) or the preview would promise something else than
// the board then shows.
//
//   new     nothing about this driver is on the board yet
//   faster  their telemetry best beats what the board shows — it takes the row
//   same    the board already shows exactly this time; nothing changes
//   slower  the board shows a quicker lap already; that one stays
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
  trackCache.clear();
  recorderCache.clear();
}
