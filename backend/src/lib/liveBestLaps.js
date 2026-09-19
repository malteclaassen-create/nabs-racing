// ---------------------------------------------------------------------------
// Training best laps, carried onto the live board.
//
// The race server's live timing knows exactly one thing: the session it is in
// right now. A practice session that hits its time limit and restarts, a server
// reboot, a deploy — and "Session Best Times" is empty again. Between two race
// weekends that session is the whole week of training, and it was being thrown
// away every few hours.
//
// The server manager still has the times: it writes a result JSON for every
// session it runs, practice included, with every lap and the server's own
// sector splits in it (lib/practiceJson.js). An admin hands the site those
// files, and their fastest clean lap per driver is kept here — sectors, tyre,
// the best of each sector, the lap count and the last lap — drawn on the
// board exactly as a live row is. On the board a live lap beats a carried one
// the moment it is quicker (services/liveTiming.js).
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
// THE LAYOUT IS NOT PART OF THE MATCH. A track key is "<track>--<layout>" (lib/
// telemetryLaps.js), and the league renames its layouts between weeks the way
// other people bump a version: Baku ran as nabs_baku_2025 on Monday and as
// nabs_baku on Wednesday, same circuit, same corners, a small fix in between.
// Filing the laps under the full key keeps them honest about where they were
// driven; the BOARD, though, carries every record of the same circuit — the
// part of the key before "--" — whatever the layout was called that day,
// because the league said so in as many words: a track change is usually not
// a change. A circuit whose layouts really are different tracks (a short
// course and a full one) does not exist on this league's calendar, and if it
// ever does, the admin card says which layout each carried lap came from.
//
// Files under DATA_DIR/live-best-laps/<series>/s<season>/<trackKey>.json, one
// per track key: the laps kept from uploaded files, and a line per file so
// the admin card can say what it has been given.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { LIVE_BEST_LAPS_DIR } from "./dataDirs.js";
import { isTrackKey, seriesKeyOf, seasonKeyOf } from "./telemetryLaps.js";
import { blockedKeys, blockKey } from "./liveLapBlocks.js";

// Same bar as everywhere else on the site: a number outside this is not a lap
// time and has no business reaching the board.
const MAX_LAP_MS = 1_800_000;
const MIN_LAP_MS = 20_000;

const SERVER_KEY_RE = /^[a-z0-9_-]{1,32}$/;
const STEAM_RE = /^\d{10,20}$/;

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

// The circuit a track key names, without its layout: "baku-2022--nabs-baku"
// and "baku-2022--nabs-baku-2025" are both "baku-2022".
export function baseTrackOf(trackKey) {
  const key = String(trackKey || "");
  const cut = key.indexOf("--");
  return cut > 0 ? key.slice(0, cut) : key;
}

function validScope(series, season, trackKey) {
  return !!String(series || "") && Number(season) > 0 && isTrackKey(String(trackKey || ""));
}

function trackDir(series, season) {
  return join(LIVE_BEST_LAPS_DIR, seriesKeyOf(series), seasonKeyOf(season));
}

function fileFor(series, season, trackKey) {
  return join(trackDir(series, season), `${trackKey}.json`);
}

// The board is rebuilt several times a second and asks for its track every
// time; the records only change when an admin does something, so they are
// read once and kept until one of the writes below lets go of them. Two
// memos: each record, and the list of track keys a season has records for
// (what the board scans to find every layout of its circuit).
const trackCache = new Map(); // `${series}/${season}/${trackKey}` -> record | null
const keysCache = new Map(); // `${series}/${season}` -> [trackKey]

function seasonCacheKey(series, season) {
  return `${seriesKeyOf(series)}/${seasonKeyOf(season)}`;
}

function cacheKey(series, season, trackKey) {
  return `${seasonCacheKey(series, season)}/${trackKey}`;
}

function forget(series, season, trackKey) {
  trackCache.delete(cacheKey(series, season, trackKey));
  keysCache.delete(seasonCacheKey(series, season));
}

// Every track key one season has a record file for.
function trackKeysOf(series, season) {
  const key = seasonCacheKey(series, season);
  if (keysCache.has(key)) return keysCache.get(key);
  let keys = [];
  try {
    const dir = trackDir(series, season);
    if (existsSync(dir)) {
      keys = readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -5))
        .filter((k) => isTrackKey(k));
    }
  } catch {
    keys = [];
  }
  keysCache.set(key, keys);
  return keys;
}

