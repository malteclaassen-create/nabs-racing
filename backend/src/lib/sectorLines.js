// ---------------------------------------------------------------------------
// Where a circuit's sector lines are, learned from laps that have both.
//
// The lap comparison used to cut the lap into three equal thirds and call them
// sectors. The game's sectors are somewhere else entirely (Singapore's first
// one ends at 35% of the lap, the second at 71%), so the three times on the
// comparison never matched the three times a driver sees on the timing screen.
//
// Nothing the site is given says where the lines are. But two things it does
// have, put together, do: the race server's splits for a driver's best lap
// (the live board, or a practice file an admin uploaded), and the telemetry
// lap the same driver recorded for the same time. The telemetry lap carries
// the elapsed time at every point of the lap, so the place where it reaches
// the first split IS the first sector line. One such lap per circuit is
// enough; it is kept on disk, because the board forgets its session and the
// match may have been made weeks ago.
//
// Lines are kept as a share of the lap by track position, the same grid the
// telemetry is sampled on (lib/telemetryLaps.js), so they apply to every car
// and every lap at that circuit.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { DATA_ROOT } from "./dataDirs.js";
import { TELEMETRY_LAPS_DIR, isTrackKey, isSteamId } from "./telemetryLaps.js";

let FILE = join(DATA_ROOT, "sector-lines.json");

// The server's lap time and the game's lap time are the same lap to within a
// rounding of a millisecond or two; anything further apart is another lap.
const SAME_LAP_MS = 3;
// A sector shorter than this share of the lap is a misread, not a sector.
const MIN_SECTOR_PCT = 5;
// A new reading this far off the stored one means the layout changed under the
// same name: the new reading wins.
const MOVED_PCT = 1.5;

let cache = null;
function store() {
  if (cache) return cache;
  try {
    cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) || {} : {};
  } catch {
    cache = {};
  }
  return cache;
}
function save() {
  try {
    writeFileSync(FILE, JSON.stringify(cache, null, 1));
  } catch {
    /* the lines are found again from the next matching lap */
  }
}

// The two sector lines of one lap, in percent of the lap by position, or null
// when the splits are not this lap's or the reading is not believable.
export function linesFromLap(lap, splitsMs) {
  if (!lap || !Array.isArray(lap.t) || !Array.isArray(splitsMs) || splitsMs.length !== 3) return null;
  const s = splitsMs.map(Number);
  if (!s.every((v) => Number.isFinite(v) && v > 0)) return null;
  const total = s[0] + s[1] + s[2];
  if (Math.abs(total - lap.lapTimeMs) > SAME_LAP_MS) return null;
  const n = Math.min(lap.t.length, lap.n || lap.t.length);
  const at = (ms) => {
    for (let i = 1; i < n; i++) {
      if (lap.t[i] >= ms) {
        const span = lap.t[i] - lap.t[i - 1];
        return ((i - 1 + (span > 0 ? (ms - lap.t[i - 1]) / span : 0)) / (n - 1)) * 100;
      }
    }
    return null;
  };
  const a = at(s[0]);
  const b = at(s[0] + s[1]);
  if (a == null || b == null) return null;
  if (a < MIN_SECTOR_PCT || b - a < MIN_SECTOR_PCT || 100 - b < MIN_SECTOR_PCT) return null;
  return [Math.round(a * 100) / 100, Math.round(b * 100) / 100];
}

function remember(trackKey, lines, source) {
  const all = store();
  const old = all[trackKey];
  if (old && Math.abs(old.lines[0] - lines[0]) < MOVED_PCT && Math.abs(old.lines[1] - lines[1]) < MOVED_PCT) return false;
  all[trackKey] = { lines, source, learnedAt: new Date().toISOString() };
  save();
  return true;
}

// The circuit's lines: its own when known, otherwise those of another layout
// of the same circuit (the part of the key before "--"). The league renames
// layouts between weeks without moving anything (lib/liveBestLaps.js says
// more), so that is a better answer than none.
export function sectorLinesFor(trackKey) {
  if (!isTrackKey(trackKey)) return null;
  const all = store();
  if (all[trackKey]) return all[trackKey].lines;
  const base = trackKey.split("--")[0];
  const sibling = Object.keys(all).sort().find((k) => k.split("--")[0] === base);
  return sibling ? all[sibling].lines : null;
}

// ---- Learning -------------------------------------------------------------

