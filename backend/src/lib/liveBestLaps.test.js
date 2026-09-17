import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE_BEST_LAPS_DIR } from "./dataDirs.js";
import { seriesKeyOf, seasonKeyOf } from "./telemetryLaps.js";
import {
  setBoardScopes,
  clearTrack,
  listTracks,
  bestsFor,
  circuitBests,
  baseTrackOf,
  currentBests,
  addUploadedLaps,
  uploadedFiles,
  __clearCache,
} from "./liveBestLaps.js";

// What the live board reads its training bests through: the laps kept from
// the server manager's session files. Two things are worth testing above all:
// a second file never takes a time away, and the SEASON is part of the key —
// last season's Baku must never come back with the calendar.

const SERVER = "test";
const SERIES = "friday-f1";
const SEASON = 8;
const TRACK = "monza";
const A = "76561198000000001";
const B = "76561198000000002";

const S = [30_000, 32_000, 33_000];
const fileLap = (steamId, lapTimeMs, name, sectorsMs = S) => ({ steamId, name, car: "rss_f1", lapTimeMs, sectorsMs });
const give = (laps, { name = "session.json", season = SEASON, track = TRACK } = {}) =>
  addUploadedLaps(SERIES, season, track, { track: "ks_monza", layout: "", laps, file: { name, type: "PRACTICE" } });

function wipe() {
  rmSync(join(LIVE_BEST_LAPS_DIR, seriesKeyOf(SERIES)), { recursive: true, force: true });
  __clearCache();
}
beforeEach(() => {
  wipe();
  // The test server's board follows this series, whose active season is 8.
  setBoardScopes(SERVER, [{ series: SERIES, season: SEASON }]);
});
afterEach(wipe);

