import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE_BEST_LAPS_DIR } from "./dataDirs.js";
import { TELEMETRY_LAPS_DIR, seriesKeyOf, seasonKeyOf } from "./telemetryLaps.js";
import {
  setBoardScopes,
  readSource,
  switchRecorder,
  clearTrack,
  listTracks,
  bestsFor,
  currentBests,
  addUploadedLaps,
  uploadedLaps,
  uploadedFiles,
  importEffect,
  __clearCache,
} from "./liveBestLaps.js";

// What the live board reads its training bests through. Two things are worth
// testing above all: that it is NOT a copy (a quicker lap landing in the
// recorder's store reaches the board without anybody pressing the button
// again), and that the SEASON is part of the key — last season's Baku must
// never come back with the calendar.

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

const S = [30_000, 32_000, 33_000];
const fileLap = (steamId, lapTimeMs, name, sectorsMs = S) => ({ steamId, name, car: "rss_f1", lapTimeMs, sectorsMs });
const give = (laps, { name = "session.json", season = SEASON, track = TRACK } = {}) =>
  addUploadedLaps(SERIES, season, track, { track: "ks_monza", layout: "", laps, file: { name, type: "PRACTICE" } });
const carry = ({ season = SEASON, track = TRACK } = {}) => switchRecorder(SERIES, season, track, { track });

function wipe() {
  rmSync(join(LIVE_BEST_LAPS_DIR, seriesKeyOf(SERIES)), { recursive: true, force: true });
  rmSync(join(TELEMETRY_LAPS_DIR, seriesKeyOf(SERIES)), { recursive: true, force: true });
  __clearCache();
}
beforeEach(() => {
  wipe();
  // The test server's board follows this series, whose active season is 8.
  setBoardScopes(SERVER, [{ series: SERIES, season: SEASON }]);
});
afterEach(wipe);

