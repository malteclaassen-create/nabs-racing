import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE_BEST_LAPS_DIR, WIPED_LAPS_DIR } from "./dataDirs.js";
import { TELEMETRY_LAPS_DIR, seriesKeyOf, storedSummary } from "./telemetryLaps.js";
import { addUploadedLaps, bestsFor, listTracks, __clearCache } from "./liveBestLaps.js";
import { lapFilter, wipePreview, wipeSeasonTimes } from "./lapWipe.js";

// The car changed mid-season, and laps in the new car have already arrived:
// the old car's times go, the new car's stay, other series and seasons are
// untouched, and nothing is deleted outright.

const SERIES = "wipe-test-series";
const OTHER = "wipe-test-other";
const SEASON = 8;
const A = "76561198000000001";
const B = "76561198000000002";
const OLD = "old_car";
const NEW = "new_car";

function telemetryLap(series, season, track, steamId, ms, car, recordedAt = "2026-11-10T20:00:00.000Z") {
  const dir = join(TELEMETRY_LAPS_DIR, seriesKeyOf(series), `s${season}`, track, steamId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${ms}.json`), JSON.stringify({ lapTimeMs: ms, car, recordedAt }));
}

const carried = (series, track, laps) =>
  addUploadedLaps(series, SEASON, track, {
    track,
    layout: "",
    laps: laps.map(([steamId, lapTimeMs, car, recordedAt]) => ({ steamId, name: steamId, car, lapTimeMs, recordedAt })),
    file: { name: "session.json", type: "PRACTICE" },
  });

function clean() {
  for (const s of [SERIES, OTHER]) {
    rmSync(join(TELEMETRY_LAPS_DIR, seriesKeyOf(s)), { recursive: true, force: true });
    rmSync(join(LIVE_BEST_LAPS_DIR, seriesKeyOf(s)), { recursive: true, force: true });
  }
  try {
    for (const name of readdirSync(WIPED_LAPS_DIR)) {
      if (name.includes(SERIES)) rmSync(join(WIPED_LAPS_DIR, name), { recursive: true, force: true });
    }
  } catch {
    /* no archive folder yet */
  }
  __clearCache();
}
beforeEach(clean);
afterEach(clean);

describe("lapWipe", () => {
  beforeEach(() => {
    telemetryLap(SERIES, SEASON, "monza", A, 95_000, OLD);
    telemetryLap(SERIES, SEASON, "monza", A, 97_000, NEW, "2026-11-25T20:00:00.000Z");
    // Another layout of the same circuit: the board reads them as one.
    telemetryLap(SERIES, SEASON, "monza--junior", B, 70_000, OLD);
    // Another track, last season, another league: never touched.
    telemetryLap(SERIES, SEASON, "spa", B, 120_000, OLD);
    telemetryLap(SERIES, 7, "monza", A, 99_000, OLD);
    telemetryLap(OTHER, SEASON, "monza", A, 97_000, OLD);

    carried(SERIES, "monza", [[A, 95_500, OLD, "2026-11-10T20:00:00Z"], [B, 96_000, NEW, "2026-11-25T20:00:00Z"]]);
    carried(SERIES, "spa", [[A, 121_000, OLD, "2026-11-11T20:00:00Z"]]);
    carried(OTHER, "monza", [[A, 94_000, OLD]]);
  });

  it("counts the season circuit by circuit, car by car, newest first", () => {
    const { circuits } = wipePreview(SERIES, SEASON);
    expect(circuits.map((c) => c.circuit)).toEqual(["monza", "spa"]);
    const monza = circuits[0];
    expect(monza.cars.map((c) => c.car)).toEqual([NEW, OLD]);
    expect(monza.cars[0]).toMatchObject({ telemetryLaps: 1, boardLaps: 1, lastAt: "2026-11-25T20:00:00.000Z" });
    expect(monza.cars[1]).toMatchObject({ telemetryLaps: 2, boardLaps: 1, firstAt: "2026-11-10T20:00:00.000Z" });
  });

  it("takes only that circuit and that car, and keeps a copy", () => {
    const filter = lapFilter({ circuit: "monza", cars: [OLD] });
    expect(wipeSeasonTimes(SERIES, SEASON, filter, { dryRun: true })).toMatchObject({ telemetryLaps: 2, boardLaps: 1 });
    // A dry run changes nothing.
    expect(storedSummary(SERIES, SEASON, true).laps).toBe(4);

    const done = wipeSeasonTimes(SERIES, SEASON, filter);
    expect(done).toMatchObject({ telemetryLaps: 2, boardLaps: 1 });

    // Monza in the new car stays, and Spa is untouched.
    expect(storedSummary(SERIES, SEASON, true).laps).toBe(2);
    expect(bestsFor(SERIES, SEASON, "monza").map((l) => l.car)).toEqual([NEW]);
    expect(bestsFor(SERIES, SEASON, "spa")).toHaveLength(1);

    expect(existsSync(join(done.archivedTo, "telemetry-laps", "s8", "monza", A, "95000.json"))).toBe(true);
    expect(existsSync(join(done.archivedTo, "live-best-laps.json"))).toBe(true);

    expect(storedSummary(SERIES, 7).laps).toBe(1);
    expect(storedSummary(OTHER, SEASON).laps).toBe(1);
    expect(listTracks(OTHER, SEASON)).toHaveLength(1);
  });

  it("with a cutoff, keeps what the same car drove after it (a new data file keeps the name)", () => {
    telemetryLap(SERIES, SEASON, "monza", B, 94_000, OLD, "2026-11-24T20:00:00.000Z");
    const done = wipeSeasonTimes(SERIES, SEASON, lapFilter({ circuit: "monza", cars: [OLD], before: "2026-11-20T00:00:00Z" }));
    expect(done).toMatchObject({ telemetryLaps: 2, boardLaps: 1 });
    expect(storedSummary(SERIES, SEASON, true).laps).toBe(3);
  });

  it("does nothing without a track or a car picked", () => {
    expect(wipeSeasonTimes(SERIES, SEASON, lapFilter({ circuit: "monza", cars: [] }))).toMatchObject({ telemetryLaps: 0 });
    expect(wipeSeasonTimes(SERIES, SEASON, lapFilter({ circuit: "", cars: [OLD] }))).toMatchObject({ telemetryLaps: 0 });
    expect(storedSummary(SERIES, SEASON, true).laps).toBe(4);
  });
});