// One lap on its way to the board, or null if it is not one. Written
// defensively because what arrives here was read off disk or out of a file
// somebody uploaded: neither is under this code's control.
function cleanLap(raw) {
  if (!raw || typeof raw !== "object") return null;
  const steamId = String(raw.steamId || "");
  if (!STEAM_RE.test(steamId)) return null;
  const lapTimeMs = Math.round(Number(raw.lapTimeMs));
  if (!Number.isFinite(lapTimeMs) || lapTimeMs < MIN_LAP_MS || lapTimeMs > MAX_LAP_MS) return null;
  const name = String(raw.name || "").trim().slice(0, 64);
  if (!name) return null;
  // A comma-joined list of names is the server manager's row for a car that
  // several drivers shared over an evening, not a driver (lib/practiceJson.js
  // explains). The parser no longer produces one; records written before it
  // stopped still hold them, and this is what keeps them off the board until
  // the files are given again.
  if (name.includes(", ")) return null;
  // Three positive splits that add up to the lap, or none. Checked again here
  // even though practiceJson.js checked on the way in: this is the last stop
  // before a number is printed beside a driver's name.
  let sectorsMs = null;
  if (Array.isArray(raw.sectorsMs) && raw.sectorsMs.length === 3) {
    const s = raw.sectorsMs.map((v) => Math.round(Number(v)));
    if (s.every((v) => Number.isFinite(v) && v > 0) && Math.abs(s[0] + s[1] + s[2] - lapTimeMs) <= 3) sectorsMs = s;
  }
  // The rest of what a live row shows and a file can answer (lib/practiceJson
  // .js): each checked the same way, and absent rather than wrong.
  const sectorMs = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 && n < MAX_LAP_MS ? n : null;
  };
  const bestSectorsMs = Array.isArray(raw.bestSectorsMs) && raw.bestSectorsMs.length === 3
    ? raw.bestSectorsMs.map(sectorMs)
    : [null, null, null];
  const lastLap = Math.round(Number(raw.lastLapMs));
  // The server's stamp of each completed lap, seconds since the epoch: whole,
  // positive, once each, in order. A count is derived from these and never
  // stored, so the same lap given twice stays one lap.
  const lapStamps = [...new Set((Array.isArray(raw.lapStamps) ? raw.lapStamps : []).map((v) => Math.round(Number(v))))]
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  return {
    steamId,
    name,
    car: String(raw.car || "").trim().slice(0, 80),
    lapTimeMs,
    sectorsMs,
    tyre: String(raw.tyre || "").trim().slice(0, 8),
    bestSectorsMs,
    lapStamps,
    lapCount: lapStamps.length,
    lastLapMs: Number.isFinite(lastLap) && lastLap >= MIN_LAP_MS && lastLap <= MAX_LAP_MS ? lastLap : null,
    lastAt: Number(raw.lastAt) || 0,
    recordedAt: raw.recordedAt ? String(raw.recordedAt).slice(0, 40) : null,
  };
}

// Two records of the same driver, from two files, as one: the quicker best
// lap with its sectors, car and tyre (the same time to the millisecond is the
// same lap, and the copy with sectors is kept); the best of each sector
// across both; the laps as the union of their stamps, so a file given twice
// adds nothing; the later last lap.
function mergeDriver(a, b) {
  const [fast, slow] =
    b.lapTimeMs < a.lapTimeMs || (b.lapTimeMs === a.lapTimeMs && b.sectorsMs && !a.sectorsMs) ? [b, a] : [a, b];
  const lapStamps = [...new Set([...(fast.lapStamps || []), ...(slow.lapStamps || [])])].sort((x, y) => x - y);
  return {
    ...fast,
    bestSectorsMs: [0, 1, 2].map((i) => {
      const x = fast.bestSectorsMs?.[i] ?? null;
      const y = slow.bestSectorsMs?.[i] ?? null;
      return x == null ? y : y == null ? x : Math.min(x, y);
    }),
    lapStamps,
    lapCount: lapStamps.length,
    lastLapMs: (slow.lastAt || 0) > (fast.lastAt || 0) ? slow.lastLapMs : fast.lastLapMs,
    lastAt: Math.max(fast.lastAt || 0, slow.lastAt || 0),
  };
}