describe("liveBestLaps recorder", () => {
  it("carries the telemetry store's fastest lap per driver, fastest first", () => {
    recordLap(A, 95_000, { name: "Alice" });
    recordLap(B, 93_500, { name: "Bob" });
    carry();

    const laps = currentBests(SERVER, TRACK);
    expect(laps.map((l) => l.name)).toEqual(["Bob", "Alice"]);
    expect(laps[0].lapTimeMs).toBe(93_500);
    expect(laps[0].from).toBe("recorder");
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

  // The reason this is a switch and not a copy.
  it("a quicker lap driven afterwards reaches the board without touching the button", () => {
    recordLap(A, 95_000);
    carry();
    expect(currentBests(SERVER, TRACK)[0].lapTimeMs).toBe(95_000);

    recordLap(A, 91_000); // the recorder posts a new personal best
    __clearCache(); // stand in for the read-through TTL expiring
    setBoardScopes(SERVER, [{ series: SERIES, season: SEASON }]);
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

  it("a track the recorder was never switched on for carries nothing", () => {
    recordLap(A, 95_000);
    expect(readSource(SERIES, SEASON, TRACK)).toBeNull();
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });

  it("the switch reads this season's store, never an older one", () => {
    recordLap(A, 95_000, { name: "Alice", season: SEASON });
    recordLap(B, 80_000, { name: "LastSeasonBob", season: SEASON - 1 });
    carry();
    expect(currentBests(SERVER, TRACK).map((l) => l.name)).toEqual(["Alice"]);
  });

  it("switching on with no store behind it carries nothing rather than everything", () => {
    carry();
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });

  it("refuses a switch that names no series, season or track", () => {
    expect(() => switchRecorder("", SEASON, TRACK)).toThrow();
    expect(() => switchRecorder(SERIES, 0, TRACK)).toThrow();
    expect(() => switchRecorder(SERIES, SEASON, "../../etc/passwd")).toThrow();
    expect(existsSync(join(LIVE_BEST_LAPS_DIR, "..", "etc"))).toBe(false);
  });

  it("a broken file is no record, not an outage", () => {
    mkdirSync(join(LIVE_BEST_LAPS_DIR, seriesKeyOf(SERIES), seasonKeyOf(SEASON)), { recursive: true });
    writeFileSync(join(LIVE_BEST_LAPS_DIR, seriesKeyOf(SERIES), seasonKeyOf(SEASON), `${TRACK}.json`), "{ not json");
    __clearCache();
    setBoardScopes(SERVER, [{ series: SERIES, season: SEASON }]);
    expect(readSource(SERIES, SEASON, TRACK)).toBeNull();
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });
});

// Session files from the server manager: the source the league asked for.
describe("liveBestLaps uploaded files", () => {
  it("keeps a file's laps for the board, sectors and all", () => {
    const r = give([fileLap(A, 95_000, "Alice"), fileLap(B, 93_500, "Bob", [29_000, 32_000, 32_500])]);
    expect(r).toEqual({ kept: 2, read: 2, improved: 2 });

    const laps = currentBests(SERVER, TRACK);
    expect(laps.map((l) => l.name)).toEqual(["Bob", "Alice"]);
    expect(laps[0].sectorsMs).toEqual([29_000, 32_000, 32_500]);
    expect(laps[0].from).toBe("file");
    expect(uploadedFiles(SERIES, SEASON, TRACK).map((f) => f.name)).toEqual(["session.json"]);
  });

  it("a second file adds drivers and improves times, and never takes a time away", () => {
    give([fileLap(A, 95_000, "Alice")], { name: "monday.json" });
    const r = give([fileLap(A, 97_000, "Alice"), fileLap(B, 96_000, "Bob")], { name: "tuesday.json" });
    expect(r.improved).toBe(1); // Bob is new; Alice's Monday 1:35 stands
    expect(uploadedLaps(SERIES, SEASON, TRACK).map((l) => [l.name, l.lapTimeMs])).toEqual([["Alice", 95_000], ["Bob", 96_000]]);
    expect(uploadedFiles(SERIES, SEASON, TRACK)).toHaveLength(2);
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
    expect(uploadedLaps(SERIES, SEASON, TRACK)).toHaveLength(1);
    expect(readSource(SERIES, SEASON, TRACK)).not.toBeNull();
  });

  it("a file with nothing usable in it changes nothing", () => {
    give([fileLap(A, 95_000, "Alice")]);
    give([{ steamId: "nope", name: "Ghost", lapTimeMs: 90_000 }], { name: "empty.json" });
    expect(uploadedLaps(SERIES, SEASON, TRACK)).toHaveLength(1);
  });

  it("taking the track off the board takes the files with it", () => {
    give([fileLap(A, 95_000, "Alice")]);
    expect(clearTrack(SERIES, SEASON, TRACK)).toBe(true);
    expect(uploadedLaps(SERIES, SEASON, TRACK)).toEqual([]);
    expect(currentBests(SERVER, TRACK)).toEqual([]);
    expect(clearTrack(SERIES, SEASON, TRACK)).toBe(false); // already gone
  });

  it("lists what a season carries, with the count it carries right now", () => {
    give([fileLap(A, 95_000, "Alice")], { track: "monza" });
    give([fileLap(A, 104_000, "Alice"), fileLap(B, 103_000, "Bob")], { track: "spa--gp" });
    carry({ track: "spa--gp" });

    const list = listTracks(SERIES, SEASON);
    expect(list.map((t) => t.trackKey).sort()).toEqual(["monza", "spa--gp"]);
    expect(list.find((t) => t.trackKey === "spa--gp")).toMatchObject({ laps: 2, bestMs: 103_000, files: 1, recorder: true });
    expect(list.find((t) => t.trackKey === "monza")).toMatchObject({ laps: 1, recorder: false });
  });
});

// The rule the league stated outright: never across seasons.
describe("liveBestLaps seasons", () => {
  it("last season's files do not come back when the calendar returns to the track", () => {
    give([fileLap(A, 80_000, "LastSeasonAlice")], { season: SEASON - 1 });
    give([fileLap(B, 95_000, "Bob")], { season: SEASON });

    // The board reads the active season only.
    expect(currentBests(SERVER, TRACK).map((l) => l.name)).toEqual(["Bob"]);
    // …and what was filed under last season is still there, just not read.
    expect(bestsFor(SERIES, SEASON - 1, TRACK).map((l) => l.name)).toEqual(["LastSeasonAlice"]);
  });

  it("last season's recorder switch does not reach this season's board", () => {
    recordLap(A, 80_000, { name: "LastSeasonAlice", season: SEASON - 1 });
    carry({ season: SEASON - 1 }); // switched on last season, never switched off
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });

  it("the season moving on takes the old times off the board by itself", () => {
    give([fileLap(A, 95_000, "Alice")]);
    recordLap(B, 94_000, { name: "Bob" });
    carry();
    expect(currentBests(SERVER, TRACK)).toHaveLength(2);

    // The relay re-reads the active season and finds it has moved to 9.
    setBoardScopes(SERVER, [{ series: SERIES, season: SEASON + 1 }]);
    expect(currentBests(SERVER, TRACK)).toEqual([]);

    // Nothing was deleted: the new season simply starts empty, and this
    // season's record is where it was.
    expect(bestsFor(SERIES, SEASON, TRACK)).toHaveLength(2);
    expect(listTracks(SERIES, SEASON + 1)).toEqual([]);
  });

  it("a server no series follows carries nothing", () => {
    give([fileLap(A, 95_000, "Alice")]);
    expect(currentBests("nobody", TRACK)).toEqual([]);
    setBoardScopes(SERVER, []);
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });

  it("two series on one server each bring their own season's times", () => {
    give([fileLap(A, 95_000, "Alice")]);
    // The other league is in its first season, on the same server; its file
    // for the same track carries a different driver.
    addUploadedLaps("sunday-gt", 1, TRACK, {
      track: "ks_monza",
      layout: "",
      laps: [fileLap(B, 110_000, "SundayBob")],
      file: { name: "sunday.json", type: "PRACTICE" },
    });
    try {
      setBoardScopes(SERVER, [
        { series: SERIES, season: SEASON },
        { series: "sunday-gt", season: 1 },
      ]);
      expect(currentBests(SERVER, TRACK).map((l) => l.name)).toEqual(["Alice", "SundayBob"]);
    } finally {
      rmSync(join(LIVE_BEST_LAPS_DIR, "sunday-gt"), { recursive: true, force: true });
    }
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