describe("liveBestLaps files", () => {
  it("keeps a file's laps for the board, fastest first, sectors and all", () => {
    const r = give([fileLap(A, 95_000, "Alice"), fileLap(B, 93_500, "Bob", [29_000, 32_000, 32_500])]);
    expect(r).toEqual({ kept: 2, read: 2, improved: 2 });

    const laps = currentBests(SERVER, TRACK);
    expect(laps.map((l) => l.name)).toEqual(["Bob", "Alice"]);
    expect(laps[0].sectorsMs).toEqual([29_000, 32_000, 32_500]);
    expect(uploadedFiles(SERIES, SEASON, TRACK).map((f) => f.name)).toEqual(["session.json"]);
  });

  it("a second file adds drivers and improves times, and never takes a time away", () => {
    give([fileLap(A, 95_000, "Alice")], { name: "monday.json" });
    const r = give([fileLap(A, 97_000, "Alice"), fileLap(B, 96_000, "Bob")], { name: "tuesday.json" });
    expect(r.improved).toBe(1); // Bob is new; Alice's Monday 1:35 stands
    expect(bestsFor(SERIES, SEASON, TRACK).map((l) => [l.name, l.lapTimeMs])).toEqual([["Alice", 95_000], ["Bob", 96_000]]);
    expect(uploadedFiles(SERIES, SEASON, TRACK)).toHaveLength(2);
  });

  it("two files of the same driver add up: quicker lap, best of each sector, laps summed, later last lap", () => {
    give(
      [{ ...fileLap(A, 95_000, "Alice"), tyre: "M", bestSectorsMs: [30_000, 32_000, 33_000], lapCount: 10, lastLapMs: 97_000, lastAt: 100 }],
      { name: "monday.json" }
    );
    give(
      [{ ...fileLap(A, 94_000, "Alice", [29_500, 31_500, 33_000]), tyre: "SS", bestSectorsMs: [29_500, 31_500, 34_000], lapCount: 6, lastLapMs: 99_000, lastAt: 200 }],
      { name: "tuesday.json" }
    );
    const [a] = bestsFor(SERIES, SEASON, TRACK);
    expect(a.lapTimeMs).toBe(94_000);
    expect(a.tyre).toBe("SS"); // the quicker lap's
    expect(a.bestSectorsMs).toEqual([29_500, 31_500, 33_000]); // S3 from Monday
    expect(a.lapCount).toBe(16);
    expect(a.lastLapMs).toBe(99_000); // Tuesday's, the later file
  });

  it("the same time in two files is the same lap, and the copy with sectors is kept", () => {
    give([fileLap(A, 95_000, "Alice", null)], { name: "stripped.json" });
    give([fileLap(A, 95_000, "Alice")], { name: "full.json" });
    expect(bestsFor(SERIES, SEASON, TRACK)[0].sectorsMs).toEqual(S);
  });

  it("sectors that do not add up to the lap do not reach the board", () => {
    give([fileLap(A, 95_000, "Alice", [30_000, 30_000, 30_000])]);
    expect(currentBests(SERVER, TRACK)[0].sectorsMs).toBe(null);
  });

  it("rows that are not laps are dropped on the way in", () => {
    give([
      fileLap(A, 95_000, "Alice"),
      fileLap("not-a-steam-id", 95_000, "Ghost"),
      fileLap(B, 5, "Impossible"), // under the 20s floor
      { steamId: B, lapTimeMs: 95_000 }, // no name
      fileLap(B, 94_000, "Bob, Cara, Dan"), // the server manager's shared-car row
    ]);
    expect(bestsFor(SERIES, SEASON, TRACK).map((l) => l.name)).toEqual(["Alice"]);
  });

  // Records written before the parser stopped producing shared-car rows still
  // hold them; the read is what keeps them off the board until the files are
  // given again.
  it("a shared-car row already on disk stays off the board", () => {
    give([fileLap(A, 95_000, "Alice")]);
    const path = join(LIVE_BEST_LAPS_DIR, seriesKeyOf(SERIES), seasonKeyOf(SEASON), `${TRACK}.json`);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    raw.laps.push({ steamId: B, name: "Bob, Cara, Dan", car: "rss_f1", lapTimeMs: 90_000, sectorsMs: null });
    writeFileSync(path, JSON.stringify(raw));
    __clearCache();
    setBoardScopes(SERVER, [{ series: SERIES, season: SEASON }]);
    expect(currentBests(SERVER, TRACK).map((l) => l.name)).toEqual(["Alice"]);
  });

  it("a file with nothing usable in it changes nothing, and is not listed", () => {
    give([fileLap(A, 95_000, "Alice")]);
    give([{ steamId: "nope", name: "Ghost", lapTimeMs: 90_000 }], { name: "empty.json" });
    expect(bestsFor(SERIES, SEASON, TRACK)).toHaveLength(1);
    expect(uploadedFiles(SERIES, SEASON, TRACK).map((f) => f.name)).toEqual(["session.json"]);
  });

  it("a track nothing has been given for carries nothing", () => {
    expect(bestsFor(SERIES, SEASON, TRACK)).toEqual([]);
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });

  it("taking the track off the board takes the files with it", () => {
    give([fileLap(A, 95_000, "Alice")]);
    expect(clearTrack(SERIES, SEASON, TRACK)).toBe(true);
    expect(bestsFor(SERIES, SEASON, TRACK)).toEqual([]);
    expect(currentBests(SERVER, TRACK)).toEqual([]);
    expect(clearTrack(SERIES, SEASON, TRACK)).toBe(false); // already gone
  });

  it("refuses a track key that could walk out of its folder", () => {
    expect(() => give([fileLap(A, 95_000, "Alice")], { track: "../../etc/passwd" })).toThrow();
    expect(existsSync(join(LIVE_BEST_LAPS_DIR, "..", "etc"))).toBe(false);
  });

  it("a broken file is no record, not an outage", () => {
    mkdirSync(join(LIVE_BEST_LAPS_DIR, seriesKeyOf(SERIES), seasonKeyOf(SEASON)), { recursive: true });
    writeFileSync(join(LIVE_BEST_LAPS_DIR, seriesKeyOf(SERIES), seasonKeyOf(SEASON), `${TRACK}.json`), "{ not json");
    __clearCache();
    setBoardScopes(SERVER, [{ series: SERIES, season: SEASON }]);
    expect(currentBests(SERVER, TRACK)).toEqual([]);
  });

  it("lists what a season carries", () => {
    give([fileLap(A, 95_000, "Alice")], { track: "monza" });
    give([fileLap(A, 104_000, "Alice"), fileLap(B, 103_000, "Bob")], { track: "spa--gp" });

    const list = listTracks(SERIES, SEASON);
    expect(list.map((t) => t.trackKey).sort()).toEqual(["monza", "spa--gp"]);
    expect(list.find((t) => t.trackKey === "spa--gp")).toMatchObject({ laps: 2, bestMs: 103_000, files: 1 });
  });
});

