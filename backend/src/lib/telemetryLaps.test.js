// What the lap store keeps, what it throws away, and which series and season it
// puts it in.
//
// The store is deliberately small — three laps per driver per track — so the
// interesting behaviour is all at the edges: the fourth lap, the lap that ties
// an existing one, the lap that is slower than everything already there, and
// the round that was recorded before the store held more than one.
//
// And the season, which is the other half: the league runs different cars each
// season, so a time only means something inside one. Season 8 must not see
// season 7's laps at the same track, and a lap recorded before the store had
// seasons at all belongs to the season running now.
//
// And, above both, the series: two leagues on two race servers, each with its
// own key, and a lap from one saying nothing about the other even at the same
// track in the same week.
//
// Real files in a temp directory rather than a mocked fs: the whole mechanism
// IS the file layout (a lap's time is its file name), and a mock would be
// asserting that my idea of the layout matches my idea of the layout.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = mkdtempSync(join(tmpdir(), "nabs-laps-"));
vi.mock("./dataDirs.js", () => ({ DATA_ROOT: ROOT, RESULTS_ARCHIVE_DIR: join(ROOT, "results") }));

const {
  KEEP_PER_DRIVER,
  TELEMETRY_LAPS_DIR,
  keepIfFaster,
  readLap,
  listLaps,
  listTracks,
  deleteLap,
  lapFilesOf,
  pruneSeasonsBefore,
  adoptRootLaps,
  seriesKeyOf,
} = await import("./telemetryLaps.js");

const TRACK = "watkins-glen";
const F1 = "friday-f1";
const GT = "sunday-gt";
const S8 = 8;
const S7 = 7;
const ME = "76561198012345678";
const OTHER = "76561198087654321";

const lap = (steamId, lapTimeMs, name = "Maltegoat", season = S8, series = F1) => ({
  v: 1,
  series,
  season,
  steamId,
  name,
  car: "rss_formula_hybrid_2023",
  track: "watkins_glen",
  layout: "",
  trackKey: TRACK,
  lapTimeMs,
  n: 4,
  recordedAt: new Date(0).toISOString(),
  t: [0, 1, 2, 3],
  speed: [1, 2, 3, 4],
  gas: [0, 0, 0, 0],
  brake: [0, 0, 0, 0],
  steer: [0, 0, 0, 0],
  gear: [1, 1, 1, 1],
  x: [0, 0, 0, 0],
  z: [0, 0, 0, 0],
});

const timesOf = (steamId = ME, season = S8, series = F1) =>
  lapFilesOf(series, season, TRACK, steamId, true).map((f) => f.lapTimeMs);

