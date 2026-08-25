import { describe, it, expect } from "vitest";
import { parseRaceFormat, sessionLines } from "./raceFormat.js";

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
    ).toEqual(["15 min qualifying", "12 lap sprint", "20 lap feature race"]);
  });

  it("still announces both races when the distances are not decided yet", () => {
    expect(sessionLines({ raceFormat: "SPRINT_FEATURE" })).toEqual(["sprint race", "feature race"]);
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