// The other rule the league stated outright, in its very first message: a
// track change is usually not a change. The league renames its layouts between
// weeks, and the board must not lose the week's laps to a suffix.
describe("liveBestLaps circuits", () => {
  it("a layout name is not part of the circuit", () => {
    expect(baseTrackOf("baku-2022--nabs-baku")).toBe("baku-2022");
    expect(baseTrackOf("baku-2022--nabs-baku-2025")).toBe("baku-2022");
    expect(baseTrackOf("monza")).toBe("monza");
    expect(baseTrackOf("")).toBe("");
  });

  it("the board carries every layout of the circuit it is on", () => {
    give([fileLap(A, 100_000, "MondayAlice")], { track: "baku-2022--nabs-baku-2025" });
    give([fileLap(B, 99_000, "Bob")], { track: "baku-2022--nabs-baku" });

    // The server is on this week's layout name; Monday's laps come along.
    const laps = currentBests(SERVER, "baku-2022--nabs-baku");
    expect(laps.map((l) => [l.name, l.trackKey])).toEqual([
      ["Bob", "baku-2022--nabs-baku"],
      ["MondayAlice", "baku-2022--nabs-baku-2025"],
    ]);
    // …and the other way round, the same laps on the old name.
    expect(currentBests(SERVER, "baku-2022--nabs-baku-2025").map((l) => l.name)).toEqual(["Bob", "MondayAlice"]);
    expect(circuitBests(SERIES, SEASON, "baku-2022").keys.sort()).toEqual(["baku-2022--nabs-baku", "baku-2022--nabs-baku-2025"]);
  });

  it("the same driver on two layouts is one row, their quicker lap", () => {
    give([fileLap(A, 100_000, "Alice")], { track: "baku-2022--nabs-baku-2025" });
    give([fileLap(A, 98_000, "Alice")], { track: "baku-2022--nabs-baku" });
    const laps = currentBests(SERVER, "baku-2022--nabs-baku");
    expect(laps).toHaveLength(1);
    expect(laps[0].lapTimeMs).toBe(98_000);
  });

  it("a different circuit is not carried, however similar its name", () => {
    give([fileLap(A, 100_000, "Alice")], { track: "baku-2022--nabs-baku" });
    give([fileLap(B, 60_000, "Bob")], { track: "baku-2022-short" }); // another folder, another track
    expect(currentBests(SERVER, "baku-2022--nabs-baku").map((l) => l.name)).toEqual(["Alice"]);
    expect(currentBests(SERVER, "baku-2022-short").map((l) => l.name)).toEqual(["Bob"]);
  });

  it("a record written after the key list was read is seen", () => {
    give([fileLap(A, 100_000, "Alice")], { track: "baku-2022--nabs-baku" });
    expect(currentBests(SERVER, "baku-2022--nabs-baku")).toHaveLength(1); // memoises the key list
    give([fileLap(B, 99_000, "Bob")], { track: "baku-2022--nabs-baku-2025" });
    expect(currentBests(SERVER, "baku-2022--nabs-baku")).toHaveLength(2);
    clearTrack(SERIES, SEASON, "baku-2022--nabs-baku-2025");
    expect(currentBests(SERVER, "baku-2022--nabs-baku")).toHaveLength(1);
  });
});

// The rule the league stated outright: never across seasons.
describe("liveBestLaps seasons", () => {
  it("last season's files do not come back when the calendar returns to the track", () => {
    give([fileLap(A, 80_000, "LastSeasonAlice")], { season: SEASON - 1 });
    give([fileLap(B, 95_000, "Bob")], { season: SEASON });

    // The board reads the active season only…
    expect(currentBests(SERVER, TRACK).map((l) => l.name)).toEqual(["Bob"]);
    // …and what was filed under last season is still there, just not read.
    expect(bestsFor(SERIES, SEASON - 1, TRACK).map((l) => l.name)).toEqual(["LastSeasonAlice"]);
  });

  it("the season moving on takes the old times off the board by itself", () => {
    give([fileLap(A, 95_000, "Alice")]);
    expect(currentBests(SERVER, TRACK)).toHaveLength(1);

    // The relay re-reads the active season and finds it has moved to 9.
    setBoardScopes(SERVER, [{ series: SERIES, season: SEASON + 1 }]);
    expect(currentBests(SERVER, TRACK)).toEqual([]);

    // Nothing was deleted: the new season simply starts empty, and this
    // season's record is where it was.
    expect(bestsFor(SERIES, SEASON, TRACK)).toHaveLength(1);
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