beforeEach(() => {
  rmSync(TELEMETRY_LAPS_DIR, { recursive: true, force: true });
});
afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("keeping three", () => {
  it("keeps the first three whatever order they arrive in", () => {
    for (const ms of [92000, 91000, 93000]) expect(keepIfFaster(lap(ME, ms)).kept).toBe(true);
    expect(timesOf()).toEqual([91000, 92000, 93000]);
  });

  it("lets a fourth, faster lap push out the slowest", () => {
    for (const ms of [91000, 92000, 93000]) keepIfFaster(lap(ME, ms));
    expect(keepIfFaster(lap(ME, 90500)).kept).toBe(true);
    expect(timesOf()).toEqual([90500, 91000, 92000]);
  });

  it("turns away a fourth lap slower than all three, without touching them", () => {
    for (const ms of [91000, 92000, 93000]) keepIfFaster(lap(ME, ms));
    const res = keepIfFaster(lap(ME, 94000));
    expect(res.kept).toBe(false);
    expect(res.bestMs).toBe(91000);
    expect(timesOf()).toEqual([91000, 92000, 93000]);
  });

  it("takes a lap that lands between the stored ones", () => {
    for (const ms of [91000, 92000, 93000]) keepIfFaster(lap(ME, ms));
    expect(keepIfFaster(lap(ME, 91500)).kept).toBe(true);
    expect(timesOf()).toEqual([91000, 91500, 92000]);
  });

  it("stores nothing twice for the same time to the millisecond", () => {
    keepIfFaster(lap(ME, 91000));
    const again = keepIfFaster(lap(ME, 91000));
    expect(again.kept).toBe(false);
    expect(timesOf()).toEqual([91000]);
  });

  it("never keeps more than the cap, however many arrive", () => {
    for (let ms = 99000; ms > 89000; ms -= 250) keepIfFaster(lap(ME, ms));
    expect(timesOf()).toHaveLength(KEEP_PER_DRIVER);
    expect(timesOf()[0]).toBe(89250);
  });

  it("counts each driver's three separately", () => {
    for (const ms of [91000, 92000, 93000]) keepIfFaster(lap(ME, ms));
    expect(keepIfFaster(lap(OTHER, 95000, "Neesh")).kept).toBe(true);
    expect(timesOf(OTHER)).toEqual([95000]);
    expect(timesOf(ME)).toHaveLength(3);
  });

  it("files a lap under its series, then its season", () => {
    keepIfFaster(lap(ME, 91000));
    expect(existsSync(join(TELEMETRY_LAPS_DIR, F1, "s8", TRACK, ME, "91000.json"))).toBe(true);
  });
});

describe("reading one back", () => {
  beforeEach(() => {
    for (const ms of [91000, 92000, 93000]) keepIfFaster(lap(ME, ms));
  });

  it("gives the fastest when no lap is named", () => {
    expect(readLap(F1, S8, TRACK, ME, null, true).lapTimeMs).toBe(91000);
  });

  it("gives the one that was named", () => {
    expect(readLap(F1, S8, TRACK, ME, "92000").lapTimeMs).toBe(92000);
    expect(readLap(F1, S8, TRACK, ME, 93000).lapTimeMs).toBe(93000);
  });

  it("gives nothing for a lap that is not stored, rather than the nearest", () => {
    expect(readLap(F1, S8, TRACK, ME, "91500")).toBeNull();
  });

  it("gives nothing for a driver, track or id that is not one", () => {
    expect(readLap(F1, S8, TRACK, "nonsense")).toBeNull();
    expect(readLap(F1, S8, "../etc", ME)).toBeNull();
    expect(readLap(F1, S8, TRACK, OTHER)).toBeNull();
  });
});

describe("the list a comparison picks from", () => {
  it("offers every stored lap, fastest first, each with its own id", () => {
    for (const ms of [92000, 91000]) keepIfFaster(lap(ME, ms));
    keepIfFaster(lap(OTHER, 91500, "Neesh"));
    const laps = listLaps(F1, S8, TRACK, true);
    expect(laps.map((l) => [l.name, l.lapId])).toEqual([
      ["Maltegoat", "91000"],
      ["Neesh", "91500"],
      ["Maltegoat", "92000"],
    ]);
  });

  it("summarises the track by its overall best and how many laps it holds", () => {
    for (const ms of [92000, 91000]) keepIfFaster(lap(ME, ms));
    keepIfFaster(lap(OTHER, 90000, "Neesh"));
    expect(listTracks(F1, S8, true)).toEqual([
      { trackKey: TRACK, track: "watkins_glen", layout: "", laps: 3, bestMs: 90000 },
    ]);
  });
});

