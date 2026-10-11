import { describe, it, expect } from "vitest";
import {
  parseAcRaceJson,
  levenshtein,
  similarity,
  normalize,
  countCarContacts,
  roadPositions,
  serverPenaltySecondsOf,
} from "./acJsonParser.js";

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

describe("parseAcRaceJson · Steam GUID matching", () => {
  // Max's roster row carries a stored Steam GUID; the others have none.
  const roster = [
    { id: "lewis", name: "Lewis Hamilton", discordName: "lewis_h", teamId: "alpha", tier: 1 },
    { id: "max", name: "Max Verstappen", discordName: "maxv", teamId: "bravo", tier: 1, steamId: "STEAM_MAX" },
    { id: "charles", name: "Charles Leclerc", discordName: "charles16", teamId: "charlie", tier: 2 },
  ];
  const race = (result) => ({ Type: "RACE", TrackName: "spa", Result: result });

  it("prefers an exact Steam GUID over a better-scoring name match", () => {
    // The display name is a perfect match for Lewis, but the GUID belongs to
    // Max — the GUID must win, with full confidence and matchedBy 'steam'.
    const parsed = parseAcRaceJson(
      race([{ DriverName: "Lewis Hamilton", DriverGuid: "STEAM_MAX", NumLaps: 20 }]),
      roster
    );
    expect(parsed.entries[0].suggestedDriverId).toBe("max");
    expect(parsed.entries[0].matchedBy).toBe("steam");
  });

  it("falls back to the name match when the GUID is unknown", () => {
    const parsed = parseAcRaceJson(
      race([{ DriverName: "Lewis Hamilton", DriverGuid: "STEAM_NOBODY", NumLaps: 20 }]),
      roster
    );
    expect(parsed.entries[0].suggestedDriverId).toBe("lewis");
    expect(parsed.entries[0].matchedBy).toBe("name");
  });

  it("behaves exactly as before when the entry has no GUID", () => {
    const parsed = parseAcRaceJson(
      race([
        { DriverName: "Lewis Hamilton", NumLaps: 20 }, // clear name -> name match
        { DriverName: "Zzqwxyv", NumLaps: 20 }, // nothing clears 0.55 -> no match
      ]),
      roster
    );
    expect(parsed.entries[0].driverGuid).toBeNull();
    expect(parsed.entries[0].suggestedDriverId).toBe("lewis");
    expect(parsed.entries[0].matchedBy).toBe("name");
    expect(parsed.entries[1].suggestedDriverId).toBeNull();
    expect(parsed.entries[1].matchedBy).toBeNull();
  });
});

// The league's safety-car drivers also race, above all in the training
// sessions, where nobody is in their usual car. An entrant whose NAME is on the
// known-SC list but whose CAR isn't a safety car is a normal drive.
describe("parseAcRaceJson · the safety-car driver actually racing", () => {
  const roster = [
    { id: "lewis", name: "Lewis Hamilton", discordName: "lewis_h", teamId: "alpha", tier: 1 },
    { id: "sam", name: "Samuel Foniok", discordName: "sam", teamId: "reserve", tier: 0, steamId: "STEAM_SAM" },
  ];
  const training = (extra = {}) => ({
    Type: "RACE",
    TrackName: "spa",
    Cars: [{ CarId: 0, Skin: "red_bull_2023", Driver: { Guid: "STEAM_SAM", Name: "Samuel Foniok" } }],
    Result: [{ DriverName: "Samuel Foniok", DriverGuid: "STEAM_SAM", NumLaps: 20, BestLap: 90000, TotalTime: 1000 }],
    ...extra,
  });

  it("flags the row as a question, not as the safety car", () => {
    const e = parseAcRaceJson(training(), roster).entries[0];
    expect(e.isSafetyCar).toBe(false);
    expect(e.maybeSafetyCar).toBe(true);
  });

  it("still maps them when the Steam GUID says who they are", () => {
    const e = parseAcRaceJson(training(), roster).entries[0];
    expect(e.suggestedDriverId).toBe("sam");
    expect(e.matchedBy).toBe("steam");
  });

  it("leaves the pick to the admin when only the name matches", () => {
    const noGuid = {
      Type: "RACE",
      TrackName: "spa",
      Cars: [{ CarId: 0, Skin: "red_bull_2023", Driver: { Guid: "STEAM_OTHER", Name: "Samuel Foniok" } }],
      Result: [{ DriverName: "Samuel Foniok", DriverGuid: "STEAM_OTHER", NumLaps: 20 }],
    };
    const e = parseAcRaceJson(noGuid, roster).entries[0];
    expect(e.maybeSafetyCar).toBe(true);
    expect(e.suggestedDriverId).toBeNull();
    // The list is still offered — the admin picks from it.
    expect(e.suggestions.map((s) => s.driverId)).toContain("sam");
  });

  it("is unchanged when they really are in the safety car", () => {
    const real = {
      Type: "RACE",
      TrackName: "spa",
      Cars: [{ CarId: 0, Skin: "!NABS_Safety_Car", Driver: { Guid: "STEAM_SAM", Name: "Samuel Foniok" } }],
      Result: [{ DriverName: "Samuel Foniok", DriverGuid: "STEAM_SAM", NumLaps: 20 }],
    };
    const e = parseAcRaceJson(real, roster).entries[0];
    expect(e.isSafetyCar).toBe(true);
    expect(e.maybeSafetyCar).toBe(false);
    expect(e.suggestedDriverId).toBeNull();
  });
});

