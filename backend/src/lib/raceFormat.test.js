import { describe, it, expect } from "vitest";
import { combineQualiSplit, parseFormatNumber, parseRaceFormat, sessionLines } from "./raceFormat.js";

// The sessions line is the whole point of the sprint format: an F2 event has to
// announce two races, and a normal round must keep reading exactly as it did
// before the column existed.
describe("sessionLines", () => {
  it("keeps the single-race wording", () => {
    expect(sessionLines({ qualiMinutes: 15, raceLaps: 20, raceFormat: "SINGLE" })).toEqual([
      "15 min qualifying",
      "20 lap race",
    ]);
  });

  it("names both races on a sprint weekend", () => {
    expect(
      sessionLines({ qualiMinutes: 15, sprintLaps: 12, raceLaps: 20, raceFormat: "SPRINT_FEATURE" })
    ).toEqual(["15 min qualifying", "20 lap feature race", "12 lap sprint"]);
  });

  it("still announces both races when the distances are not decided yet", () => {
    expect(sessionLines({ raceFormat: "SPRINT_FEATURE" })).toEqual(["feature race", "sprint race"]);
  });

  it("says nothing about a round with no format set", () => {
    expect(sessionLines({})).toEqual([]);
    expect(sessionLines()).toEqual([]);
  });
});

describe("parseRaceFormat", () => {
  it("leaves the format alone when the field wasn't sent", () => {
    expect(parseRaceFormat(undefined)).toEqual({ ok: false });
  });

  it("reads an empty value as 'back to one race'", () => {
    expect(parseRaceFormat("")).toEqual({ ok: true, value: "SINGLE" });
    expect(parseRaceFormat(null)).toEqual({ ok: true, value: "SINGLE" });
  });

  it("accepts the two known shapes, case-insensitively", () => {
    expect(parseRaceFormat("sprint_feature")).toEqual({ ok: true, value: "SPRINT_FEATURE" });
    expect(parseRaceFormat("SINGLE")).toEqual({ ok: true, value: "SINGLE" });
  });

  it("rejects anything else", () => {
    expect(parseRaceFormat("SPRINT").error).toMatch(/one of/);
  });
});

// Qualifying split by tier: one session, Tier 2 first, Tier 1 for the rest.
describe("qualifying tier split", () => {
  const num = (v, label) => parseFormatNumber(v, label, 240);

  it("announces both halves with the total", () => {
    expect(sessionLines({ qualiMinutes: 20, qualiT2Minutes: 12, qualiT1Minutes: 8, raceLaps: 20 })).toEqual([
      "20 min qualifying (T2 first 12 min, T1 last 8 min)",
      "20 lap race",
    ]);
  });

  it("sets the total to the sum of both halves", () => {
    expect(combineQualiSplit(num(12, "T2"), num("8", "T1"))).toEqual({
      qualiT2Minutes: 12,
      qualiT1Minutes: 8,
      qualiMinutes: 20,
    });
  });

  it("refuses one half without the other", () => {
    expect(combineQualiSplit(num(12, "T2"), num(null, "T1")).error).toMatch(/both/);
    expect(combineQualiSplit(num("", "T2"), num(8, "T1")).error).toMatch(/both/);
  });

  it("clears the split when both are emptied, and leaves it alone when not sent", () => {
    expect(combineQualiSplit(num(null, "T2"), num("", "T1"))).toEqual({ qualiT2Minutes: null, qualiT1Minutes: null });
    expect(combineQualiSplit(num(undefined, "T2"), num(undefined, "T1"))).toEqual({});
  });
});