describe("a round recorded before the store kept three", () => {
  // One file per driver, named after them. Read, never written again. It sits
  // directly under the series now — adoptRootLaps put it there.
  const writeLegacy = (steamId, ms) => {
    mkdirSync(join(TELEMETRY_LAPS_DIR, F1, TRACK), { recursive: true });
    writeFileSync(join(TELEMETRY_LAPS_DIR, F1, TRACK, `${steamId}.json`), JSON.stringify(lap(steamId, ms)));
  };

  it("still reads, and still lists", () => {
    writeLegacy(ME, 91000);
    expect(readLap(F1, S8, TRACK, ME, null, true).lapTimeMs).toBe(91000);
    expect(listLaps(F1, S8, TRACK, true).map((l) => l.lapId)).toEqual(["91000"]);
  });

  it("counts towards the three rather than being ignored", () => {
    writeLegacy(ME, 91000);
    keepIfFaster(lap(ME, 92000));
    keepIfFaster(lap(ME, 93000));
    expect(timesOf()).toEqual([91000, 92000, 93000]);
    expect(keepIfFaster(lap(ME, 94000)).kept).toBe(false);
  });

  it("is not offered twice when the same time also sits in the new layout", () => {
    writeLegacy(ME, 91000);
    keepIfFaster(lap(ME, 90000));
    expect(listLaps(F1, S8, TRACK, true).filter((l) => l.lapTimeMs === 91000)).toHaveLength(1);
  });
});

describe("removing laps", () => {
  beforeEach(() => {
    for (const ms of [91000, 92000, 93000]) keepIfFaster(lap(ME, ms));
    keepIfFaster(lap(OTHER, 95000, "Neesh"));
  });

  it("removes one when one is named", () => {
    expect(deleteLap(F1, S8, TRACK, ME, "92000")).toBe(true);
    expect(timesOf()).toEqual([91000, 93000]);
  });

  it("removes the whole driver when none is", () => {
    expect(deleteLap(F1, S8, TRACK, ME)).toBe(true);
    expect(timesOf()).toEqual([]);
    expect(timesOf(OTHER)).toEqual([95000]);
  });

  it("says so when there was nothing to remove", () => {
    expect(deleteLap(F1, S8, TRACK, ME, "88000")).toBe(false);
    expect(deleteLap(F1, S8, TRACK, "76561198000000000")).toBe(false);
  });
});

// The reason the season is in the path at all: the league runs different cars
// each season, so a Red Bull Ring time from last season and one from this
// season are not two attempts at the same problem. Putting them in one list
// would invite a comparison that says nothing.
describe("one season cannot see another", () => {
  beforeEach(() => {
    for (const ms of [91000, 92000, 93000]) keepIfFaster(lap(ME, ms, "Maltegoat", S8));
    for (const ms of [85000, 86000]) keepIfFaster(lap(ME, ms, "Maltegoat", S7));
  });

  it("keeps each season's three apart, at the same track and for the same driver", () => {
    expect(timesOf(ME, S8)).toEqual([91000, 92000, 93000]);
    expect(timesOf(ME, S7)).toEqual([85000, 86000]);
  });

  it("lists only the season asked for", () => {
    expect(listLaps(F1, S8, TRACK).map((l) => l.lapTimeMs)).toEqual([91000, 92000, 93000]);
    expect(listLaps(F1, S7, TRACK).map((l) => l.lapTimeMs)).toEqual([85000, 86000]);
  });

  it("summarises a track by that season's best, not the fastest ever driven there", () => {
    // 1:25 last season in a quicker car does not become this season's benchmark.
    expect(listTracks(F1, S8)[0].bestMs).toBe(91000);
    expect(listTracks(F1, S7)[0].bestMs).toBe(85000);
  });

  it("does not let last season's laps fill this season's three", () => {
    // Three stored in S8 and a fourth arriving at 94.0 is refused; the two S7
    // laps are quicker than all of them and must not enter that comparison.
    expect(keepIfFaster(lap(ME, 94000, "Maltegoat", S8)).kept).toBe(false);
    expect(keepIfFaster(lap(ME, 87000, "Maltegoat", S7)).kept).toBe(true);
    expect(timesOf(ME, S7)).toEqual([85000, 86000, 87000]);
  });

  it("reads a named lap out of its own season only", () => {
    expect(readLap(F1, S8, TRACK, ME, "91000").lapTimeMs).toBe(91000);
    expect(readLap(F1, S8, TRACK, ME, "85000")).toBeNull();
    expect(readLap(F1, S7, TRACK, ME, "85000").lapTimeMs).toBe(85000);
  });

  it("deletes within one season and leaves the other alone", () => {
    expect(deleteLap(F1, S8, TRACK, ME)).toBe(true);
    expect(timesOf(ME, S8)).toEqual([]);
    expect(timesOf(ME, S7)).toEqual([85000, 86000]);
  });

  it("puts a lap with no season in a bucket of its own rather than in somebody's", () => {
    const orphan = lap(ME, 80000, "Maltegoat", undefined);
    delete orphan.season;
    expect(keepIfFaster(orphan).kept).toBe(true);
    expect(timesOf(ME, S8)).toEqual([91000, 92000, 93000]);
    expect(timesOf(ME, S7)).toEqual([85000, 86000]);
    expect(timesOf(ME, 0)).toEqual([80000]);
  });
});

