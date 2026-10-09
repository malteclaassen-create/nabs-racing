import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TELEMETRY_LAPS_DIR } from "./telemetryLaps.js";
import { linesFromLap, noteSplits, lapArrived, sectorLinesFor, learnFromCarried, __useFile } from "./sectorLines.js";

// A lap of 101 slices, one second apart: slice i is i% of the way round and
// i seconds into the lap, so a split of 35 s is a line at 35%.
const lap = (over = {}) => ({ trackKey: "zz-sector-test--gp", steamId: "76561198000000777", n: 101, lapTimeMs: 100000, t: Array.from({ length: 101 }, (_, i) => i * 1000), ...over });

const SERIES_DIR = join(TELEMETRY_LAPS_DIR, "zz-sector-test");
let file;
beforeEach(() => {
  file = join(tmpdir(), `sector-lines-${process.pid}-${Date.now()}.json`);
  __useFile(file);
});
afterEach(() => {
  rmSync(SERIES_DIR, { recursive: true, force: true });
  if (existsSync(file)) rmSync(file);
});

describe("sector lines", () => {
  it("are where the lap's own clock reaches the server's splits", () => {
    expect(linesFromLap(lap(), [35000, 36000, 29000])).toEqual([35, 71]);
    expect(linesFromLap(lap(), [35500, 36000, 28500])).toEqual([35.5, 71.5]);
  });

  it("refuse splits of another lap, and sectors too short to be real", () => {
    expect(linesFromLap(lap(), [35000, 36000, 29100])).toBeNull();
    expect(linesFromLap(lap(), [2000, 69000, 29000])).toBeNull();
  });

  it("are learned when the board's splits and a stored lap meet, either way round", () => {
    noteSplits("zz-sector-test--gp", "76561198000000777", 100000, [35000, 36000, 29000]);
    expect(sectorLinesFor("zz-sector-test--gp")).toBeNull();
    lapArrived(lap());
    expect(sectorLinesFor("zz-sector-test--gp")).toEqual([35, 71]);
    // Another layout of the same circuit borrows them.
    expect(sectorLinesFor("zz-sector-test--short")).toEqual([35, 71]);
    expect(sectorLinesFor("zz-other--gp")).toBeNull();
  });

  it("are learned from a lap already on disk when the board shows its splits later", () => {
    const dir = join(SERIES_DIR, "s3", "zz-sector-test--gp", "76561198000000777");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "100000.json"), JSON.stringify(lap()));
    noteSplits("zz-sector-test--gp", "76561198000000777", 100001, [35000, 36000, 29001]);
    expect(sectorLinesFor("zz-sector-test--gp")).toEqual([35, 71]);
  });

  it("can come from a carried practice lap", () => {
    const lines = learnFromCarried("zz-sector-test--gp",
      [{ steamId: "76561198000000777", lapTimeMs: 100000, sectorsMs: [40000, 30000, 30000] }],
      [{ steamId: "76561198000000777", lapTimeMs: 100000, lapId: "100000" }],
      () => lap());
    expect(lines).toEqual([40, 70]);
  });
});
