import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE_BEST_LAPS_DIR, WIPED_LAPS_DIR } from "./dataDirs.js";
import { TELEMETRY_LAPS_DIR, seriesKeyOf, storedSummary } from "./telemetryLaps.js";
import { addUploadedLaps, currentBests, listTracks, setBoardScopes, __clearCache } from "./liveBestLaps.js";
import { wipePreview, wipeSeasonTimes } from "./lapWipe.js";

// The car changed mid-season: one series' running season loses its telemetry
// laps and its carried training times, the other series and other seasons
// keep theirs, and nothing is deleted outright.

const SERIES = "wipe-test-series";
const OTHER = "wipe-test-other";
const SEASON = 8;
const A = "76561198000000001";
const B = "76561198000000002";

function telemetryLap(series, season, track, steamId, ms) {
  const dir = join(TELEMETRY_LAPS_DIR, seriesKeyOf(series), `s${season}`, track, steamId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${ms}.json`), JSON.stringify({ lapTimeMs: ms }));
}

const carried = (series, season, laps) =>
  addUploadedLaps(series, season, "monza", {
    track: "ks_monza",
    layout: "",
    laps: laps.map(([steamId, lapTimeMs]) => ({ steamId, name: steamId, car: "old_car", lapTimeMs })),
    file: { name: "session.json", type: "PRACTICE" },
  });

function clean() {
  for (const s of [SERIES, OTHER]) {
    rmSync(join(TELEMETRY_LAPS_DIR, seriesKeyOf(s)), { recursive: true, force: true });
    rmSync(join(LIVE_BEST_LAPS_DIR, seriesKeyOf(s)), { recursive: true, force: true });
  }
  if (existsSync(WIPED_LAPS_DIR)) {
    for (const name of readdirSync(WIPED_LAPS_DIR)) {
      if (name.includes(SERIES)) rmSync(join(WIPED_LAPS_DIR, name), { recursive: true, force: true });
    }
  }
  __clearCache();
}
beforeEach(clean);
afterEach(clean);

describe("lapWipe", () => {
  it("takes the season's telemetry and carried times, and only that series' running season", () => {
    telemetryLap(SERIES, SEASON, "monza", A, 95_000);
    telemetryLap(SERIES, SEASON, "spa", B, 120_000);
    // A pre-season track folder, read as part of the running season.
    const legacy = join(TELEMETRY_LAPS_DIR, seriesKeyOf(SERIES), "imola", A);
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "88000.json"), "{}");
    // Last season, and another league entirely: neither is touched.
    telemetryLap(SERIES, 7, "monza", A, 99_000);
    telemetryLap(OTHER, SEASON, "monza", A, 97_000);

    carried(SERIES, SEASON, [[A, 95_000], [B, 96_000]]);
    carried(OTHER, SEASON, [[A, 94_000]]);
    setBoardScopes("wipe-test", [{ series: SERIES, season: SEASON }]);
    expect(currentBests("wipe-test", "monza")).toHaveLength(2);

    expect(wipePreview(SERIES, SEASON)).toEqual({ telemetryLaps: 3, boardTracks: 1, boardLaps: 2, pending: 0 });

    const done = wipeSeasonTimes(SERIES, SEASON);
    expect(done).toMatchObject({ telemetryLaps: 3, boardTracks: 1, boardLaps: 2, pending: 0 });

    // Gone from what the site reads, at once (the board's memo let go too).
    expect(storedSummary(SERIES, SEASON, true).laps).toBe(0);
    expect(listTracks(SERIES, SEASON)).toEqual([]);
    expect(currentBests("wipe-test", "monza")).toEqual([]);

    // Moved, not deleted.
    expect(existsSync(join(done.archivedTo, "telemetry-laps", "s8", "monza", A, "95000.json"))).toBe(true);
    expect(existsSync(join(done.archivedTo, "telemetry-laps", "pre-season", "imola", A, "88000.json"))).toBe(true);
    expect(existsSync(join(done.archivedTo, "live-best-laps", "monza.json"))).toBe(true);

    // Everything else stays.
    expect(storedSummary(SERIES, 7).laps).toBe(1);
    expect(storedSummary(OTHER, SEASON).laps).toBe(1);
    expect(listTracks(OTHER, SEASON)).toHaveLength(1);
  });

  it("is harmless on a season with nothing in it", () => {
    expect(wipeSeasonTimes(SERIES, SEASON)).toMatchObject({ telemetryLaps: 0, boardTracks: 0, boardLaps: 0, pending: 0 });
  });
});