// The reason the series is above the season: two leagues on two race servers,
// each with its own key. They can race the same circuit in the same week in
// different cars, and the Sunday league's 1:25 must never be the benchmark on
// the Friday league's page — nor fill a Friday driver's three.
describe("one series cannot see another", () => {
  beforeEach(() => {
    for (const ms of [91000, 92000, 93000]) keepIfFaster(lap(ME, ms, "Maltegoat", S8, F1));
    // The GT league is in its own season 8 too, at the same track, same driver.
    for (const ms of [85000, 86000]) keepIfFaster(lap(ME, ms, "Maltegoat", S8, GT));
  });

  it("keeps each series' laps in its own folder", () => {
    expect(readdirSync(TELEMETRY_LAPS_DIR).sort()).toEqual([F1, GT]);
    expect(timesOf(ME, S8, F1)).toEqual([91000, 92000, 93000]);
    expect(timesOf(ME, S8, GT)).toEqual([85000, 86000]);
  });

  it("lists and summarises only the series asked for", () => {
    expect(listLaps(GT, S8, TRACK).map((l) => l.lapTimeMs)).toEqual([85000, 86000]);
    expect(listTracks(F1, S8)[0].bestMs).toBe(91000);
    expect(listTracks(GT, S8)[0].bestMs).toBe(85000);
  });

  it("does not let the other league's laps fill a driver's three", () => {
    expect(keepIfFaster(lap(ME, 94000, "Maltegoat", S8, F1)).kept).toBe(false);
    expect(keepIfFaster(lap(ME, 87000, "Maltegoat", S8, GT)).kept).toBe(true);
    expect(timesOf(ME, S8, GT)).toEqual([85000, 86000, 87000]);
  });

  it("reads and deletes inside one series only", () => {
    expect(readLap(F1, S8, TRACK, ME, "85000")).toBeNull();
    expect(readLap(GT, S8, TRACK, ME, "85000").lapTimeMs).toBe(85000);
    expect(deleteLap(GT, S8, TRACK, ME)).toBe(true);
    expect(timesOf(ME, S8, GT)).toEqual([]);
    expect(timesOf(ME, S8, F1)).toHaveLength(3);
  });

  it("puts a lap with no series in a bucket of its own", () => {
    const orphan = lap(ME, 80000, "Maltegoat", S8, undefined);
    delete orphan.series;
    expect(keepIfFaster(orphan).kept).toBe(true);
    expect(timesOf(ME, S8, F1)).toHaveLength(3);
    expect(timesOf(ME, S8, GT)).toHaveLength(2);
    expect(timesOf(ME, S8, null)).toEqual([80000]);
    expect(existsSync(join(TELEMETRY_LAPS_DIR, "no-series"))).toBe(true);
  });

  it("never lets a series folder look like a season folder", () => {
    // Somebody CAN call a series "S3"; the store must not read its folder as
    // season 3 of whatever sits above it.
    expect(seriesKeyOf("s3")).toBe("series-s3");
    expect(seriesKeyOf("friday-f1")).toBe("friday-f1");
    expect(seriesKeyOf("")).toBe("no-series");
    expect(seriesKeyOf("../etc")).toBe("no-series");
  });
});