// Fastest first, one row per driver, merged across whatever was given.
function onePerDriver(laps) {
  const byDriver = new Map();
  for (const lap of laps) {
    const seen = byDriver.get(lap.steamId);
    byDriver.set(lap.steamId, seen ? mergeDriver(seen, lap) : lap);
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
      const laps = (Array.isArray(raw?.laps) ? raw.laps : []).map(cleanLap).filter(Boolean);
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
        laps: onePerDriver(laps),
        files,
      };
      if (!rec.laps.length) rec = null;
    }
  } catch {
    rec = null;
  }
  trackCache.set(key, rec);
  return rec;
}

function writeTrack(series, season, trackKey, rec) {
  const payload = {
    v: 5,
    series: String(series),
    season: Number(season),
    trackKey,
    track: rec.track || "",
    layout: rec.layout || "",
    laps: rec.laps,
    files: rec.files.slice(-FILES_MAX),
  };
  mkdirSync(trackDir(series, season), { recursive: true });
  writeFileSync(fileFor(series, season, trackKey), JSON.stringify(payload));
  forget(series, season, trackKey);
  return payload;
}

// One clean row per driver, held to exactly the bar a record on disk is held
// to. Exported for the reset waiting room (lib/liveResetKeep.js), which parks
// laps taken off the LIVE feed rather than out of a file: they go through the
// same sieve, so what the admin is told is waiting is what would land.
export function normaliseLaps(laps) {
  return onePerDriver((Array.isArray(laps) ? laps : []).map(cleanLap).filter(Boolean));
}

// ---- Reads ------------------------------------------------------------------

// The laps one track KEY carries in one series' season, fastest first, one
// row per driver. Empty when it carries nothing. This is the record as filed;
// what a board shows is circuitBests below.
//
// Minus whatever an admin has taken off the board by hand (lib/liveLapBlocks
// .js): a removed lap stays in no record anybody reads, whether it survived
// in the file or arrived in a later upload of the session it came from.
export function bestsFor(series, season, trackKey) {
  const laps = readTrack(series, season, trackKey)?.laps ?? [];
  if (!laps.length) return laps;
  const blocked = blockedKeys(series, season, baseTrackOf(trackKey));
  return blocked.size ? laps.filter((l) => !blocked.has(blockKey(l.steamId, l.lapTimeMs))) : laps;
}

// The files one track key has been given, for the admin card.
export function uploadedFiles(series, season, trackKey) {
  return readTrack(series, season, trackKey)?.files ?? [];
}

// Every record of the same circuit as `trackKey` in one season, whatever the
// layout was called: the keys, and the laps merged across them, fastest first
// and one row per driver. Each lap says which key it was filed under.
export function circuitBests(series, season, trackKey) {
  const base = baseTrackOf(trackKey);
  if (!base) return { keys: [], laps: [] };
  const keys = trackKeysOf(series, season).filter((k) => baseTrackOf(k) === base);
  const laps = keys.flatMap((k) => bestsFor(series, season, k).map((l) => ({ ...l, trackKey: k })));
  return { keys, laps: onePerDriver(laps) };
}

// The laps one SERVER's board is carrying for the track it is on: every
// record of that circuit, in every (series, active season) that follows that
// server. This is the call the live relay makes, so it is the one that has to
// be cheap: the key list and the records are memoised until something writes
// them, and merging a few dozen rows is nothing.
export function currentBests(serverKey, trackKey) {
  const scopes = boardScopes(serverKey);
  if (!scopes.length) return [];
  return onePerDriver(scopes.flatMap((s) => circuitBests(s.series, s.season, trackKey).laps));
}

// ---- Writes -----------------------------------------------------------------