describe("countCarContacts", () => {
  const ev = (guid, other, ImpactSpeed, Timestamp) => ({
    Type: "COLLISION_WITH_CAR",
    Driver: { Guid: guid },
    OtherCarId: other,
    ImpactSpeed,
    Timestamp,
  });

  it("counts car contacts on the reporting (Driver) side only", () => {
    const counts = countCarContacts([ev("a", 2, 20, 100), ev("b", 1, 20, 100)]);
    expect(counts.get("a")).toBe(1);
    expect(counts.get("b")).toBe(1);
  });

  it("ignores light taps below the impact threshold and non-car events", () => {
    const counts = countCarContacts([
      ev("a", 2, 5, 100), // below default threshold of 10
      { Type: "COLLISION_WITH_ENV", Driver: { Guid: "a" }, ImpactSpeed: 50, Timestamp: 100 },
    ]);
    expect(counts.get("a")).toBeUndefined();
  });

  it("merges repeated hits on the same pair within the time window into one incident", () => {
    // Timestamps are Unix SECONDS: 100 & 101 are 1s apart (merged), 110 is 9s
    // later (a fresh incident). A different pair is always its own incident.
    const counts = countCarContacts([
      ev("a", 2, 20, 100),
      ev("a", 2, 20, 101),
      ev("a", 2, 20, 110),
      ev("a", 3, 20, 100),
    ]);
    expect(counts.get("a")).toBe(3); // 2 vs car#2 (merged + later) + 1 vs car#3
  });

  it("respects custom threshold and window options", () => {
    const events = [ev("a", 2, 12, 100), ev("a", 2, 12, 105)];
    expect(countCarContacts(events, { impactThreshold: 15 }).get("a")).toBeUndefined();
    // 5s apart: merged under a 10s window, separate under a 2s window.
    expect(countCarContacts(events, { mergeWindowMs: 10000 }).get("a")).toBe(1);
    expect(countCarContacts(events, { mergeWindowMs: 2000 }).get("a")).toBe(2);
  });
});

describe("roadPositions / serverPenaltySecondsOf (race server time penalties)", () => {
  const S = 1e9; // ACSM stores PenaltyTime as Go nanoseconds
  const res = (DriverName, TotalTime, NumLaps, extra = {}) => ({ DriverName, TotalTime, NumLaps, PenaltyTime: 0, ...extra });
  const order = (results) => {
    const road = roadPositions(results);
    return [...results].sort((a, b) => road.get(a) - road.get(b)).map((r) => r.DriverName);
  };

  it("reads whole seconds from nanoseconds", () => {
    expect(serverPenaltySecondsOf({ PenaltyTime: 5 * S })).toBe(5);
    expect(serverPenaltySecondsOf({ PenaltyTime: 0 })).toBe(0);
    expect(serverPenaltySecondsOf({})).toBe(0);
  });

  it("takes the server's penalty back out of the file order", () => {
    // Shape of the 2026-10-11 feature race: 13bot was faster on the road than
    // Maltegoat but sits behind them in the file because of its +5s.
    const file = [
      res("Techouss", 1686065, 15),
      res("Maltegoat", 1689222, 15),
      res("13bot", 1686262, 15, { PenaltyTime: 5 * S }),
      res("Steve", 1692034, 15),
      res("Takoda", 1689427, 15, { PenaltyTime: 5 * S }),
    ];
    expect(order(file)).toEqual(["Techouss", "13bot", "Maltegoat", "Takoda", "Steve"]);
  });

  it("keeps a file without server penalties exactly as it is", () => {
    const file = [res("a", 100, 15), res("b", 99, 15), res("c", 50, 14)];
    expect(order(file)).toEqual(["a", "b", "c"]);
  });

  it("never moves a penalised car past a car on another lap or a disqualified one", () => {
    const file = [
      res("lapped", 1780000, 14),
      res("pen", 1776000, 15, { PenaltyTime: 5 * S }),
      res("dq", 1770000, 15, { Disqualified: true }),
      res("pen2", 1700000, 15, { PenaltyTime: 5 * S }),
    ];
    expect(order(file)).toEqual(["lapped", "pen", "dq", "pen2"]);
  });

  it("is carried on every parsed entry", () => {
    const json = {
      Type: "RACE",
      Result: [
        res("Max Verstappen", 101000, 10),
        res("Lewis Hamilton", 100000, 10, { PenaltyTime: 5 * S }),
      ],
    };
    const { entries } = parseAcRaceJson(json, drivers);
    expect(entries.map((e) => [e.acDriverName, e.position, e.roadPosition, e.serverPenaltySeconds])).toEqual([
      ["Max Verstappen", 1, 2, 0],
      ["Lewis Hamilton", 2, 1, 5],
    ]);
  });
});