// A lap that arrived before the store had seasons in it can only have been
// driven in the season running now — the feature has never been on for longer.
describe("laps from before the store had seasons", () => {
  const writeSeasonless = (steamId, ms) => {
    mkdirSync(join(TELEMETRY_LAPS_DIR, F1, TRACK, steamId), { recursive: true });
    writeFileSync(join(TELEMETRY_LAPS_DIR, F1, TRACK, steamId, `${ms}.json`), JSON.stringify(lap(steamId, ms)));
  };

  it("belongs to the season running now", () => {
    writeSeasonless(ME, 91000);
    expect(timesOf(ME, S8)).toEqual([91000]);
    expect(listLaps(F1, S8, TRACK, true).map((l) => l.lapTimeMs)).toEqual([91000]);
  });

  it("is not handed to an older season the reader happens to open", () => {
    writeSeasonless(ME, 91000);
    expect(listLaps(F1, S7, TRACK, false)).toEqual([]);
  });
});

// The league drives a different car each season, so last season's times are not
// something anybody is chasing — and 40 MB a season adds up over the years. The
// first lap of a new season takes the old ones with it.
describe("a new season clears out the old ones", () => {
  beforeEach(() => {
    for (const ms of [91000, 92000]) keepIfFaster(lap(ME, ms, "Maltegoat", S8));
    keepIfFaster(lap(ME, 85000, "Maltegoat", S7));
    keepIfFaster(lap(OTHER, 84000, "Neesh", 6));
  });

  it("removes every season before the one that started, and says which", () => {
    expect(pruneSeasonsBefore(F1, 9)).toEqual([6, 7, 8]);
    expect(timesOf(ME, S8)).toEqual([]);
    expect(timesOf(ME, S7)).toEqual([]);
  });

  it("leaves the season that is being raced alone", () => {
    pruneSeasonsBefore(F1, S8);
    expect(timesOf(ME, S8)).toEqual([91000, 92000]);
    expect(timesOf(ME, S7)).toEqual([]);
  });

  it("does nothing at all for the season already kept", () => {
    expect(pruneSeasonsBefore(F1, 6)).toEqual([]);
    expect(timesOf(ME, S8)).toHaveLength(2);
  });

  it("never touches the bucket for laps whose season could not be told", () => {
    // No number to compare them against, and throwing away data we cannot
    // place is worse than keeping a few files.
    const orphan = lap(ME, 80000);
    delete orphan.season;
    keepIfFaster(orphan);
    pruneSeasonsBefore(F1, 9);
    expect(timesOf(ME, 0)).toEqual([80000]);
  });

  it("is a no-op when there is nothing older, and when the number is nonsense", () => {
    expect(pruneSeasonsBefore(F1, 1)).toEqual([]);
    expect(pruneSeasonsBefore(F1, null)).toEqual([]);
    expect(pruneSeasonsBefore(F1, undefined)).toEqual([]);
    expect(timesOf(ME, S8)).toHaveLength(2);
  });

  it("leaves the other league's seasons alone — their calendars are not the same calendar", () => {
    keepIfFaster(lap(ME, 70000, "Maltegoat", 2, GT));
    expect(pruneSeasonsBefore(F1, 9)).toEqual([6, 7, 8]);
    expect(timesOf(ME, 2, GT)).toEqual([70000]);
  });
});

