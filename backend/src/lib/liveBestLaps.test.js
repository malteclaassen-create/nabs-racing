import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE_BEST_LAPS_DIR } from "./dataDirs.js";
import { readImport, writeImport, clearImport, listImports, importEffect, __clearCache } from "./liveBestLaps.js";

// The overlay the live board reads its imported training bests from. What is
// tested here is what the BOARD depends on: one row per driver, fastest first,
// and never a number that is not a lap time — the board trusts this file and
// prints whatever is in it next to a driver's name.

const SERVER = "test";
const TRACK = "monza";
const A = "76561198000000001";
const B = "76561198000000002";

const lap = (steamId, lapTimeMs, name = "Alice") => ({ steamId, name, car: "f1", lapTimeMs });

beforeEach(() => {
  rmSync(join(LIVE_BEST_LAPS_DIR, SERVER), { recursive: true, force: true });
  __clearCache();
});
afterEach(() => {
  rmSync(join(LIVE_BEST_LAPS_DIR, SERVER), { recursive: true, force: true });
  __clearCache();
});

describe("liveBestLaps", () => {
  it("round-trips an import, fastest first", () => {
    writeImport(SERVER, TRACK, {
      track: "monza",
      layout: "",
      series: "nabs",
      season: 8,
      laps: [lap(A, 95_000, "Alice"), lap(B, 93_500, "Bob")],
    });
    __clearCache(); // force the read to come off disk, not the write's memo

    const stored = readImport(SERVER, TRACK);
    expect(stored.laps.map((l) => l.name)).toEqual(["Bob", "Alice"]);
    expect(stored.laps[0].lapTimeMs).toBe(93_500);
    expect(stored.season).toBe(8);
  });

  it("keeps one row per driver — the fastest", () => {
    writeImport(SERVER, TRACK, { laps: [lap(A, 95_000), lap(A, 92_000), lap(A, 99_000)] });
    const stored = readImport(SERVER, TRACK);
    expect(stored.laps).toHaveLength(1);
    expect(stored.laps[0].lapTimeMs).toBe(92_000);
  });

  it("drops rows that are not laps", () => {
    writeImport(SERVER, TRACK, {
      laps: [
        lap(A, 95_000, "Alice"),
        lap("not-a-steam-id", 95_000, "Ghost"),
        lap(B, 5, "Impossible"), // under the 20s floor
        lap(B, 9_000_000, "Also impossible"), // over the 30min ceiling
        { steamId: B, lapTimeMs: 95_000 }, // no name
      ],
    });
    const stored = readImport(SERVER, TRACK);
    expect(stored.laps.map((l) => l.name)).toEqual(["Alice"]);
  });

  it("an import with nothing usable in it leaves no overlay at all", () => {
    writeImport(SERVER, TRACK, { laps: [lap(A, 95_000)] });
    expect(readImport(SERVER, TRACK)).not.toBeNull();

    writeImport(SERVER, TRACK, { laps: [lap("nonsense", 95_000)] });
    expect(readImport(SERVER, TRACK)).toBeNull();
    expect(existsSync(join(LIVE_BEST_LAPS_DIR, SERVER, `${TRACK}.json`))).toBe(false);
  });

  it("clearing takes the overlay off the board", () => {
    writeImport(SERVER, TRACK, { laps: [lap(A, 95_000)] });
    expect(clearImport(SERVER, TRACK)).toBe(true);
    expect(readImport(SERVER, TRACK)).toBeNull();
    expect(clearImport(SERVER, TRACK)).toBe(false); // already gone
  });

  it("a broken file is no overlay, not an outage", () => {
    mkdirSync(join(LIVE_BEST_LAPS_DIR, SERVER), { recursive: true });
    writeFileSync(join(LIVE_BEST_LAPS_DIR, SERVER, `${TRACK}.json`), "{ this is not json");
    __clearCache();
    expect(readImport(SERVER, TRACK)).toBeNull();
  });

  it("refuses a track key that could walk out of its folder", () => {
    expect(() => writeImport(SERVER, "../../etc/passwd", { laps: [lap(A, 95_000)] })).toThrow();
    expect(readImport(SERVER, "../../etc/passwd")).toBeNull();
  });

  it("lists what a server carries, newest import first", () => {
    writeImport(SERVER, "monza", { laps: [lap(A, 95_000)] });
    writeImport(SERVER, "spa--gp", { laps: [lap(A, 104_000), lap(B, 103_000)] });

    const list = listImports(SERVER);
    expect(list.map((t) => t.trackKey).sort()).toEqual(["monza", "spa--gp"]);
    expect(list.find((t) => t.trackKey === "spa--gp")).toMatchObject({ laps: 2, bestMs: 103_000 });
  });

  it("an unknown server carries nothing", () => {
    expect(listImports("nobody")).toEqual([]);
    expect(readImport("nobody", TRACK)).toBeNull();
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
    // An earlier import left 1:36 on the row and the driver has since done
    // 1:33 on the server: the board shows the 1:33, so a 1:34 is slower.
    expect(importEffect(94_000, { liveMs: 93_000, importedMs: 96_000 })).toBe("slower");
    // The other way round: the row is carrying the imported 1:33.
    expect(importEffect(94_000, { liveMs: 96_000, importedMs: 93_000 })).toBe("slower");
    expect(importEffect(92_000, { liveMs: 96_000, importedMs: 93_000 })).toBe("faster");
  });
});
