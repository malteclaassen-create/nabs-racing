import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE_BEST_LAPS_DIR } from "./dataDirs.js";
import { TELEMETRY_LAPS_DIR, seriesKeyOf, seasonKeyOf } from "./telemetryLaps.js";
import {
  readSource,
  addSource,
  clearTrack,
  listTracks,
  currentBests,
  addUploadedLaps,
  uploadedLaps,
  uploadedFiles,
  importEffect,
  __clearCache,
} from "./liveBestLaps.js";

// What the live board reads its training bests through. The thing worth
// testing is that it is NOT a copy: a quicker lap landing in the telemetry
// store has to reach the board without anybody pressing the button again.

const SERVER = "test";
const SERIES = "friday-f1";
const SEASON = 8;
const TRACK = "monza";
const A = "76561198000000001";
const B = "76561198000000002";

// A lap as the recorder leaves it on disk: the file is NAMED after its own lap
// time, which is what makes reading "who is quickest" free.
function recordLap(
  steamId,
  lapTimeMs,
  { name = "Alice", car = "f1", season = SEASON, track = TRACK, speed = [120, 250, 318.4, 90] } = {}
) {
  const dir = join(TELEMETRY_LAPS_DIR, seriesKeyOf(SERIES), seasonKeyOf(season), track, steamId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${lapTimeMs}.json`),
    JSON.stringify({ v: 1, steamId, name, car, track, layout: "", lapTimeMs, speed, recordedAt: "2026-09-01T10:00:00Z" })
  );
}

const carry = (track = TRACK) => addSource(SERVER, track, { series: SERIES, season: SEASON, track });

beforeEach(() => {
  rmSync(join(LIVE_BEST_LAPS_DIR, SERVER), { recursive: true, force: true });
  rmSync(join(TELEMETRY_LAPS_DIR, seriesKeyOf(SERIES)), { recursive: true, force: true });
  __clearCache();
});
afterEach(() => {
  rmSync(join(LIVE_BEST_LAPS_DIR, SERVER), { recursive: true, force: true });
  rmSync(join(TELEMETRY_LAPS_DIR, seriesKeyOf(SERIES)), { recursive: true, force: true });
  __clearCache();
});

describe("liveBestLaps", () => {
  it("carries the telemetry store's fastest lap per driver, fastest first", () => {
    recordLap(A, 95_000, { name: "Alice" });
    recordLap(B, 93_500, { name: "Bob" });
    carry();

    const laps = currentBests(SERVER, TRACK);
    expect(laps.map((l) => l.name)).toEqual(["Bob", "Alice"]);
    expect(laps[0].lapTimeMs).toBe(93_500);
  });

  it("carries the lap's top speed, read off the recorder's speed trace", () => {
    recordLap(A, 95_000, { speed: [100, 301.7, 250] });
    recordLap(B, 96_000, { name: "Bob", speed: null }); // a lap from before speeds were recorded
    carry();

    const [alice, bob] = currentBests(SERVER, TRACK);
    expect(alice.topSpeedKmh).toBe(301.7);
    expect(bob.topSpeedKmh).toBe(null);
  });

  it("one row per driver — their fastest, not all three", () => {
    recordLap(A, 95_000);
    recordLap(A, 92_000);
    recordLap(A, 99_000);
    carry();

    const laps = currentBests(SERVER, TRACK);
    expect(laps).toHaveLength(1);
    expect(laps[0].lapTimeMs).toBe(92_000);
  });

  // The reason this is a source and not a copy.
  it("a quicker lap driven afterwards reaches the board without touching the button", () => {
    recordLap(A, 95_000);
    carry();
    expect(currentBests(SERVER, TRACK)[0].lapTimeMs).toBe(95_000);

    recordLap(A, 91_000); // the recorder posts a new personal best
    __clearCache(); // stand in for the read-through TTL expiring
    expect(currentBests(SERVER, TRACK)[0].lapTimeMs).toBe(91_000);
  });

  // The same thing again, but proving the read-through actually expires rather
  // than relying on a test clearing the memo by hand.
  it("the board's read of the store goes stale on its own, within the minute", () => {
    const t0 = Date.UTC(2026, 8, 17, 18, 0, 0);
    vi.setSystemTime(t0);
    try {
      recordLap(A, 95_000);
      carry();
      expect(currentBests(SERVER, TRACK)[0].lapTimeMs).toBe(95_000);

      recordLap(A, 91_000);
      // Straight away the board is still on the memo it took a moment ago…
      expect(currentBests(SERVER, TRACK)[0].lapTimeMs).toBe(95_000);

      // …and half a minute later it has read the store again.
      vi.setSystemTime(t0 + 31_000);
      expect(currentBests(SERVER, TRACK)[0].lapTimeMs).toBe(91_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a driver who first appears after the switch was thrown is carried too", () => {
    recordLap(A, 95_000, { name: "Alice" });
    carry();

    recordLap(B, 96_000, { name: "Bob" });
    __clearCache();
    expect(currentBests(SERVER, TRACK).map((l) => l.name)).toEqual(["Alice", "Bob"]);
  });

  it("reads the season it was pointed at, and no other", () => {
    recordLap(A, 95_000, { name: "Alice", season: SEASON });
    recordLap(B, 80_000, { name: "LastSeasonBob", season: SEASON - 1 });
    carry();

    expect(currentBests(SERVER, TRACK).map((l) => l.name)).toEqual(["Alice"]);
  });

  it("a track that was never switched on carries nothing", () => {
    recordLap(A, 95_000);
    expect(readSource(SERVER, TRACK)).toBeNull();
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });

  it("taking a track off the board takes it off", () => {
    recordLap(A, 95_000);
    carry();
    expect(currentBests(SERVER, TRACK)).toHaveLength(1);

    expect(clearTrack(SERVER, TRACK)).toBe(true);
    expect(currentBests(SERVER, TRACK)).toEqual([]);
    expect(clearTrack(SERVER, TRACK)).toBe(false); // already gone
  });

  it("a switch with no store behind it carries nothing rather than everything", () => {
    carry();
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });

  it("refuses a switch that names no series or season", () => {
    expect(() => addSource(SERVER, TRACK, { series: "", season: SEASON })).toThrow();
    expect(() => addSource(SERVER, TRACK, { series: SERIES, season: 0 })).toThrow();
  });

  it("a broken line is no source, not an outage", () => {
    mkdirSync(join(LIVE_BEST_LAPS_DIR, SERVER), { recursive: true });
    writeFileSync(join(LIVE_BEST_LAPS_DIR, SERVER, `${TRACK}.json`), "{ this is not json");
    __clearCache();
    expect(readSource(SERVER, TRACK)).toBeNull();
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });

  it("refuses a track key that could walk out of its folder", () => {
    expect(() => addSource(SERVER, "../../etc/passwd", { series: SERIES, season: SEASON })).toThrow();
    expect(readSource(SERVER, "../../etc/passwd")).toBeNull();
    expect(existsSync(join(LIVE_BEST_LAPS_DIR, SERVER, "..", "..", "etc"))).toBe(false);
  });

  it("lists what a server carries, with the count it carries right now", () => {
    recordLap(A, 95_000, { track: "monza" });
    recordLap(A, 104_000, { track: "spa--gp" });
    recordLap(B, 103_000, { track: "spa--gp", name: "Bob" });
    carry("monza");
    carry("spa--gp");

    const list = listTracks(SERVER);
    expect(list.map((t) => t.trackKey).sort()).toEqual(["monza", "spa--gp"]);
    expect(list.find((t) => t.trackKey === "spa--gp")).toMatchObject({ laps: 2, bestMs: 103_000, recorder: { season: SEASON } });
  });

  it("an unknown server carries nothing", () => {
    expect(listTracks("nobody")).toEqual([]);
    expect(readSource("nobody", TRACK)).toBeNull();
  });
});

// Session files from the server manager: the source the league asked for.
describe("liveBestLaps uploaded files", () => {
  const S = [30_000, 32_000, 33_000];
  const fileLap = (steamId, lapTimeMs, name, sectorsMs = S) => ({ steamId, name, car: "rss_f1", lapTimeMs, sectorsMs });
  const give = (laps, name = "session.json") =>
    addUploadedLaps(SERVER, TRACK, { track: "ks_monza", layout: "", laps, file: { name, type: "PRACTICE" } });

  it("keeps a file's laps for the board, sectors and all", () => {
    const r = give([fileLap(A, 95_000, "Alice"), fileLap(B, 93_500, "Bob", [29_000, 32_000, 32_500])]);
    expect(r).toEqual({ kept: 2, read: 2, improved: 2 });

    const laps = currentBests(SERVER, TRACK);
    expect(laps.map((l) => l.name)).toEqual(["Bob", "Alice"]);
    expect(laps[0].sectorsMs).toEqual([29_000, 32_000, 32_500]);
    expect(laps[0].from).toBe("file");
    expect(uploadedFiles(SERVER, TRACK).map((f) => f.name)).toEqual(["session.json"]);
  });

  it("a second file adds drivers and improves times, and never takes a time away", () => {
    give([fileLap(A, 95_000, "Alice")], "monday.json");
    const r = give([fileLap(A, 97_000, "Alice"), fileLap(B, 96_000, "Bob")], "tuesday.json");
    expect(r.improved).toBe(1); // Bob is new; Alice's Monday 1:35 stands
    expect(uploadedLaps(SERVER, TRACK).map((l) => [l.name, l.lapTimeMs])).toEqual([["Alice", 95_000], ["Bob", 96_000]]);
    expect(uploadedFiles(SERVER, TRACK)).toHaveLength(2);
  });

  it("sectors that do not add up to the lap do not reach the board", () => {
    give([fileLap(A, 95_000, "Alice", [30_000, 30_000, 30_000])]);
    expect(currentBests(SERVER, TRACK)[0].sectorsMs).toBe(null);
  });

  it("files and the recorder share a board, faster wins, and a tie goes to the file", () => {
    recordLap(A, 95_000, { name: "Alice" }); // recorder: 1:35, no sectors
    recordLap(B, 94_000, { name: "Bob" }); // recorder: 1:34
    carry();
    give([fileLap(A, 95_000, "Alice"), fileLap(B, 96_000, "Bob")]); // file: same 1:35 with sectors; a slower Bob

    const laps = currentBests(SERVER, TRACK);
    const alice = laps.find((l) => l.name === "Alice");
    const bob = laps.find((l) => l.name === "Bob");
    expect(alice.from).toBe("file"); // same lap, and the file knows its sectors
    expect(alice.sectorsMs).toEqual(S);
    expect(bob.from).toBe("recorder"); // the quicker of the two, wherever from
    expect(bob.lapTimeMs).toBe(94_000);
  });

  it("switching the recorder on leaves the files' laps exactly as they were", () => {
    give([fileLap(A, 95_000, "Alice")]);
    carry();
    expect(uploadedLaps(SERVER, TRACK)).toHaveLength(1);
    expect(readSource(SERVER, TRACK)).not.toBeNull();
  });

  it("a file with nothing usable in it changes nothing", () => {
    give([fileLap(A, 95_000, "Alice")]);
    give([{ steamId: "nope", name: "Ghost", lapTimeMs: 90_000 }], "empty.json");
    expect(uploadedLaps(SERVER, TRACK)).toHaveLength(1);
  });

  it("taking the track off the board takes the files with it", () => {
    give([fileLap(A, 95_000, "Alice")]);
    expect(clearTrack(SERVER, TRACK)).toBe(true);
    expect(uploadedLaps(SERVER, TRACK)).toEqual([]);
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });
});

// The admin card's preview has to promise exactly what the board's merge will
// do, or the button lies about its own effect.
describe("importEffect", () => {
  it("a driver with nothing on the board is new", () => {
    expect(importEffect(95_000, {})).toBe("new");
    expect(importEffect(95_000, { liveMs: null, importedMs: null })).toBe("new");
  });

  it("a quicker stored lap takes the row", () => {
    expect(importEffect(93_000, { liveMs: 96_000 })).toBe("faster");
    expect(importEffect(93_000, { importedMs: 96_000 })).toBe("faster");
  });

  it("the same time changes nothing", () => {
    expect(importEffect(95_000, { liveMs: 95_000 })).toBe("same");
    expect(importEffect(95_000, { importedMs: 95_000 })).toBe("same");
  });

  it("a driver who has since gone quicker keeps their live lap", () => {
    expect(importEffect(96_000, { liveMs: 93_000 })).toBe("slower");
  });

  it("compares against whichever of the two the board is actually showing", () => {
    expect(importEffect(94_000, { liveMs: 93_000, importedMs: 96_000 })).toBe("slower");
    expect(importEffect(94_000, { liveMs: 96_000, importedMs: 93_000 })).toBe("slower");
    expect(importEffect(92_000, { liveMs: 96_000, importedMs: 93_000 })).toBe("faster");
  });
});
