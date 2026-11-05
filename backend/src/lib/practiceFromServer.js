// ---------------------------------------------------------------------------
// Practice laps from the race servers' own result files.
//
// The live relay only started counting training laps when the points did, so
// on its own it cannot say who has driven the most this season. The server
// manager can: it writes a result file for every practice session, the same
// files the admin imports races from (services/emperorResults.js), and every
// lap in one carries the driver's Steam id and the second it was completed.
// That is the record Stracker builds its lap counts from, with the Steam id
// still on it, so a lap can be matched to a driver for certain rather than by
// the in-game name.
//
// A finished session never changes, so each one is read once and kept, in
// memory and on disk, as Steam id -> the timestamps of their laps. Only the
// listing is read again, every few minutes, to find new sessions.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { DATA_ROOT } from "./dataDirs.js";
import { listRemoteResults, fetchRemoteResult } from "../services/emperorResults.js";

const STEAM_RE = /^\d{10,20}$/;
const CACHE_FILE = join(DATA_ROOT, "practice-sessions.json");
const LIST_TTL_MS = 10 * 60 * 1000;
const PARALLEL = 4;

// One session file's laps: Steam id -> lap timestamps (seconds), and the
// circuit's folder name. Every completed lap counts, cut or not, the same rule
// as the training points.
export function lapsOfSession(json) {
  const laps = {};
  for (const l of json?.Laps || []) {
    const id = String(l?.DriverGuid || "");
    const at = Math.round(Number(l?.Timestamp) || 0);
    if (!STEAM_RE.test(id) || at <= 0) continue;
    (laps[id] ||= []).push(at);
  }
  return { track: String(json?.TrackName || ""), laps };
}

let sessions = null; // ref -> { server, track, laps }
function loadCache() {
  if (sessions) return sessions;
  sessions = new Map();
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
      for (const [ref, s] of Object.entries(raw || {})) if (s && s.laps) sessions.set(ref, s);
    }
  } catch {
    // A broken cache is only a slower first read.
  }
  return sessions;
}

function saveCache() {
  try {
    mkdirSync(DATA_ROOT, { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(sessions)));
    renameSync(tmp, CACHE_FILE);
  } catch {
    // Kept in memory all the same.
  }
}

let listed = null; // { at, since, rows }
let inflight = null;

// Every practice session both servers have written since `sinceMs`, with its
// laps. Sessions that cannot be read are skipped and tried again next time.
export function practiceSessionsSince(sinceMs, { list = listRemoteResults, fetch = fetchRemoteResult } = {}) {
  if (listed && Date.now() - listed.at < LIST_TTL_MS && listed.since <= sinceMs) {
    return Promise.resolve(listed.rows.filter((r) => r.endTs >= sinceMs));
  }
  if (inflight) return inflight;
  inflight = (async () => {
    const cache = loadCache();
    // The session's id is the time it ended; anything that ended before the
    // window opened has no lap inside it.
    const rows = (await list({ type: "PRACTICE", limit: 5000 })).filter((r) => r.ts && r.ts >= sinceMs - 86400000);
    const missing = rows.filter((r) => !cache.has(r.id));
    let added = 0;
    for (let i = 0; i < missing.length; i += PARALLEL) {
      const batch = missing.slice(i, i + PARALLEL);
      const got = await Promise.allSettled(batch.map((r) => fetch(r.id)));
      got.forEach((g, j) => {
        if (g.status !== "fulfilled") return;
        cache.set(batch[j].id, { server: batch[j].server, ...lapsOfSession(g.value) });
        added++;
      });
    }
    if (added) saveCache();
    const out = rows
      .filter((r) => cache.has(r.id))
      .map((r) => ({ ref: r.id, endTs: r.ts, ...cache.get(r.id) }));
    listed = { at: Date.now(), since: sinceMs, rows: out };
    return out;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function __resetPracticeSessions() {
  sessions = new Map();
  listed = null;
  inflight = null;
}