// Every stored telemetry lap of this driver at this time, whichever series and
// season it was filed under: the board does not know which league a server's
// session belongs to, and the lines do not depend on it.
function storedLapsFor(trackKey, steamId, lapMs) {
  const found = [];
  let seriesDirs = [];
  try {
    seriesDirs = readdirSync(TELEMETRY_LAPS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return found;
  }
  for (const series of seriesDirs) {
    let seasons = [];
    try {
      seasons = readdirSync(join(TELEMETRY_LAPS_DIR, series), { withFileTypes: true }).filter((d) => d.isDirectory() && /^s\d+$/.test(d.name)).map((d) => d.name);
    } catch {
      continue;
    }
    for (const season of seasons) {
      for (let d = -SAME_LAP_MS; d <= SAME_LAP_MS; d++) {
        const file = join(TELEMETRY_LAPS_DIR, series, season, trackKey, steamId, `${lapMs + d}.json`);
        if (existsSync(file)) found.push(file);
      }
    }
  }
  return found;
}

function tryFiles(trackKey, files, splitsMs, source) {
  for (const file of files) {
    try {
      const lap = JSON.parse(readFileSync(file, "utf8"));
      const lines = linesFromLap(lap, splitsMs);
      if (lines) {
        remember(trackKey, lines, source);
        return lines;
      }
    } catch {
      /* a half-written or foreign file is simply not a match */
    }
  }
  return null;
}

// Splits the race server has shown for a driver's best lap, by track. Kept for
// a while in memory so a telemetry lap that arrives a moment AFTER the board
// updated still finds them (lapArrived below).
const RECENT_MAX = 2000;
const recent = new Map(); // `${trackKey}|${steamId}|${lapMs}` -> splitsMs

// A best lap with its three splits, seen on a live board (or carried onto it
// from an uploaded practice file). Called for every row of every board build,
// so a split already seen costs one map lookup.
export function noteSplits(trackKey, steamId, lapMs, splitsMs) {
  if (!isTrackKey(trackKey) || !isSteamId(steamId) || !(lapMs > 0)) return;
  if (!Array.isArray(splitsMs) || splitsMs.length !== 3 || !splitsMs.every((v) => v > 0)) return;
  const key = `${trackKey}|${steamId}|${lapMs}`;
  if (recent.has(key)) return;
  if (recent.size >= RECENT_MAX) recent.delete(recent.keys().next().value);
  recent.set(key, splitsMs.slice());
  tryFiles(trackKey, storedLapsFor(trackKey, steamId, lapMs), splitsMs, "live board");
}

// A whole board's rows at once: Map(steamId -> entry with bestLapMs and
// sectors [{ ms }]), the shape services/liveTiming.js builds.
export function noteBoard(trackKey, byGuid) {
  if (!isTrackKey(trackKey) || !byGuid) return;
  for (const [steamId, e] of byGuid) {
    const splits = (e?.sectors || []).map((s) => s?.ms ?? null);
    if (e?.bestLapMs && splits.length === 3 && splits.every((v) => v > 0)) noteSplits(trackKey, steamId, e.bestLapMs, splits);
  }
}

// A telemetry lap just stored: the board may already have shown its splits.
export function lapArrived(lap) {
  if (!lap || !isTrackKey(lap.trackKey)) return;
  for (let d = -SAME_LAP_MS; d <= SAME_LAP_MS; d++) {
    const splits = recent.get(`${lap.trackKey}|${lap.steamId}|${lap.lapTimeMs + d}`);
    if (splits) {
      const lines = linesFromLap(lap, splits);
      if (lines) remember(lap.trackKey, lines, "live board");
      return;
    }
  }
}

// Carried training laps (lib/liveBestLaps.js) against the telemetry laps of
// the same track, for a track the board has not taught anything yet. `laps`
// are the stored telemetry laps' summaries ({ steamId, lapTimeMs }).
export function learnFromCarried(trackKey, carried, laps, readLapFn) {
  if (sectorLinesFor(trackKey) || !carried?.length || !laps?.length) return null;
  for (const c of carried) {
    if (!c?.sectorsMs) continue;
    const match = laps.find((l) => l.steamId === c.steamId && Math.abs(l.lapTimeMs - c.lapTimeMs) <= SAME_LAP_MS);
    if (!match) continue;
    try {
      const lines = linesFromLap(readLapFn(match), c.sectorsMs);
      if (lines) {
        remember(trackKey, lines, "practice file");
        return lines;
      }
    } catch {
      /* next one */
    }
  }
  return null;
}

// Tests point the store at a file of their own.
export function __useFile(path) {
  FILE = path;
  cache = null;
  recent.clear();
}
