// ---------------------------------------------------------------------------
// Take the old car's lap times out: the day the league changes car mid-season.
//
// Two stores hold times driven in a car: the telemetry laps (lib/
// telemetryLaps.js) and the training times the live board carries (lib/
// liveBestLaps.js). After a car change the old car's times are worth nothing,
// but laps in the NEW car usually arrive before anybody gets round to tidying
// up, and those have to stay. So nothing here is all-or-nothing: every lap
// knows the car it was driven in (the folder name the game reports), and most
// know when, and the admin picks the car(s) to take out, optionally only laps
// recorded before a moment — for the case where the new car kept the old
// car's folder name and only the time tells them apart.
//
// Moved, not deleted, into WIPED_LAPS_DIR, one folder per wipe. Nothing reads
// it; it exists so a wipe of the wrong car is a file move to undo rather than
// a lost week.
//
// The session the race server is in right now is the route's half of it
// (routes/admin.js): those times live on the race server, not here, and the
// only way to take them off the board is to block each lap.
// ---------------------------------------------------------------------------
import { dirname, join } from "path";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { WIPED_LAPS_DIR } from "./dataDirs.js";
import { seasonLapFiles, seriesKeyOf, seasonKeyOf } from "./telemetryLaps.js";
import { bestsFor, listTracks, takeLapsWhere } from "./liveBestLaps.js";

// One telemetry lap file, as much as the wipe needs of it: the car, and when
// it was recorded (the file's own time for laps from before that was stamped).
function telemetryLapInfo(file) {
  let car = "";
  let at = null;
  try {
    const lap = JSON.parse(readFileSync(file.path, "utf8"));
    car = String(lap.car || "");
    at = lap.recordedAt ? String(lap.recordedAt) : null;
  } catch {
    /* unreadable: a lap of no known car, which the "(unknown)" row covers */
  }
  if (!at) {
    try {
      at = statSync(file.path).mtime.toISOString();
    } catch {
      at = null;
    }
  }
  return { ...file, car, at };
}

// The filter an admin sets: which cars ("" is laps that never said), and
// optionally only laps recorded before a moment. No car picked is no wipe —
// "everything" is never what a car change means.
export function lapFilter({ cars, before } = {}) {
  const picked = new Set((Array.isArray(cars) ? cars : []).map((c) => String(c ?? "")));
  const cutoff = before ? Date.parse(before) : NaN;
  const hasCutoff = Number.isFinite(cutoff);
  const fn = (car, at) => {
    if (!picked.has(String(car || ""))) return false;
    if (!hasCutoff) return true;
    const t = at ? Date.parse(at) : NaN;
    // A lap with no time at all cannot be shown to be older: it stays.
    return Number.isFinite(t) && t < cutoff;
  };
  fn.empty = picked.size === 0;
  return fn;
}

// What one series' season holds, car by car: telemetry laps, carried board
// times, the laps of the session the server is in now (handed in by the route,
// which reads the board), and the first and last time each car was seen.
export function wipePreview(series, season, liveLaps = []) {
  const byCar = new Map();
  const row = (car) => {
    const key = String(car || "");
    if (!byCar.has(key)) byCar.set(key, { car: key, telemetryLaps: 0, boardLaps: 0, liveLaps: 0, firstAt: null, lastAt: null });
    return byCar.get(key);
  };
  const seen = (r, raw) => {
    // One shape for every stamp, so they compare as strings.
    const t = raw ? Date.parse(raw) : NaN;
    if (!Number.isFinite(t)) return;
    const at = new Date(t).toISOString();
    if (!r.firstAt || at < r.firstAt) r.firstAt = at;
    if (!r.lastAt || at > r.lastAt) r.lastAt = at;
  };
  for (const f of seasonLapFiles(series, season, true).map(telemetryLapInfo)) {
    const r = row(f.car);
    r.telemetryLaps += 1;
    seen(r, f.at);
  }
  for (const t of listTracks(series, season)) {
    for (const lap of bestsFor(series, season, t.trackKey)) {
      const r = row(lap.car);
      r.boardLaps += 1;
      seen(r, lap.recordedAt);
    }
  }
  for (const lap of liveLaps) row(lap.car).liveLaps += 1;
  return {
    cars: [...byCar.values()].sort((a, b) => String(b.lastAt || "").localeCompare(String(a.lastAt || ""))),
  };
}

// Take what the filter picks. `dryRun` only counts, for the question before
// the real thing.
export function wipeSeasonTimes(series, season, filter, { dryRun = false } = {}) {
  if (filter.empty) return { telemetryLaps: 0, boardLaps: 0, archivedTo: null };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const home = join(WIPED_LAPS_DIR, `${stamp}_${seriesKeyOf(series)}_${seasonKeyOf(season)}`);

  const telemetry = seasonLapFiles(series, season, true)
    .map(telemetryLapInfo)
    .filter((f) => filter(f.car, f.at));
  if (dryRun) {
    let boardLaps = 0;
    for (const t of listTracks(series, season)) {
      boardLaps += bestsFor(series, season, t.trackKey).filter((l) => filter(l.car, l.recordedAt)).length;
    }
    return { telemetryLaps: telemetry.length, boardLaps, archivedTo: null };
  }

  let telemetryLaps = 0;
  for (const f of telemetry) {
    const to = join(home, "telemetry-laps", f.rel);
    try {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(f.path, to);
      telemetryLaps += 1;
    } catch {
      // Locked or on another disk: it still has to go, the point is that the
      // old car is not read again.
      try {
        unlinkSync(f.path);
        telemetryLaps += 1;
      } catch {
        /* left for the next press */
      }
    }
  }

  const taken = takeLapsWhere(series, season, (lap) => filter(lap.car, lap.recordedAt));
  if (taken.length) {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "live-best-laps.json"), JSON.stringify(taken));
  }
  return { telemetryLaps, boardLaps: taken.length, archivedTo: telemetryLaps || taken.length ? home : null };
}
