import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createCleanLapWatch } from "./sessionCleanLaps.js";

const ns = (ms) => ms * 1e6;
const split = (i, ms, cuts = 0) => ({ SplitIndex: i, SplitTime: ns(ms), Cuts: cuts });
const car = (laps, lastMs, splits = []) => ({
  NumLaps: laps,
  LastLap: lastMs ? ns(lastMs) : 0,
  CurrentLapSplits: Object.fromEntries(splits.map((s, i) => [i, s])),
});

const ME = "76561198000000001";
const KEY = "mugello||Practice|0";
const START = 1_794_246_672_972;

describe("sessionCleanLaps", () => {
  let dir;
  let watch;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clean-laps-"));
    watch = createCleanLapWatch("test", { dir });
    watch.session(KEY, START);
  });

  it("counts a lap whose three splits are still on the snapshot at the line", () => {
    watch.note(ME, car(10, 80_000, [split(0, 20_000)]));
    watch.note(ME, car(11, 78_500, [split(0, 20_000), split(1, 22_000), split(2, 36_500)]));
    expect(watch.bestOf(ME)).toEqual({
      lapTimeMs: 78_500,
      sectorsMs: [20_000, 22_000, 36_500],
      bestSectorsMs: [20_000, 22_000, 36_500],
    });
  });

  it("takes the splits from the snapshot before the line when the new lap has already started", () => {
    watch.note(ME, car(10, 80_000, [split(0, 20_000), split(1, 22_000), split(2, 36_500)]));
    watch.note(ME, car(11, 78_500, [split(0, 19_900)]));
    expect(watch.bestOf(ME)?.lapTimeMs).toBe(78_500);
  });

  it("does not count a lap with a cut in it", () => {
    watch.note(ME, car(10, 80_000, []));
    watch.note(ME, car(11, 76_000, [split(0, 19_000, 1), split(1, 21_000), split(2, 36_000)]));
    expect(watch.bestOf(ME)).toBe(null);
  });

  it("does not count a lap it cannot check", () => {
    // First sight: the lap they just finished was before we looked.
    watch.note(ME, car(11, 76_000, [split(0, 19_000), split(1, 21_000), split(2, 36_000)]));
    expect(watch.bestOf(ME)).toBe(null);
    // Two laps in one step: which splits belong to which is unknowable.
    watch.note(ME, car(13, 77_000, [split(0, 20_000), split(1, 21_000), split(2, 36_000)]));
    expect(watch.bestOf(ME)).toBe(null);
    // Splits that do not add up to the lap.
    watch.note(ME, car(14, 79_000, [split(0, 20_000), split(1, 21_000), split(2, 36_000)]));
    expect(watch.bestOf(ME)).toBe(null);
  });

  it("keeps the fastest, and the best of each sector across clean laps", () => {
    watch.note(ME, car(10, 80_000, []));
    watch.note(ME, car(11, 78_500, [split(0, 20_000), split(1, 22_000), split(2, 36_500)]));
    watch.note(ME, car(12, 79_000, [split(0, 19_800), split(1, 22_400), split(2, 36_800)]));
    expect(watch.bestOf(ME)).toEqual({
      lapTimeMs: 78_500,
      sectorsMs: [20_000, 22_000, 36_500],
      bestSectorsMs: [19_800, 22_000, 36_500],
    });
  });

  it("comes back after a restart of the backend in the same session, not in another", () => {
    watch.note(ME, car(10, 80_000, []));
    watch.note(ME, car(11, 78_500, [split(0, 20_000), split(1, 22_000), split(2, 36_500)]));

    const again = createCleanLapWatch("test", { dir });
    again.session(KEY, START + 2_000);
    expect(again.bestOf(ME)?.lapTimeMs).toBe(78_500);

    const restarted = createCleanLapWatch("test", { dir });
    restarted.session(KEY, START + 3 * 60 * 60 * 1000);
    expect(restarted.bestOf(ME)).toBe(null);

    const other = createCleanLapWatch("test", { dir });
    other.session("monza||Practice|0", START);
    expect(other.bestOf(ME)).toBe(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("a new session, or the same one started again, starts from nothing", () => {
    watch.note(ME, car(10, 80_000, []));
    watch.note(ME, car(11, 78_500, [split(0, 20_000), split(1, 22_000), split(2, 36_500)]));
    watch.clear();
    expect(watch.bestOf(ME)).toBe(null);
    expect(existsSync(join(dir, "test.json"))).toBe(false);

    watch.note(ME, car(1, 0, []));
    watch.note(ME, car(2, 78_900, [split(0, 20_000), split(1, 22_400), split(2, 36_500)]));
    watch.session("monza||Practice|0", START);
    expect(watch.bestOf(ME)).toBe(null);
  });
});
