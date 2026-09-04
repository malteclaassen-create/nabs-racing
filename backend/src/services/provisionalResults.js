// Provisional race results: the final classification of a race, exactly as the
// live board had it when the flag fell, kept for the rest of the evening and
// the day after.
//
// Why it exists: the board freezes a finished race for a quarter of an hour
// and then the server cycles back to practice and the result is simply gone —
// until an admin imports the result file, which on a race night is hours
// later and on a training night sometimes never. Everyone who wants to know
// how it ended in the meantime has nothing to look at. This keeps what the
// board knew, on disk, so the live page can show it under a clear
// "provisional" label while the server carries on with whatever comes next.
//
// It is NOT a result in the league's sense. No penalties, no stewarding, no
// driver matching against the roster — the names are the server's names, the
// order is the board's order at the moment it was taken. The page says so.
//
// One JSON file per race under DATA_DIR/live-results/<server>/, written whole
// and renamed into place, so a crash mid-write leaves the previous version
// rather than half a file. Re-saved a few times as the field finishes (a
// lapped car crosses the line a minute after the winner) and once more when
// the server leaves the session — the same id every time, so it is one
// result that gets better, not a list of drafts.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { LIVE_RESULTS_DIR } from "../lib/dataDirs.js";

// How long a result stays on the live page. Long enough for "the evening"
// and the morning after, short enough that a training race from last week
// is not still headlining the page on the next race night.
export const KEEP_MS = 36 * 60 * 60 * 1000;
// At most this many per server, newest first — a double-header is two.
const LIST_MAX = 6;

const byId = new Map(); // id -> result (every server, only the ones still within KEEP_MS)
let loaded = false;

const safe = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40) || "track";

function fileFor(result) {
  return join(LIVE_RESULTS_DIR, safe(result.server), `${result.id}.json`);
}

// A stable id for one running of a race on one server: the day, the track
// and the minute the session started. The relay hands the same id back on
// every save of the same race, so the file is overwritten, never duplicated.
export function resultIdFor({ server, track, trackConfig, startedAt, at }) {
  const t = new Date(startedAt || at || Date.now());
  const day = t.toISOString().slice(0, 10);
  const hm = t.toISOString().slice(11, 16).replace(":", "");
  return `${day}-${safe(track)}${trackConfig ? "-" + safe(trackConfig) : ""}-${hm}-${safe(server)}`;
}

// What is kept of a board entry: the classification facts, nothing that only
// made sense while the car was moving (positions, sectors in progress,
// telemetry). `guid` is already the public stand-in the board uses.
function slimEntry(e) {
  return {
    guid: e.guid,
    name: e.name,
    initials: e.initials || "",
    raceNumber: e.raceNumber ?? null,
    carName: e.carName || "",
    position: e.position,
    lapCount: e.lapCount || 0,
    lapsDown: e.lapsDown || 0,
    gapToLeaderMs: e.gapToLeaderMs ?? null,
    bestLapMs: e.bestLapMs ?? null,
    numPits: e.numPits ?? 0,
    stints: Array.isArray(e.stints) ? e.stints : [],
    tyre: e.tyre || "",
    onTrack: !!e.onTrack,
    inPits: !!e.inPits,
    isSafetyCar: !!e.isSafetyCar,
  };
}

// Build the stored shape from a live board. `prev` is the previous save of
// the same race, so the first-seen time survives the re-saves.
export function snapshotFromBoard(board, { id, final = false, completed = true, prev = null, now = Date.now() } = {}) {
  const s = board?.session || {};
  const entries = (board?.entries || []).map(slimEntry);
  const competitors = entries.filter((e) => !e.isSafetyCar);
  const leader = competitors[0] || null;
  const fastest = competitors.reduce((b, e) => (e.bestLapMs && (!b || e.bestLapMs < b.bestLapMs) ? e : b), null);
  return {
    // v2: entries arrive from the board already classified by the line (laps,
    // then the time each car completed its last lap). v1 files were saved in
    // the running order of the cool-down lap and are put right on load, see
    // classifyByLine.
    v: 2,
    id,
    server: board?.server || board?.serverKey || "",
    serverName: s.serverName || "",
    track: s.track || "",
    trackName: s.trackName || s.track || "",
    country: s.country || "",
    sessionName: s.name || "",
    raceLaps: s.raceLaps ?? null,
    laps: leader ? leader.lapCount : 0,
    startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : prev?.startedAt || null,
    finishedAt: prev?.finishedAt || new Date(now).toISOString(),
    savedAt: new Date(now).toISOString(),
    // `final`: the server has left the session, nothing will change any more.
    // `completed`: the leader reached the distance; false means the session
    // was cut short (skipped by the admin, server restarted) and the order is
    // where things stood when it stopped.
    final: !!final,
    completed: !!completed,
    fastestLapMs: fastest?.bestLapMs ?? null,
    fastestBy: fastest?.name ?? null,
    drivers: competitors.length,
    entries,
  };
}

