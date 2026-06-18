import { describe, it, expect } from "vitest";
import { parseAcRaceJson, levenshtein, similarity, normalize } from "./acJsonParser.js";

const drivers = [
  { id: "lewis", name: "Lewis Hamilton", discordName: "lewis_h", teamId: "alpha", tier: 1 },
  { id: "max", name: "Max Verstappen", discordName: "maxv", teamId: "bravo", tier: 1 },
  { id: "charles", name: "Charles Leclerc", discordName: "charles16", teamId: "charlie", tier: 2 },
];

describe("levenshtein", () => {
  it("is 0 for identical (case-insensitive) strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("ABC", "abc")).toBe(0);
  });

  it("counts single-edit distances", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});

describe("normalize", () => {
  it("lowercases and strips punctuation, spaces and accents", () => {
    expect(normalize("Lewis Hamilton")).toBe("lewishamilton");
    expect(normalize("Sébastien_Löb!")).toBe("sebastienlob");
  });
});

describe("similarity", () => {
  it("scores an exact name match as 1", () => {
    expect(similarity("Lewis Hamilton", drivers[0])).toBe(1);
  });

  it("gives a high score for a substring (e.g. just the first name)", () => {
    expect(similarity("Charles", drivers[2])).toBeGreaterThanOrEqual(0.9);
  });

  it("scores an unrelated name low", () => {
    expect(similarity("Fernando Alonso", drivers[0])).toBeLessThan(0.55);
  });
});

describe("parseAcRaceJson", () => {
  const baseJson = {
    Type: "RACE",
    TrackName: "spa",
    Date: "2026-06-01T18:00:00Z",
    EventName: "Round 9",
    Result: [
      { DriverName: "Lewis Hamilton", CarModel: "ferrari", TotalTime: 1000, BestLap: 90000, NumLaps: 20 },
      { DriverName: "Max Verstappen", CarModel: "redbull", TotalTime: 1010, BestLap: 90500, NumLaps: 20 },
      { DriverName: "Charles Leclerc", CarModel: "ferrari", TotalTime: 1020, BestLap: 91000, NumLaps: 20, Disqualified: true },
    ],
  };

  it("throws on non-RACE or malformed JSON", () => {
    expect(() => parseAcRaceJson(null, drivers)).toThrow(/Invalid AC/);
    expect(() => parseAcRaceJson({ Type: "QUALIFY", Result: [] }, drivers)).toThrow(/Invalid AC/);
    expect(() => parseAcRaceJson({ Type: "RACE" }, drivers)).toThrow(/Invalid AC/);
  });

  it("uses Result[] array order as finishing position", () => {
    const parsed = parseAcRaceJson(baseJson, drivers);
    expect(parsed.entries.map((e) => e.position)).toEqual([1, 2, 3]);
  });

  it("carries through track, event name and parsed date", () => {
    const parsed = parseAcRaceJson(baseJson, drivers);
    expect(parsed.track).toBe("spa");
    expect(parsed.eventName).toBe("Round 9");
    expect(parsed.date).toBeInstanceOf(Date);
  });

  it("auto-suggests the matching driver for clear names", () => {
    const parsed = parseAcRaceJson(baseJson, drivers);
    expect(parsed.entries[0].suggestedDriverId).toBe("lewis");
    expect(parsed.entries[1].suggestedDriverId).toBe("max");
  });

  it("leaves suggestedDriverId null when no match clears the 0.55 threshold", () => {
    const json = { ...baseJson, Result: [{ DriverName: "Zzqwxyv", NumLaps: 20 }] };
    const parsed = parseAcRaceJson(json, drivers);
    expect(parsed.entries[0].suggestedDriverId).toBeNull();
    expect(parsed.entries[0].suggestions.length).toBeGreaterThan(0);
  });

  it("flags disqualification from the AC payload", () => {
    const parsed = parseAcRaceJson(baseJson, drivers);
    expect(parsed.entries[2].disqualified).toBe(true);
    expect(parsed.entries[0].disqualified).toBe(false);
  });

  it("returns at most 5 ranked suggestions per entry", () => {
    const parsed = parseAcRaceJson(baseJson, drivers);
    const { suggestions } = parsed.entries[0];
    expect(suggestions.length).toBeLessThanOrEqual(5);
    // sorted descending by score
    const scores = suggestions.map((s) => s.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});
