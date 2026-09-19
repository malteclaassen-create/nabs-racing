// ---------------------------------------------------------------------------
// "Server reset detected. Keep the times?"
//
// The race server holds exactly one session, and a reset takes the week's
// practice times off the live board with it (lib/liveBestLaps.js is where an
// admin puts them back). The relay watches that session all week, so it HAS
// those times the moment they disappear, and putting them straight back would
// be a one-line change.
//
// It would also be wrong. The league restarts that server for a reason, and
// the usual reason is a new version of the track: track limits that were being
// exploited, a kerb that launched cars, a fix. Times set on the old version can
// be times nobody can reach on the fixed one, and carrying them over would
// leave a training board with a target on it that is no longer possible. So the
// laps are parked HERE and an admin is asked. Nothing reaches the board until
// somebody says so.
//
// What the question can say for itself: whether the track changed. The relay
// knows what the server was on before the reset and what it is on after, and
// the league renames a layout when it bumps a version (nabs_baku_2025 on
// Monday, nabs_baku on Wednesday). Same names on both sides means a plain
// restart and keeping is the safe answer; a different name means a new version
// and dropping is. The admin decides either way — this only picks which button
// is already selected.
//
// What it deliberately does NOT try to work out: whether the track limits
// themselves changed. They are Real Penalty's business on this league's server,
// its configuration is not something this can read, and a fix can equally live
// in the track model, which the server manager does not serve. A guess dressed
// up as a fact is worse than a plain question.
//
// One file per waiting snapshot under DATA_DIR/live-reset-keep, because the
// answer can take a day and a deploy must not be what decides it.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { LIVE_RESET_KEEP_DIR } from "./dataDirs.js";
import { isTrackKey } from "./telemetryLaps.js";
import { normaliseLaps } from "./liveBestLaps.js";

const ID_RE = /^[a-z0-9_-]{1,64}$/;
// A question nobody answered for a fortnight is not a question any more. The
// board has moved on, and whatever was waiting is a week of times for a track
// version that is two versions old.
const KEEP_FOR_MS = 14 * 24 * 60 * 60 * 1000;
// A practice session of a whole week on a busy server: this is a guard against
// a broken file, not a real limit.
const MAX_LAPS = 200;

function fileFor(id) {
  return join(LIVE_RESET_KEEP_DIR, `${id}.json`);
}

// The snapshot as stored, or null. Never throws: a broken file is one question
// nobody gets asked, not an outage.
function readOne(id) {
  try {
    if (!ID_RE.test(id)) return null;
    const path = fileFor(id);
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    const laps = (Array.isArray(raw.laps) ? raw.laps : []).slice(0, MAX_LAPS);
    if (!laps.length) return null;
    return {
      id: String(raw.id || id),
      serverKey: String(raw.serverKey || ""),
      scopes: (Array.isArray(raw.scopes) ? raw.scopes : [])
        .map((s) => ({ series: String(s?.series || ""), season: Number(s?.season) || 0 }))
        .filter((s) => s.series && s.season > 0),
      before: shapeSide(raw.before),
      after: shapeSide(raw.after),
      trackChanged: !!raw.trackChanged,
      endedAt: String(raw.endedAt || ""),
      laps,
    };
  } catch {
    return null;
  }
}

function shapeSide(side) {
  return {
    track: String(side?.track || ""),
    layout: String(side?.layout || ""),
    trackKey: isTrackKey(String(side?.trackKey || "")) ? String(side.trackKey) : "",
    sessionName: String(side?.sessionName || "").slice(0, 80),
    // AC's session type (1 practice, 2 qualifying, 3 race), so the question can
    // tell a reset from a race night: the server moving on to qualifying on the
    // same track takes the week's times off the board just the same, and is not
    // a reason to suspect them.
    sessionType: Number(side?.sessionType) || 0,
  };
}

// ---- Writing ---------------------------------------------------------------

// Park one ended session's best laps. Called by the relay the instant the
// server moves off a practice session (services/liveTiming.js).
//
// Anything without laps or without a series to file them under is dropped on
// the spot: a question whose answer can change nothing is noise in the admin.
export function parkLaps({ serverKey, scopes, before, after, laps, endedAt = new Date().toISOString() }) {
  // Through the same sieve a file's laps go through, so a row that could
  // never reach the board is not counted in the question either.
  const clean = normaliseLaps(laps).slice(0, MAX_LAPS);
  const scopeList = (Array.isArray(scopes) ? scopes : [])
    .map((s) => ({ series: String(s?.series || ""), season: Number(s?.season) || 0 }))
    .filter((s) => s.series && s.season > 0);
  if (!clean.length || !scopeList.length) return null;

  const from = shapeSide(before);
  const to = shapeSide(after);
  if (!from.trackKey) return null;

  // One waiting question per server: a second reset before anybody answered
  // replaces the first. The times of the newer session are the ones that are
  // still worth having, and two prompts for the same board would be a queue
  // nobody asked for.
  for (const old of listPending()) {
    if (old.serverKey === serverKey) discard(old.id);
  }

  const id = `${serverKey}-${Date.parse(endedAt) || Date.now()}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const payload = {
    v: 1,
    id,
    serverKey: String(serverKey || ""),
    scopes: scopeList,
    before: from,
    after: to,
    // The one thing the question can answer for itself. Only when we actually
    // saw what came next — a server that went off air tells us nothing, and
    // "unchanged" would be a guess.
    trackChanged: !!to.trackKey && to.trackKey !== from.trackKey,
    endedAt: String(endedAt),
    laps: clean,
  };
  mkdirSync(LIVE_RESET_KEEP_DIR, { recursive: true });
  writeFileSync(fileFor(id), JSON.stringify(payload));
  return payload;
}

// ---- Reading ---------------------------------------------------------------

// Everything waiting for an answer, newest first. Expired questions are swept
// on the way past, so nothing else has to remember to.
export function listPending() {
  let names = [];
  try {
    if (!existsSync(LIVE_RESET_KEEP_DIR)) return [];
    names = readdirSync(LIVE_RESET_KEEP_DIR).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const rec = readOne(name.slice(0, -5));
    if (!rec) continue;
    const at = Date.parse(rec.endedAt) || 0;
    if (at && Date.now() - at > KEEP_FOR_MS) {
      discard(rec.id);
      continue;
    }
    out.push(rec);
  }
  return out.sort((a, b) => (Date.parse(b.endedAt) || 0) - (Date.parse(a.endedAt) || 0));
}

// The questions waiting for the series being looked at, which is all an admin
// card ever wants.
export function pendingFor(series, season) {
  const s = String(series || "");
  const n = Number(season) || 0;
  return listPending().filter((p) => p.scopes.some((sc) => sc.series === s && sc.season === n));
}

// ---- Answering -------------------------------------------------------------

// Take one question off the pile and hand back what it was holding, or null.
// The caller writes the laps wherever they belong (the admin route hands them
// to lib/liveBestLaps.js); this is only the record keeping, so a keep that
// fails half way through cannot also lose the times.
export function take(id) {
  const rec = readOne(String(id || ""));
  if (!rec) return null;
  discard(rec.id);
  return rec;
}

// Drop one question unanswered, or answered with "no".
export function discard(id) {
  try {
    if (!ID_RE.test(String(id || ""))) return false;
    const path = fileFor(id);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}