// Re-classify a stored result by the line: laps first, then the gap at the
// flag. Gaps are crossing-time differences against whoever was saved first,
// so their ORDER is the finishing order even when that car was not the
// winner; the gaps are then re-based on the actual winner and the positions
// renumbered. A same-lap car without a gap (it crossed before the saved
// reference, or its crossing went unrecorded) keeps its saved place behind
// the cars with one — nothing more can be known without the crossing times.
// Written for the v1 files of 2026-09-04 (Most), where the third-placed car
// was shown fourth; harmless on a file that is already in this order.
export function classifyByLine(result) {
  if (!result || !Array.isArray(result.entries)) return result;
  const cars = result.entries.filter((e) => !e.isSafetyCar).map((e, i) => ({ e, i }));
  const sc = result.entries.filter((e) => e.isSafetyCar);
  cars.sort((a, b) => {
    const la = a.e.lapCount || 0;
    const lb = b.e.lapCount || 0;
    if (la !== lb) return lb - la;
    const ga = a.e.gapToLeaderMs;
    const gb = b.e.gapToLeaderMs;
    if (ga != null && gb != null && ga !== gb) return ga - gb;
    if (ga != null && gb == null) return -1;
    if (gb != null && ga == null) return 1;
    return a.i - b.i;
  });
  const leader = cars[0]?.e || null;
  const base = leader?.gapToLeaderMs ?? 0;
  const entries = cars.map(({ e }, i) => {
    const sameLap = leader && (e.lapCount || 0) === (leader.lapCount || 0);
    let gap = e.gapToLeaderMs;
    if (sameLap && gap != null && base) gap = gap - base;
    if (e === leader) gap = leader.gapToLeaderMs == null ? null : 0;
    return {
      ...e,
      position: i + 1,
      lapsDown: leader ? Math.max(0, (leader.lapCount || 0) - (e.lapCount || 0)) : e.lapsDown,
      gapToLeaderMs: sameLap ? gap : null,
    };
  });
  return { ...result, v: 2, laps: leader ? leader.lapCount : result.laps, entries: [...entries, ...sc] };
}

function loadAll() {
  if (loaded) return;
  loaded = true;
  if (!existsSync(LIVE_RESULTS_DIR)) return;
  const cutoff = Date.now() - KEEP_MS;
  let dirs = [];
  try {
    dirs = readdirSync(LIVE_RESULTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return;
  }
  for (const d of dirs) {
    const dir = join(LIVE_RESULTS_DIR, d.name);
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
        if (!r?.id || !r.finishedAt) continue;
        if (Date.parse(r.finishedAt) < cutoff) {
          // Older than anyone will ask for: tidy it away so the folder does
          // not grow by one file per race forever.
          try {
            unlinkSync(join(dir, f));
          } catch {
            /* leave it */
          }
          continue;
        }
        byId.set(r.id, (r.v || 1) < 2 ? classifyByLine(r) : r);
      } catch {
        /* a torn or foreign file: skip it */
      }
    }
  }
}

// Store (and overwrite) one result. Returns what was stored.
export function saveProvisional(board, opts = {}) {
  loadAll();
  const id = opts.id || resultIdFor({ server: board?.server, track: board?.session?.track, startedAt: board?.session?.startedAt });
  const prev = byId.get(id) || null;
  const result = snapshotFromBoard(board, { ...opts, id, prev });
  byId.set(id, result);
  const file = fileFor(result);
  try {
    mkdirSync(join(LIVE_RESULTS_DIR, safe(result.server)), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(result));
    renameSync(tmp, file);
  } catch (e) {
    console.warn(`[live] could not write provisional result ${id}: ${e.message}`);
  }
  return result;
}

// The results a server still has to show, newest first.
export function listProvisional(serverKey) {
  loadAll();
  const cutoff = Date.now() - KEEP_MS;
  const out = [];
  for (const r of byId.values()) {
    if (serverKey && r.server !== serverKey) continue;
    if (Date.parse(r.finishedAt) < cutoff) continue;
    out.push(r);
  }
  out.sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
  return out.slice(0, LIST_MAX);
}

// Tests: forget everything, on disk as well — the test data dir persists
// between runs, and a result left over from the last run would be counted.
export function __resetProvisional() {
  byId.clear();
  loaded = false;
  try {
    rmSync(LIVE_RESULTS_DIR, { recursive: true, force: true });
  } catch {
    /* nothing to wipe */
  }
}
