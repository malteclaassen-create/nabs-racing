// ---------------------------------------------------------------------------
// Training laps an admin has taken off the board, one at a time.
//
// The board carries a week of practice times (lib/liveBestLaps.js), and now
// and then one of them is a time that should not be on it: driven on the old
// version of the track, in a session the rest of the field did not have, with
// a car nobody else was in. Deleting the row out of the record alone would
// not hold, because the same lap has two other ways back onto the board:
//
//   - the session file it came in gets uploaded again, and the record is
//     rebuilt with the lap in it;
//   - the race server is STILL in that session and still holds the lap as
//     that driver's session best, so the live feed puts it straight back.
//
// So a removal writes a block: this driver, this exact time, this circuit.
// The store drops the lap on the way in and on the way out, and the live
// relay blanks the row while the server keeps reporting it (services/
// liveTiming.js). The driver is back on the board the moment they set a
// DIFFERENT time, which is the whole point of removing it by hand.
//
// The time to the millisecond is the identity, because it is the only thing
// a result file, the live feed and the record all agree on. Two laps of the
// same driver on the same circuit down to the millisecond are the same lap.
//
// Blocks do not expire. They are a few dozen bytes each, they are filed per
// season like everything else the board reads, and a season rolling over is
// what clears them — the same way last season's times stop being read.
//
// Files under DATA_DIR/live-lap-blocks/<series>/s<season>/<circuit>.json, one
// per circuit (the part of a track key before "--"), because that is how the
// board reads laps: every layout of a circuit as one.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { LIVE_LAP_BLOCKS_DIR } from "./dataDirs.js";
import { isTrackKey, isSteamId, seriesKeyOf, seasonKeyOf } from "./telemetryLaps.js";

// A guard against a broken file, not a real limit: a season has a handful of
// these, and a hundred of them on one circuit would already be somebody using
// the wrong tool for the job.
const MAX_BLOCKS = 200;

function dirFor(series, season) {
  return join(LIVE_LAP_BLOCKS_DIR, seriesKeyOf(series), seasonKeyOf(season));
}

function fileFor(series, season, circuit) {
  return join(dirFor(series, season), `${circuit}.json`);
}

function valid(series, season, circuit) {
  return !!String(series || "") && Number(season) > 0 && isTrackKey(String(circuit || ""));
}

// What a block is keyed by, and what the live relay matches a row against.
export function blockKey(steamId, lapTimeMs) {
  return `${steamId}:${Math.round(Number(lapTimeMs))}`;
}

// The board is rebuilt several times a second and asks for its circuit every
// time; blocks only change when an admin removes or restores one.
const cache = new Map(); // `${series}/${season}/${circuit}` -> block[]

function cacheKey(series, season, circuit) {
  return `${seriesKeyOf(series)}/${seasonKeyOf(season)}/${circuit}`;
}

// One block as stored, or null. Written defensively: what is read here came
// off disk, and a broken file is no block rather than an outage.
function clean(raw) {
  if (!raw || typeof raw !== "object") return null;
  const steamId = String(raw.steamId || "");
  if (!isSteamId(steamId)) return null;
  const lapTimeMs = Math.round(Number(raw.lapTimeMs));
  if (!Number.isFinite(lapTimeMs) || lapTimeMs <= 0) return null;
  return {
    id: blockKey(steamId, lapTimeMs),
    steamId,
    name: String(raw.name || "").trim().slice(0, 64),
    lapTimeMs,
    // The key the lap was filed under, when it was one that had been filed.
    // A lap removed while the race server was still holding it has none.
    trackKey: isTrackKey(String(raw.trackKey || "")) ? String(raw.trackKey) : null,
    removedAt: raw.removedAt ? String(raw.removedAt).slice(0, 40) : null,
    reason: String(raw.reason || "").trim().slice(0, 200),
    // The lap itself, so putting it back is a button rather than another
    // upload of the file it came in.
    lap: raw.lap && typeof raw.lap === "object" ? raw.lap : null,
  };
}

function read(series, season, circuit) {
  if (!valid(series, season, circuit)) return [];
  const key = cacheKey(series, season, circuit);
  if (cache.has(key)) return cache.get(key);
  let list = [];
  try {
    const path = fileFor(series, season, circuit);
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      list = (Array.isArray(raw?.blocks) ? raw.blocks : []).map(clean).filter(Boolean).slice(0, MAX_BLOCKS);
    }
  } catch {
    list = [];
  }
  cache.set(key, list);
  return list;
}

function write(series, season, circuit, blocks) {
  const path = fileFor(series, season, circuit);
  cache.delete(cacheKey(series, season, circuit));
  if (!blocks.length) {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* it goes on the next attempt; nothing reads a file it cannot parse */
    }
    return [];
  }
  mkdirSync(dirFor(series, season), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ v: 1, series: String(series), season: Number(season), circuit, blocks })
  );
  return blocks;
}

// ---- Reads ------------------------------------------------------------------

// Everything removed on one circuit, newest first.
export function listBlocks(series, season, circuit) {
  return [...read(series, season, circuit)].sort((a, b) =>
    String(b.removedAt || "").localeCompare(String(a.removedAt || ""))
  );
}

// The keys the store and the relay match against: "<steamId>:<ms>".
export function blockedKeys(series, season, circuit) {
  return new Set(read(series, season, circuit).map((b) => b.id));
}

export function isBlocked(series, season, circuit, steamId, lapTimeMs) {
  if (!valid(series, season, circuit)) return false;
  const want = blockKey(steamId, lapTimeMs);
  return read(series, season, circuit).some((b) => b.id === want);
}

// The same question for a live board, which follows several (series, season)
// at once: a lap one of them has removed is off that board. The board is
// shared, so one series saying "not this lap" is enough.
export function blockedKeysForScopes(scopes, circuit) {
  const out = new Set();
  for (const s of Array.isArray(scopes) ? scopes : []) {
    for (const key of blockedKeys(s.series, s.season, circuit)) out.add(key);
  }
  return out;
}

// Every circuit one season has removals on, for the admin card.
export function blockedCircuits(series, season) {
  if (!String(series || "") || !(Number(season) > 0)) return [];
  try {
    const dir = dirFor(series, season);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -5))
      .filter((k) => isTrackKey(k) && read(series, season, k).length);
  } catch {
    return [];
  }
}

// ---- Writes -----------------------------------------------------------------

// Take one lap off the board. Removing a lap that is already blocked simply
// refreshes it, so pressing the button twice is not two entries.
export function blockLap(series, season, circuit, { steamId, name, lapTimeMs, trackKey, lap, reason } = {}) {
  if (!valid(series, season, circuit)) throw new Error("A series, a season and a track are required");
  const entry = clean({
    steamId,
    name,
    lapTimeMs,
    trackKey,
    lap,
    reason,
    removedAt: new Date().toISOString(),
  });
  if (!entry) throw new Error("That is not a lap that can be removed");
  const rest = read(series, season, circuit).filter((b) => b.id !== entry.id);
  write(series, season, circuit, [...rest, entry].slice(-MAX_BLOCKS));
  return entry;
}

// Let a removed lap back onto the board. Hands back what was removed, so the
// caller can put the lap into the record it came out of.
export function unblockLap(series, season, circuit, id) {
  if (!valid(series, season, circuit)) return null;
  const list = read(series, season, circuit);
  const found = list.find((b) => b.id === String(id || ""));
  if (!found) return null;
  write(series, season, circuit, list.filter((b) => b !== found));
  return found;
}

// Tests drive this through the filesystem, so they need the memo cleared
// between cases; nothing in the running server calls it.
export function __clearCache() {
  cache.clear();
}