// Everything recorded before the store had series sat directly under the root.
// All of it belongs to the series that was recording — the primary one — and
// on boot the site hands it over, once, told apart by shape so a second boot
// (or a restored database) finds nothing left to move.
describe("laps from before the store had series", () => {
  // The old root layout, written by hand: a season folder, a pre-season track
  // folder holding a driver folder, and a pre-season track holding a driver
  // FILE.
  const writeRoot = () => {
    mkdirSync(join(TELEMETRY_LAPS_DIR, "s8", TRACK, ME), { recursive: true });
    writeFileSync(join(TELEMETRY_LAPS_DIR, "s8", TRACK, ME, "91000.json"), JSON.stringify(lap(ME, 91000)));
    mkdirSync(join(TELEMETRY_LAPS_DIR, "spa", OTHER), { recursive: true });
    writeFileSync(join(TELEMETRY_LAPS_DIR, "spa", OTHER, "120000.json"), JSON.stringify({ ...lap(OTHER, 120000), trackKey: "spa" }));
    mkdirSync(join(TELEMETRY_LAPS_DIR, "monza"), { recursive: true });
    writeFileSync(join(TELEMETRY_LAPS_DIR, "monza", `${ME}.json`), JSON.stringify({ ...lap(ME, 80000), trackKey: "monza" }));
  };

  it("hands season folders and pre-season track folders to the primary series", () => {
    writeRoot();
    expect(adoptRootLaps(F1).sort()).toEqual(["monza", "s8", "spa"]);
    expect(readdirSync(TELEMETRY_LAPS_DIR)).toEqual([F1]);
    expect(timesOf(ME, S8, F1)).toEqual([91000]);
    expect(lapFilesOf(F1, S8, "spa", OTHER, true).map((f) => f.lapTimeMs)).toEqual([120000]);
    expect(lapFilesOf(F1, S8, "monza", ME, true).map((f) => f.lapTimeMs)).toEqual([80000]);
  });

  it("leaves another series' folder where it is, even one named like a track", () => {
    writeRoot();
    keepIfFaster(lap(ME, 85000, "Maltegoat", S8, GT));
    keepIfFaster(lap(ME, 85000, "Maltegoat", 1, "monza-cup"));
    adoptRootLaps(F1);
    expect(readdirSync(TELEMETRY_LAPS_DIR).sort()).toEqual([F1, "monza-cup", GT].sort());
    expect(timesOf(ME, S8, GT)).toEqual([85000]);
  });

  it("finds nothing to move the second time", () => {
    writeRoot();
    adoptRootLaps(F1);
    expect(adoptRootLaps(F1)).toEqual([]);
    expect(adoptRootLaps(GT)).toEqual([]);
    expect(readdirSync(TELEMETRY_LAPS_DIR)).toEqual([F1]);
  });

  it("merges a season the series already has rather than giving up on it", () => {
    writeRoot();
    // A second track in the root's s8, and the series' own s8 with a lap at
    // the FIRST track — laps arrived in the new layout before the handover ran.
    mkdirSync(join(TELEMETRY_LAPS_DIR, "s8", "spa", OTHER), { recursive: true });
    writeFileSync(join(TELEMETRY_LAPS_DIR, "s8", "spa", OTHER, "121000.json"), JSON.stringify({ ...lap(OTHER, 121000), trackKey: "spa" }));
    keepIfFaster(lap(OTHER, 95000, "Neesh", S8, F1));
    expect(adoptRootLaps(F1)).toContain("s8");
    // The series' own copy of a track wins; the root's copy of that track
    // stays behind for a human, and everything else moves.
    expect(timesOf(OTHER, S8, F1)).toEqual([95000]);
    expect(lapFilesOf(F1, S8, "spa", OTHER).map((f) => f.lapTimeMs)).toEqual([121000]);
    expect(existsSync(join(TELEMETRY_LAPS_DIR, "s8", TRACK))).toBe(true);
    expect(existsSync(join(TELEMETRY_LAPS_DIR, "s8", "spa"))).toBe(false);
    // What stayed behind is found again next boot, and again left alone.
    expect(adoptRootLaps(F1)).toEqual([]);
  });

  it("does nothing when there is no store yet", () => {
    expect(adoptRootLaps(F1)).toEqual([]);
    expect(existsSync(TELEMETRY_LAPS_DIR)).toBe(false);
  });
});
