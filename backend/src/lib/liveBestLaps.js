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
// board, per SERIES, per SEASON, per track:
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
//             the sector lines. Switching it on for a track is one flag here;
//             the laps are re-read as the board is built, so a quicker lap
//             posted later reaches the board by itself.
//
// Per driver the faster lap wins whichever source it came from, and on the
// board itself a live lap beats either the moment it is quicker (services/
// liveTiming.js). A tie between the two sources goes to the file: it has the
// sectors.
//
// THE SEASON IS PART OF THE KEY, and that is a rule, not a filing choice. The
// league runs different cars every season, so a Baku time from last season is
// not a time anybody is chasing this season — and it must never appear on the
// board when the calendar comes back round to Baku. Everything here is filed
// under the series and season it was given in, and the board reads only the
// ACTIVE season of the series that follow its race server (setBoardScopes,
// kept fresh by the relay). When the season moves on, last season's records
// stay on disk and stop being read; nobody has to delete anything.
//
// Why the board is asked by SERVER: it is built once per race server and
// broadcast to everyone watching it. Which series' season(s) that means is
// the assignment the admin manages (lib/liveServers.js), resolved by the relay
// and handed in here as the server's scopes.
//
// Files under DATA_DIR/live-best-laps/<series>/s<season>/<trackKey>.json, one
// per track: the recorder switch, the laps kept from uploaded files, and a
// line per file so the admin card can say what it has been given.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { LIVE_BEST_LAPS_DIR } from "./dataDirs.js";
import { isTrackKey, bestLapPerDriver, seriesKeyOf, seasonKeyOf } from "./telemetryLaps.js";

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

// ---- Scopes: which (series, season) a server's board reads -----------------
//
// Set by the live relay from the series → server assignment and each series'
// active season (services/liveTiming.js refreshes it every minute), and read
// synchronously by every board build. A server nothing has been set for
// carries nothing — the board is the session and nothing else, which is also
// what it is for the first minute after a restart.
const scopesByServer = new Map(); // serverKey -> [{ series, season }]

export function setBoardScopes(serverKey, scopes) {
  if (!SERVER_KEY_RE.test(String(serverKey || ""))) return;
  const clean = [];
  for (const s of Array.isArray(scopes) ? scopes : []) {
    const series = String(s?.series || "");
    const season = Number(s?.season) || 0;
    if (series && season > 0 && !clean.some((c) => c.series === series && c.season === season)) {
      clean.push({ series, season });
    }
  }
  scopesByServer.set(serverKey, clean);
}

export function boardScopes(serverKey) {
  return scopesByServer.get(serverKey) || [];
}

// ---- The per-track record ---------------------------------------------------

function validScope(series, season, trackKey) {
  return !!String(series || "") && Number(season) > 0 && isTrackKey(String(trackKey || ""));
}

function trackDir(series, season) {
  return join(LIVE_BEST_LAPS_DIR, seriesKeyOf(series), seasonKeyOf(season));
}

function fileFor(series, season, trackKey) {
  return join(trackDir(series, season), `${trackKey}.json`);
}

// Two memos, invalidated by the writes below: the track's file (which changes
// when an admin does something) and the recorder's laps read through it
// (which change on their own, hence the TTL).
const trackCache = new Map(); // `${series}/${season}/${trackKey}` -> record | null
const recorderCache = new Map(); // same key -> { at, laps }

function cacheKey(series, season, trackKey) {
  return `${seriesKeyOf(series)}/${seasonKeyOf(season)}/${trackKey}`;
}

function forget(series, season, trackKey) {
  trackCache.delete(cacheKey(series, season, trackKey));
  recorderCache.delete(cacheKey(series, season, trackKey));
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

// A track's record as stored, or null. Never throws — a broken file is no
// record, not an outage; the board goes back to being the session it was.
function readTrack(series, season, trackKey) {
  if (!validScope(series, season, trackKey)) return null;
  const key = cacheKey(series, season, trackKey);
  if (trackCache.has(key)) return trackCache.get(key);

  let rec = null;
  try {
    const path = fileFor(series, season, trackKey);
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const recorder = raw?.recorder?.on
        ? { on: true, addedAt: raw.recorder.addedAt ? String(raw.recorder.addedAt) : null }
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
        track: String(raw?.track || ""),
        layout: String(raw?.layout || ""),
        recorder,
        laps: onePerDriver(laps),
        files,
      };
      if (!rec.recorder && !rec.laps.length) rec = null;
    }
  } catch {
    rec = null;
  }
  trackCache.set(key, rec);
  return rec;
}

function writeTrack(series, season, trackKey, rec) {
  const payload = {
    v: 4,
    series: String(series),
    season: Number(season),
    trackKey,
    track: rec.track || "",
    layout: rec.layout || "",
    recorder: rec.recorder,
    laps: rec.laps,
    files: rec.files.slice(-FILES_MAX),
  };
  mkdirSync(trackDir(series, season), { recursive: true });
  writeFileSync(fileFor(series, season, trackKey), JSON.stringify(payload));
  forget(series, season, trackKey);
  return payload;
}

const emptyRecord = (trackKey) => ({ trackKey, track: "", layout: "", recorder: null, laps: [], files: [] });

// ---- Reads ------------------------------------------------------------------

// Whether the recorder is switched on for this track in this season, and
// since when. Null when it is not.
export function readSource(series, season, trackKey) {
  return readTrack(series, season, trackKey)?.recorder ?? null;
}

