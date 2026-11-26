// ---------------------------------------------------------------------------
// Start the lap times again: the day the league changes car mid-season.
//
// Two stores hold times driven in the car, and both stop meaning anything the
// moment the car is different: the telemetry laps (lib/telemetryLaps.js) and
// the training times the live board carries (lib/liveBestLaps.js), plus any
// "server reset, keep the times?" question still waiting (lib/liveResetKeep
// .js), whose laps were driven in the old car too. Normally a new SEASON is
// what clears them, because the car changes with it; this is the same thing
// for one series' running season, on an admin's say.
//
// Moved, not deleted, into WIPED_LAPS_DIR, one folder per wipe. Nothing reads
// it; it exists so a wipe on the wrong series is a file move to undo rather
// than a lost week.
//
// The session the race server is in right now is the route's half of it
// (routes/admin.js): those times live on the race server, not here, and the
// only way to take them off the board is to block each lap.
// ---------------------------------------------------------------------------
import { join } from "path";
import { WIPED_LAPS_DIR } from "./dataDirs.js";
import { archiveSeason, storedSummary, seriesKeyOf, seasonKeyOf } from "./telemetryLaps.js";
import { archiveSeasonRecords, listTracks } from "./liveBestLaps.js";
import { pendingFor, discard } from "./liveResetKeep.js";

// What a wipe would take, for the question before it.
export function wipePreview(series, season) {
  const tracks = listTracks(series, season);
  return {
    telemetryLaps: storedSummary(series, season, true).laps,
    boardTracks: tracks.length,
    boardLaps: tracks.reduce((n, t) => n + (t.laps || 0), 0),
    pending: pendingFor(series, season).length,
  };
}

// Take it all. The season asked for is always the one running now (the route
// decides), so the pre-season telemetry folders go with it: they are read as
// part of that season.
export function wipeSeasonTimes(series, season) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const home = join(WIPED_LAPS_DIR, `${stamp}_${seriesKeyOf(series)}_${seasonKeyOf(season)}`);
  const telemetryLaps = archiveSeason(series, season, join(home, "telemetry-laps"), true);
  const board = archiveSeasonRecords(series, season, join(home, "live-best-laps"));
  let pending = 0;
  for (const p of pendingFor(series, season)) if (discard(p.id)) pending += 1;
  return { telemetryLaps, boardTracks: board.tracks, boardLaps: board.laps, pending, archivedTo: home };
}