// Keep the laps of one uploaded session file for a track. What is kept is the
// fastest per driver across everything this track has been given so far in
// this season — a second file for the same evening adds the drivers it has
// and improves the times it beats, and never takes a time away.
export function addUploadedLaps(series, season, trackKey, { track, layout, laps, file }) {
  if (!validScope(series, season, trackKey)) throw new Error("A series, a season and a track are required");
  const rec = readTrack(series, season, trackKey) || { trackKey, track: "", layout: "", laps: [], files: [] };
  // A lap an admin has removed does not come back because the file it was in
  // is handed over again (lib/liveLapBlocks.js). It is counted so the upload
  // summary can say so rather than quietly dropping a driver.
  const blocked = blockedKeys(series, season, baseTrackOf(trackKey));
  const allowed = (l) => !blocked.has(blockKey(l.steamId, l.lapTimeMs));
  const read = (Array.isArray(laps) ? laps : []).map(cleanLap).filter(Boolean);
  const incoming = read.filter(allowed);
  const kept = rec.laps.filter(allowed);
  const before = new Map(kept.map((l) => [l.steamId, l.lapTimeMs]));
  const merged = onePerDriver([...kept, ...incoming]);
  const improved = merged.filter((l) => before.get(l.steamId) == null || l.lapTimeMs < before.get(l.steamId)).length;
  // Nothing usable is nothing given: no record is written for it, and no file
  // line either — a list of files that contributed no lap would be a list of
  // mistakes.
  if (!merged.length) return { kept: 0, read: read.length, improved: 0, blocked: read.length - incoming.length };
  const written = writeTrack(series, season, trackKey, {
    track: track || rec.track,
    layout: layout ?? rec.layout,
    laps: merged,
    files: incoming.length
      ? [
          ...rec.files,
          {
            name: String(file?.name || "").slice(0, 120),
            type: String(file?.type || "").slice(0, 20),
            date: file?.date ? String(file.date).slice(0, 40) : null,
            uploadedAt: new Date().toISOString(),
            laps: incoming.length,
          },
        ]
      : rec.files,
  });
  return { kept: written.laps.length, read: read.length, improved, blocked: read.length - incoming.length };
}

// Take one track off the board for one season — every lap kept from a file.
// The board goes back to showing the session the server is in and nothing
// else.
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
    /* it stays until the next attempt; the memo below still lets go of it */
  }
  forget(series, season, trackKey);
  return removed;
}

// Take ONE driver's lap out of the record it is filed under. The caller
// blocks it as well (lib/liveLapBlocks.js), which is what keeps it off the
// board while the race server is still holding it and stops the next upload
// of the same session file putting it back. Hands back the lap it removed,
// so it can be put back later.
//
// One lap, not the driver: a lap of theirs filed under another layout of the
// circuit is a different lap, and the board shows it next. The admin card
// lists it as its own row, with its own button.
export function removeLap(series, season, trackKey, steamId, lapTimeMs = null) {
  if (!validScope(series, season, trackKey)) return null;
  const rec = readTrack(series, season, trackKey);
  if (!rec) return null;
  const want = Math.round(Number(lapTimeMs));
  const lap = rec.laps.find(
    (l) => l.steamId === String(steamId) && (!Number.isFinite(want) || l.lapTimeMs === want)
  );
  if (!lap) return null;
  const rest = rec.laps.filter((l) => l !== lap);
  // A record with nothing left in it is no record: readTrack answers null for
  // one anyway, and the file would sit in the track list saying "0 drivers".
  if (rest.length) writeTrack(series, season, trackKey, { ...rec, laps: rest });
  else clearTrack(series, season, trackKey);
  return lap;
}

// The other direction: a lap that was removed by hand goes back into the
// record it came out of. Only ever called with a lap this store handed out,
// and held to the same bar on the way in regardless.
export function restoreLap(series, season, trackKey, lap) {
  if (!validScope(series, season, trackKey)) return false;
  const clean = cleanLap(lap);
  if (!clean) return false;
  const rec = readTrack(series, season, trackKey) || { trackKey, track: "", layout: "", laps: [], files: [] };
  writeTrack(series, season, trackKey, { ...rec, laps: onePerDriver([...rec.laps, clean]) });
  return true;
}

// Every track one series' season carries training times for, newest change
// first — the admin card's "what is on the board" list.
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
      const stamps = rec.files.map((f) => f.uploadedAt).filter(Boolean).sort();
      out.push({
        trackKey,
        track: rec.track,
        layout: rec.layout,
        files: rec.files.length,
        laps: rec.laps.length,
        bestMs: rec.laps[0]?.lapTimeMs ?? null,
        changedAt: stamps[stamps.length - 1] || null,
      });
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => String(b.changedAt || "").localeCompare(String(a.changedAt || "")));
}

// Tests drive the store through the filesystem, so they need the memos and the
// scopes cleared between cases; nothing in the running server calls this.
export function __clearCache() {
  trackCache.clear();
  keysCache.clear();
  scopesByServer.clear();
}