// The laps kept from uploaded files for one track, fastest first.
export function uploadedLaps(series, season, trackKey) {
  return readTrack(series, season, trackKey)?.laps ?? [];
}

// The files one track has been given, for the admin card.
export function uploadedFiles(series, season, trackKey) {
  return readTrack(series, season, trackKey)?.files ?? [];
}

// What the recorder's store currently has for this track — memoised for
// BESTS_TTL_MS, because the board asks several times a second. The season is
// the scope's, never anything older, and `legacy` reads the store's
// pre-season shapes alongside because the scope is always the season being
// raced, which is the one those belong to.
function recorderBests(series, season, trackKey) {
  const key = cacheKey(series, season, trackKey);
  const memo = recorderCache.get(key);
  if (memo && Date.now() - memo.at < BESTS_TTL_MS) return memo.laps;
  let laps = [];
  try {
    laps = bestLapPerDriver(series, season, trackKey, true)
      .map((l) => cleanLap(l, "recorder"))
      .filter(Boolean);
  } catch {
    laps = [];
  }
  recorderCache.set(key, { at: Date.now(), laps });
  return laps;
}

// The training bests one track carries in one series' season, fastest first,
// one row per driver across both sources. Empty when it carries nothing.
export function bestsFor(series, season, trackKey) {
  const rec = readTrack(series, season, trackKey);
  if (!rec) return [];
  const fromRecorder = rec.recorder ? recorderBests(series, season, trackKey) : [];
  return onePerDriver([...rec.laps, ...fromRecorder]);
}

// The training bests one SERVER's board is carrying for a track right now:
// bestsFor over every (series, active season) that follows that server. This
// is the call the live relay makes, so it is the one that has to be cheap:
// records are memoised until something writes them, the recorder read for
// half a minute, and merging a few dozen rows is nothing.
export function currentBests(serverKey, trackKey) {
  const scopes = boardScopes(serverKey);
  if (!scopes.length) return [];
  return onePerDriver(scopes.flatMap((s) => bestsFor(s.series, s.season, trackKey)));
}

// ---- Writes -----------------------------------------------------------------

// Keep the laps of one uploaded session file for a track. What is kept is the
// fastest per driver across everything this track has been given so far in
// this season — a second file for the same evening adds the drivers it has
// and improves the times it beats, and never takes a time away.
export function addUploadedLaps(series, season, trackKey, { track, layout, laps, file }) {
  if (!validScope(series, season, trackKey)) throw new Error("A series, a season and a track are required");
  const rec = readTrack(series, season, trackKey) || emptyRecord(trackKey);
  const incoming = (Array.isArray(laps) ? laps : []).map((l) => cleanLap(l, "file")).filter(Boolean);
  const before = new Map(rec.laps.map((l) => [l.steamId, l.lapTimeMs]));
  const merged = onePerDriver([...rec.laps, ...incoming]);
  const improved = merged.filter((l) => before.get(l.steamId) == null || l.lapTimeMs < before.get(l.steamId)).length;
  const written = writeTrack(series, season, trackKey, {
    track: track || rec.track,
    layout: layout ?? rec.layout,
    recorder: rec.recorder,
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

// Switch the recorder on for one track in one series' season. Idempotent, and
// it leaves uploaded laps exactly as they are. There is nothing to point it
// at: the season IS the key, so next season's Baku starts with the switch off
// and last season's laps out of reach.
export function switchRecorder(series, season, trackKey, { track, layout } = {}) {
  if (!validScope(series, season, trackKey)) throw new Error("A series, a season and a track are required");
  const rec = readTrack(series, season, trackKey) || emptyRecord(trackKey);
  const recorder = { on: true, addedAt: rec.recorder?.addedAt || new Date().toISOString() };
  writeTrack(series, season, trackKey, {
    track: track || rec.track,
    layout: layout ?? rec.layout,
    recorder,
    laps: rec.laps,
    files: rec.files,
  });
  return recorder;
}

// Take one track off the board for one season — the recorder switch and every
// lap kept from a file. The board goes back to showing the session the server
// is in and nothing else.
export function clearTrack(series, season, trackKey) {
  if (!validScope(series, season, trackKey)) return false;
  let removed = false;
  try {
    const path = fileFor(series, season, trackKey);
    if (existsSync(path)) {
      unlinkSync(path);
      removed = true;
    }
  } catch {
    /* it stays until the next attempt; the memos below still let go of it */
  }
  forget(series, season, trackKey);
  return removed;
}

// Every track one series' season carries training times for, newest change
// first — the admin card's "what is on the board" list. It counts what the
// board is carrying, so it reads it: an admin opening the card is exactly the
// moment to be accurate rather than cheap.
export function listTracks(series, season) {
  if (!String(series || "") || !(Number(season) > 0)) return [];
  const dir = trackDir(series, season);
  if (!existsSync(dir)) return [];
  const out = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const trackKey = name.slice(0, -5);
      const rec = readTrack(series, season, trackKey);
      if (!rec) continue;
      const laps = bestsFor(series, season, trackKey);
      const stamps = [rec.recorder?.addedAt, ...rec.files.map((f) => f.uploadedAt)].filter(Boolean).sort();
      out.push({
        trackKey,
        track: rec.track,
        layout: rec.layout,
        recorder: !!rec.recorder,
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

// Tests drive the store through the filesystem, so they need the memos and the
// scopes cleared between cases; nothing in the running server calls this.
export function __clearCache() {
  trackCache.clear();
  recorderCache.clear();
  scopesByServer.clear();
}
