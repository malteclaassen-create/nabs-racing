// What the lap store keeps, what it throws away, and which season it puts it in.
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
} = await import("./telemetryLaps.js");

const TRACK = "watkins-glen";
const S8 = 8;
const S7 = 7;
const ME = "76561198012345678";
const OTHER = "76561198087654321";

const lap = (steamId, lapTimeMs, name = "Maltegoat", season = S8) => ({
  v: 1,
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

const timesOf = (steamId = ME, season = S8) =>
  lapFilesOf(season, TRACK, steamId, true).map((f) => f.lapTimeMs);

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
});

describe("reading one back", () => {
  beforeEach(() => {
    for (const ms of [91000, 92000, 93000]) keepIfFaster(lap(ME, ms));
  });

  it("gives the fastest when no lap is named", () => {
    expect(readLap(S8, TRACK, ME, null, true).lapTimeMs).toBe(91000);
  });

  it("gives the one that was named", () => {
    expect(readLap(S8, TRACK, ME, "92000").lapTimeMs).toBe(92000);
    expect(readLap(S8, TRACK, ME, 93000).lapTimeMs).toBe(93000);
  });

  it("gives nothing for a lap that is not stored, rather than the nearest", () => {
    expect(readLap(S8, TRACK, ME, "91500")).toBeNull();
  });

  it("gives nothing for a driver, track or id that is not one", () => {
    expect(readLap(S8, TRACK, "nonsense")).toBeNull();
    expect(readLap(S8, "../etc", ME)).toBeNull();
    expect(readLap(S8, TRACK, OTHER)).toBeNull();
  });
});

describe("the list a comparison picks from", () => {
  it("offers every stored lap, fastest first, each with its own id", () => {
    for (const ms of [92000, 91000]) keepIfFaster(lap(ME, ms));
    keepIfFaster(lap(OTHER, 91500, "Neesh"));
    const laps = listLaps(S8, TRACK, true);
    expect(laps.map((l) => [l.name, l.lapId])).toEqual([
      ["Maltegoat", "91000"],
      ["Neesh", "91500"],
      ["Maltegoat", "92000"],
    ]);
  });

  it("summarises the track by its overall best and how many laps it holds", () => {
    for (const ms of [92000, 91000]) keepIfFaster(lap(ME, ms));
    keepIfFaster(lap(OTHER, 90000, "Neesh"));
    expect(listTracks(S8, true)).toEqual([
      { trackKey: TRACK, track: "watkins_glen", layout: "", laps: 3, bestMs: 90000 },
    ]);
  });
});

describe("a round recorded before the store kept three", () => {
  // One file per driver, named after them. Read, never written again.
  const writeLegacy = (steamId, ms) => {
    mkdirSync(join(TELEMETRY_LAPS_DIR, TRACK), { recursive: true });
    writeFileSync(join(TELEMETRY_LAPS_DIR, TRACK, `${steamId}.json`), JSON.stringify(lap(steamId, ms)));
  };

  it("still reads, and still lists", () => {
    writeLegacy(ME, 91000);
    expect(readLap(S8, TRACK, ME, null, true).lapTimeMs).toBe(91000);
    expect(listLaps(S8, TRACK, true).map((l) => l.lapId)).toEqual(["91000"]);
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
    expect(listLaps(S8, TRACK, true).filter((l) => l.lapTimeMs === 91000)).toHaveLength(1);
  });
});

describe("removing laps", () => {
  beforeEach(() => {
    for (const ms of [91000, 92000, 93000]) keepIfFaster(lap(ME, ms));
    keepIfFaster(lap(OTHER, 95000, "Neesh"));
  });

  it("removes one when one is named", () => {
    expect(deleteLap(S8, TRACK, ME, "92000")).toBe(true);
    expect(timesOf()).toEqual([91000, 93000]);
  });

  it("removes the whole driver when none is", () => {
    expect(deleteLap(S8, TRACK, ME)).toBe(true);
    expect(timesOf()).toEqual([]);
    expect(timesOf(OTHER)).toEqual([95000]);
  });

  it("says so when there was nothing to remove", () => {
    expect(deleteLap(S8, TRACK, ME, "88000")).toBe(false);
    expect(deleteLap(S8, TRACK, "76561198000000000")).toBe(false);
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
    expect(listLaps(S8, TRACK).map((l) => l.lapTimeMs)).toEqual([91000, 92000, 93000]);
    expect(listLaps(S7, TRACK).map((l) => l.lapTimeMs)).toEqual([85000, 86000]);
  });

  it("summarises a track by that season's best, not the fastest ever driven there", () => {
    // 1:25 last season in a quicker car does not become this season's benchmark.
    expect(listTracks(S8)[0].bestMs).toBe(91000);
    expect(listTracks(S7)[0].bestMs).toBe(85000);
  });

  it("does not let last season's laps fill this season's three", () => {
    // Three stored in S8 and a fourth arriving at 94.0 is refused; the two S7
    // laps are quicker than all of them and must not enter that comparison.
    expect(keepIfFaster(lap(ME, 94000, "Maltegoat", S8)).kept).toBe(false);
    expect(keepIfFaster(lap(ME, 87000, "Maltegoat", S7)).kept).toBe(true);
    expect(timesOf(ME, S7)).toEqual([85000, 86000, 87000]);
  });

  it("reads a named lap out of its own season only", () => {
    expect(readLap(S8, TRACK, ME, "91000").lapTimeMs).toBe(91000);
    expect(readLap(S8, TRACK, ME, "85000")).toBeNull();
    expect(readLap(S7, TRACK, ME, "85000").lapTimeMs).toBe(85000);
  });

  it("deletes within one season and leaves the other alone", () => {
    expect(deleteLap(S8, TRACK, ME)).toBe(true);
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

// A lap that arrived before the store had seasons in it can only have been
// driven in the season running now — the feature has never been on for longer.
describe("laps from before the store had seasons", () => {
  const writeSeasonless = (steamId, ms) => {
    mkdirSync(join(TELEMETRY_LAPS_DIR, TRACK, steamId), { recursive: true });
    writeFileSync(join(TELEMETRY_LAPS_DIR, TRACK, steamId, `${ms}.json`), JSON.stringify(lap(steamId, ms)));
  };

  it("belongs to the season running now", () => {
    writeSeasonless(ME, 91000);
    expect(timesOf(ME, S8)).toEqual([91000]);
    expect(listLaps(S8, TRACK, true).map((l) => l.lapTimeMs)).toEqual([91000]);
  });

  it("is not handed to an older season the reader happens to open", () => {
    writeSeasonless(ME, 91000);
    expect(listLaps(S7, TRACK, false)).toEqual([]);
  });
});
