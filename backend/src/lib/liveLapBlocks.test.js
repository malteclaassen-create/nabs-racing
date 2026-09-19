import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { LIVE_BEST_LAPS_DIR, LIVE_LAP_BLOCKS_DIR } from "./dataDirs.js";
import { seriesKeyOf } from "./telemetryLaps.js";
import {
  setBoardScopes,
  addUploadedLaps,
  currentBests,
  circuitBests,
  removeLap,
  restoreLap,
  __clearCache as __clearLaps,
} from "./liveBestLaps.js";
import { listBlocks, blockLap, unblockLap, isBlocked, blockedKeysForScopes, __clearCache } from "./liveLapBlocks.js";

// Removing one training lap by hand. The promise the feature makes is not
// "it is gone from the file" but "it is off the board until that driver sets
// a different time", so what is tested is the ways it could come back.

const SERVER = "blocks";
// Its own series and server: the other live tests write the same folders,
// and vitest runs the files side by side.
const SERIES = "blocks-f1";
const SEASON = 8;
const TRACK = "monza";
const A = "76561198000000001";
const B = "76561198000000002";

const lap = (steamId, lapTimeMs, name) => ({ steamId, name, car: "rss_f1", lapTimeMs, sectorsMs: [30_000, 32_000, 33_000] });
const give = (laps, name = "session.json", track = TRACK) =>
  addUploadedLaps(SERIES, SEASON, track, { track: "ks_monza", layout: "", laps, file: { name, type: "PRACTICE" } });

function wipe() {
  rmSync(join(LIVE_BEST_LAPS_DIR, seriesKeyOf(SERIES)), { recursive: true, force: true });
  rmSync(join(LIVE_LAP_BLOCKS_DIR, seriesKeyOf(SERIES)), { recursive: true, force: true });
  __clearLaps();
  __clearCache();
}
beforeEach(() => {
  wipe();
  setBoardScopes(SERVER, [{ series: SERIES, season: SEASON }]);
});
afterEach(wipe);

// The whole removal, the way the admin route does it: out of the record, and
// blocked so it cannot come back.
function remove(steamId, lapTimeMs, trackKey = TRACK) {
  const gone = removeLap(SERIES, SEASON, trackKey, steamId, lapTimeMs);
  blockLap(SERIES, SEASON, TRACK, {
    steamId,
    name: gone?.name || "",
    lapTimeMs,
    trackKey: gone ? trackKey : null,
    lap: gone,
  });
  return gone;
}

describe("removing one training lap", () => {
  it("takes that lap off the board and leaves the rest alone", () => {
    give([lap(A, 95_000, "Alice"), lap(B, 93_500, "Bob")]);
    expect(remove(B, 93_500)).toMatchObject({ name: "Bob", lapTimeMs: 93_500 });
    expect(currentBests(SERVER, TRACK).map((l) => l.name)).toEqual(["Alice"]);
  });

  it("the same session file handed over again does not put it back", () => {
    give([lap(A, 95_000, "Alice"), lap(B, 93_500, "Bob")]);
    remove(B, 93_500);
    const again = give([lap(A, 95_000, "Alice"), lap(B, 93_500, "Bob")], "monday-again.json");
    expect(again.blocked).toBe(1);
    expect(currentBests(SERVER, TRACK).map((l) => l.name)).toEqual(["Alice"]);
  });

  it("a new time by the same driver is saved again", () => {
    give([lap(B, 93_500, "Bob")]);
    remove(B, 93_500);
    give([lap(B, 94_200, "Bob")], "tuesday.json");
    expect(currentBests(SERVER, TRACK).map((l) => l.lapTimeMs)).toEqual([94_200]);
  });

  it("only the lap that was removed, not the driver's other layout", () => {
    give([lap(A, 95_000, "Alice")], "monday.json", "monza--nabs-monza-2025");
    give([lap(A, 96_000, "Alice")], "tuesday.json", "monza--nabs-monza");
    // The board shows the quicker of the two; that is the one removed.
    remove(A, 95_000, "monza--nabs-monza-2025");
    expect(circuitBests(SERIES, SEASON, "monza--nabs-monza").laps.map((l) => l.lapTimeMs)).toEqual([96_000]);
  });

  it("the record file goes when its last lap does", () => {
    give([lap(A, 95_000, "Alice")]);
    remove(A, 95_000);
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });

  it("puts a lap back, block and all", () => {
    give([lap(A, 95_000, "Alice")]);
    remove(A, 95_000);
    const block = listBlocks(SERIES, SEASON, TRACK)[0];
    expect(block).toMatchObject({ name: "Alice", lapTimeMs: 95_000, trackKey: TRACK });

    const back = unblockLap(SERIES, SEASON, TRACK, block.id);
    restoreLap(SERIES, SEASON, back.trackKey, back.lap);
    expect(currentBests(SERVER, TRACK).map((l) => l.lapTimeMs)).toEqual([95_000]);
    expect(listBlocks(SERIES, SEASON, TRACK)).toEqual([]);
  });

  it("blocks a lap the race server is still holding, with nothing of ours to delete", () => {
    blockLap(SERIES, SEASON, TRACK, { steamId: A, name: "Alice", lapTimeMs: 91_000 });
    expect(isBlocked(SERIES, SEASON, TRACK, A, 91_000)).toBe(true);
    expect(isBlocked(SERIES, SEASON, TRACK, A, 91_001)).toBe(false);
    expect(blockedKeysForScopes([{ series: SERIES, season: SEASON }], TRACK)).toEqual(new Set([`${A}:91000`]));
  });

  it("removing the same lap twice is one entry", () => {
    blockLap(SERIES, SEASON, TRACK, { steamId: A, name: "Alice", lapTimeMs: 91_000 });
    blockLap(SERIES, SEASON, TRACK, { steamId: A, name: "Alice", lapTimeMs: 91_000 });
    expect(listBlocks(SERIES, SEASON, TRACK)).toHaveLength(1);
  });

  it("is filed per season: next season starts clean", () => {
    blockLap(SERIES, SEASON, TRACK, { steamId: A, name: "Alice", lapTimeMs: 91_000 });
    expect(isBlocked(SERIES, SEASON + 1, TRACK, A, 91_000)).toBe(false);
  });
});
