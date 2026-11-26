// ---------------------------------------------------------------------------
// Take a track's lap times out after the car changed under them.
//
// The usual case: the league updates the car's data file (the physics) while
// the server sits on one track for the week. Every lap on THAT track so far
// was driven with the old data and is not something anybody can match any
// more; laps on other tracks belong to weeks that are over and stay as they
// were. So a wipe is always about one circuit (every layout of it, the way
// the live board reads it: lib/liveBestLaps.js baseTrackOf).
//
// Two stores hold those times: the telemetry laps (lib/telemetryLaps.js) and
// the training times the live board carries (lib/liveBestLaps.js). Inside the
// circuit the admin narrows it further:
//   - by car, because every lap knows the car it was driven in (the folder
//     name the game reports) and a second car on the server is untouched;
//   - by "recorded before", because a data file update keeps the car's name
//     and laps driven after the update are valid — only the time tells the
//     two apart.
//
// The session on the race server is not touched: a new data file only takes
// effect after a server restart, so what the server holds is already new.
//
// Moved, not deleted, into WIPED_LAPS_DIR, one folder per wipe. Nothing reads
// it; it exists so a wipe of the wrong track is a file move to undo.
// ---------------------------------------------------------------------------
import { dirname, join } from "path";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { WIPED_LAPS_DIR } from "./dataDirs.js";
import { seasonLapFiles, seriesKeyOf, seasonKeyOf } from "./telemetryLaps.js";
import { baseTrackOf, bestsFor, listTracks, takeLapsWhere } from "./liveBestLaps.js";

// One telemetry lap file, as much as the wipe needs of it: the car, the
// track's name, and when it was recorded (the file's own time for laps from
// before that was stamped).
function telemetryLapInfo(file) {
  let car = "";
  let track = "";
  let at = null;
  try {
    const lap = JSON.parse(readFileSync(file.path, "utf8"));
    car = String(lap.car || "");
    track = String(lap.track || "");
    at = lap.recordedAt ? String(lap.recordedAt) : null;
  } catch {
    /* unreadable: a lap of no known car, which the "unknown car" row covers */
  }
  if (!at) {
    try {
      at = statSync(file.path).mtime.toISOString();
    } catch {
      at = null;
    }
  }
  return { ...file, car, track, at };
}

// The filter an admin sets: one circuit, which cars on it ("" is laps that
// never said), and optionally only laps recorded before a moment. No circuit
// or no car picked is no wipe.
export function lapFilter({ circuit, cars, before } = {}) {
  const where = baseTrackOf(String(circuit || ""));
  const picked = new Set((Array.isArray(cars) ? cars : []).map((c) => String(c ?? "")));
  const cutoff = before ? Date.parse(before) : NaN;
  const hasCutoff = Number.isFinite(cutoff);
  const fn = (car, at, trackKey) => {
    if (baseTrackOf(trackKey) !== where) return false;
    if (!picked.has(String(car || ""))) return false;
    if (!hasCutoff) return true;
    const t = at ? Date.parse(at) : NaN;
    // A lap with no time at all cannot be shown to be older: it stays.
    return Number.isFinite(t) && t < cutoff;
  };
  fn.empty = !where || picked.size === 0;
  return fn;
}

// What one series' season holds, circuit by circuit and inside each car by
// car: telemetry laps, carried board times, and the first and last time each
// was seen. Newest first on both levels, which puts the circuit the server
// is on near the top without asking the board.
export function wipePreview(series, season) {
  const circuits = new Map();
  const iso = (raw) => {
    const t = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  };
  const row = (trackKey, name, car) => {
    const circuit = baseTrackOf(trackKey);
    if (!circuits.has(circuit)) circuits.set(circuit, { circuit, name: "", cars: new Map(), lastAt: null });
    const c = circuits.get(circuit);
    if (!c.name && name) c.name = name;
    const key = String(car || "");
    if (!c.cars.has(key)) c.cars.set(key, { car: key, telemetryLaps: 0, boardLaps: 0, firstAt: null, lastAt: null });
    return [c, c.cars.get(key)];
  };
  const seen = (c, r, raw) => {
    const at = iso(raw);
    if (!at) return;
    if (!r.firstAt || at < r.firstAt) r.firstAt = at;
    if (!r.lastAt || at > r.lastAt) r.lastAt = at;
    if (!c.lastAt || at > c.lastAt) c.lastAt = at;
  };
  for (const f of seasonLapFiles(series, season, true).map(telemetryLapInfo)) {
    const [c, r] = row(f.trackKey, f.track, f.car);
    r.telemetryLaps += 1;
    seen(c, r, f.at);
  }
  for (const t of listTracks(series, season)) {
    for (const lap of bestsFor(series, season, t.trackKey)) {
      const [c, r] = row(t.trackKey, t.track, lap.car);
      r.boardLaps += 1;
      seen(c, r, lap.recordedAt);
    }
  }
  const byNewest = (a, b) => String(b.lastAt || "").localeCompare(String(a.lastAt || ""));
  return {
    circuits: [...circuits.values()]
      .map((c) => ({ ...c, cars: [...c.cars.values()].sort(byNewest) }))
      .sort(byNewest),
  };
}

// Take what the filter picks. `dryRun` only counts, for the question before
// the real thing.
export function wipeSeasonTimes(series, season, filter, { dryRun = false } = {}) {
  if (filter.empty) return { telemetryLaps: 0, boardLaps: 0, archivedTo: null };
  const telemetry = seasonLapFiles(series, season, true)
    .map(telemetryLapInfo)
    .filter((f) => filter(f.car, f.at, f.trackKey));

  if (dryRun) {
    let boardLaps = 0;
    for (const t of listTracks(series, season)) {
      boardLaps += bestsFor(series, season, t.trackKey).filter((l) => filter(l.car, l.recordedAt, t.trackKey)).length;
    }
    return { telemetryLaps: telemetry.length, boardLaps, archivedTo: null };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const home = join(WIPED_LAPS_DIR, `${stamp}_${seriesKeyOf(series)}_${seasonKeyOf(season)}`);
  let telemetryLaps = 0;
  for (const f of telemetry) {
    const to = join(home, "telemetry-laps", f.rel);
    try {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(f.path, to);
      telemetryLaps += 1;
    } catch {
      // Locked or on another disk: it still has to go, the point is that the
      // old data is not read again.
      try {
        unlinkSync(f.path);
        telemetryLaps += 1;
      } catch {
        /* left for the next press */
      }
    }
  }

  const taken = takeLapsWhere(series, season, (lap, trackKey) => filter(lap.car, lap.recordedAt, trackKey));
  if (taken.length) {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "live-best-laps.json"), JSON.stringify(taken));
  }
  return { telemetryLaps, boardLaps: taken.length, archivedTo: telemetryLaps || taken.length ? home : null };
}
