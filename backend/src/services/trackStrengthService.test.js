import { describe, it, expect } from "vitest";
import { raceEntry, summariseStrengths } from "./trackStrengthService.js";

const row = (driverId, position, bestLapMs, status = "FINISHED") => ({ driverId, position, bestLapMs, status });

describe("one race, measured against its own field", () => {
  it("a win with the fastest lap is a perfect race", () => {
    const field = [row("a", 1, 90000), row("b", 2, 90500), row("c", 3, 91000)];
    const e = raceEntry(field, "a");
    expect(e.finishPct).toBe(1);
    expect(e.pacePct).toBe(1);
    expect(e.value).toBe(1);
    expect(e.gapPct).toBe(0);
  });

  it("the middle of the field is the middle of the scale", () => {
    const field = [row("a", 1, 90000), row("b", 2, 90500), row("c", 3, 91000)];
    const e = raceEntry(field, "b");
    expect(e.finishPct).toBe(0.5);
    expect(e.pacePct).toBe(0.5);
    expect(e.gapPct).toBeCloseTo(0.556, 2);
  });

  it("a retirement keeps its lap and loses its finish; a non-starter is no race", () => {
    const field = [row("a", 1, 90000), row("b", 2, 90500), row("c", null, 89900, "DNF"), row("d", null, null, "DNS")];
    const dnf = raceEntry(field, "c");
    expect(dnf.finishPct).toBeNull();
    expect(dnf.pacePct).toBe(1);
    expect(dnf.value).toBe(1);
    expect(raceEntry(field, "d")).toBeNull();
  });

  it("a round without lap times is scored on the finish alone", () => {
    const field = [row("a", 1, null), row("b", 2, null), row("c", 3, null), row("d", 4, null), row("e", 5, null)];
    const e = raceEntry(field, "d");
    expect(e.pacePct).toBeNull();
    expect(e.value).toBe(0.25);
  });
});

describe("the summary the profile draws", () => {
  const types = new Map([
    ["Spa", ["highspeed", "flowing"]],
    ["Monaco", ["street", "technical"]],
    ["Unknown", []],
  ]);
  const e = (trackKey, value, position) => ({ trackKey, trackName: trackKey, value, position, gapPct: 0.5 });

  it("groups by type and by circuit on a 0-100 scale", () => {
    const out = summariseStrengths([e("Spa", 0.9, 2), e("Spa", 0.7, 4), e("Monaco", 0.2, 9), e("Monaco", 0.3, 8)], types);
    const by = Object.fromEntries(out.types.map((t) => [t.key, t]));
    expect(by.highspeed.score).toBe(80);
    expect(by.highspeed.races).toBe(2);
    expect(by.highspeed.avgFinish).toBe(3);
    expect(by.highspeed.bestFinish).toBe(2);
    expect(by.street.score).toBe(25);
    expect(by.power.score).toBeNull();
    expect(by.power.races).toBe(0);
    expect(out.tracks.map((t) => t.key)).toEqual(["Spa", "Monaco"]);
    expect(out.overall).toBe(53);
  });

  it("names the strongest and weakest kind only when they really differ", () => {
    const clear = summariseStrengths([e("Spa", 0.9, 2), e("Spa", 0.7, 4), e("Monaco", 0.2, 9), e("Monaco", 0.3, 8)], types);
    expect(["highspeed", "flowing"]).toContain(clear.strongest);
    expect(["street", "technical"]).toContain(clear.weakest);
    const flat = summariseStrengths([e("Spa", 0.5, 5), e("Spa", 0.5, 5), e("Monaco", 0.52, 5), e("Monaco", 0.5, 5)], types);
    expect(flat.strongest).toBeNull();
    expect(flat.weakest).toBeNull();
  });

  it("counts races at circuits nobody has typed", () => {
    const out = summariseStrengths([e("Unknown", 0.5, 5), e("Spa", 0.5, 5)], types);
    expect(out.untyped).toBe(1);
    expect(out.races).toBe(2);
  });
});
