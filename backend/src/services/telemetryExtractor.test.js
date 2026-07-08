import { describe, it, expect } from "vitest";
import { extractTelemetry, countIncidents } from "./telemetryExtractor.js";

// --- builders --------------------------------------------------------------
const car = (guid, name, skin = "car") => ({ CarId: 0, Skin: skin, Driver: { Guid: guid, Name: name, GuidsList: [guid] } });
const res = (guid, grid, { best = 90000, laps = 2, name = guid } = {}) => ({
  DriverGuid: guid,
  DriverName: name,
  GridPosition: grid,
  BestLap: best,
  NumLaps: laps,
  TotalTime: 1000,
});
const lap = (guid, LapTime, Timestamp, Cuts = 0, Tyre = "C4") => ({ DriverGuid: guid, LapTime, Timestamp, Cuts, Tyre });
const ev = (type, guid, ImpactSpeed, Timestamp, other = 1, after = false) => ({
  Type: type,
  Driver: { Guid: guid },
  OtherCarId: other,
  ImpactSpeed,
  Timestamp,
  AfterSessionEnd: after,
});

describe("safety car detection", () => {
  it("excludes a car whose skin says safety, even if it appears in Result[]", () => {
    const json = {
      Cars: [car("a", "Ann"), car("sc", "Marshal", "!NABS_Safety_Car")],
      Result: [res("a", 1), res("sc", 2)],
      Laps: [lap("a", 90000, 100), lap("sc", 130000, 100)],
      Events: [],
      Penalties: [],
    };
    const { byGuid, safetyCarGuids } = extractTelemetry(json);
    expect(safetyCarGuids.has("sc")).toBe(true);
    expect(byGuid.has("sc")).toBe(false);
    expect(byGuid.has("a")).toBe(true);
  });

  it("falls back to the known SC name list when the skin is generic", () => {
    const json = {
      Cars: [car("t", "Tyler27")],
      Result: [res("t", 1)],
      Laps: [lap("t", 90000, 100)],
    };
    const { safetyCarGuids } = extractTelemetry(json);
    expect(safetyCarGuids.has("t")).toBe(true);
  });
});

describe("countIncidents", () => {
  it("drops AfterSessionEnd events", () => {
    const events = [ev("COLLISION_WITH_CAR", "a", 20, 100), ev("COLLISION_WITH_CAR", "a", 20, 200, 2, true)];
    expect(countIncidents(events, { type: "COLLISION_WITH_CAR" }).get("a")).toBe(1);
  });

  it("counts env collisions separately with their own threshold", () => {
    const events = [
      ev("COLLISION_WITH_ENV", "a", 20, 100, -1),
      ev("COLLISION_WITH_ENV", "a", 20, 110, -1), // 10s later -> fresh
      ev("COLLISION_WITH_ENV", "a", 5, 130, -1), // below env threshold (15)
    ];
    expect(countIncidents(events, { type: "COLLISION_WITH_ENV", impactThreshold: 15 }).get("a")).toBe(2);
  });
});

describe("laps, cuts and consistency", () => {
  it("sums cuts and computes stdev over clean laps within 10s of best", () => {
    const g = "a";
    const json = {
      Cars: [car(g, "Ann")],
      Result: [res(g, 1, { best: 90000, laps: 5 })],
      Laps: [
        lap(g, 90000, 100, 0),
        lap(g, 90500, 200, 1),
        lap(g, 91000, 300, 0),
        lap(g, 105000, 400, 2), // >10s over best -> excluded from clean set
        lap(g, 90200, 500, 0),
      ],
      Events: [],
      Penalties: [],
    };
    const t = extractTelemetry(json).byGuid.get(g);
    expect(t.laps).toBe(5);
    expect(t.cuts).toBe(3);
    expect(t.cleanLaps).toBe(4);
    // stdev of [90000, 90500, 91000, 90200] ~= 377
    expect(t.consistencyMs).toBeGreaterThan(360);
    expect(t.consistencyMs).toBeLessThan(395);
  });

  it("returns null consistency under 3 clean laps", () => {
    const g = "a";
    const json = {
      Result: [res(g, 1, { best: 90000, laps: 2 })],
      Laps: [lap(g, 90000, 100), lap(g, 120000, 200)],
    };
    expect(extractTelemetry(json).byGuid.get(g).consistencyMs).toBeNull();
  });
});

describe("overtakes", () => {
  it("counts a clean on-track pass for the driver who moved ahead", () => {
    const json = {
      Result: [res("a", 1), res("b", 2)],
      Laps: [
        lap("a", 90000, 100), lap("b", 91000, 101),
        lap("a", 95000, 195), lap("b", 89000, 190), // b crosses first on lap 2
      ],
    };
    const { byGuid } = extractTelemetry(json);
    expect(byGuid.get("b").overtakes).toBe(1);
    expect(byGuid.get("a").overtakes).toBe(0);
  });

  it("does not count a place gained because the opponent pitted", () => {
    const json = {
      Result: [res("a", 1), res("c", 2), res("b", 3)],
      Laps: [
        lap("a", 90000, 100), lap("c", 92000, 101), lap("b", 91000, 102),
        // c pits (very slow lap, inflated by an earlier normal lap), drops behind b
        lap("a", 90000, 195), lap("b", 91000, 200), lap("c", 160000, 280),
      ],
    };
    expect(extractTelemetry(json).byGuid.get("b").overtakes).toBe(0);
  });

  it("does not count a place gained because the opponent retired", () => {
    const json = {
      Result: [res("a", 1), res("b", 2)],
      Laps: [
        lap("a", 90000, 100), lap("b", 91000, 101),
        lap("b", 90000, 200), // a retires (no lap 2)
      ],
    };
    expect(extractTelemetry(json).byGuid.get("b").overtakes).toBe(0);
  });

  it("skips position changes on a safety-car lap", () => {
    const json = {
      Result: [res("a", 1, { laps: 3 }), res("b", 2, { laps: 3 })],
      Laps: [
        lap("a", 90000, 100), lap("b", 91000, 101),
        lap("a", 150000, 270), lap("b", 150000, 260), // SC lap, b moves ahead
        lap("a", 90000, 365), lap("b", 89000, 355),
      ],
    };
    expect(extractTelemetry(json).byGuid.get("b").overtakes).toBe(0);
  });
});

describe("in-game penalties", () => {
  it("counts penalties and normalises Go-nanosecond durations", () => {
    const json = {
      Result: [res("a", 1)],
      Laps: [lap("a", 90000, 100)],
      Penalties: [
        { DriverGUID: "a", TimePenaltyDuration: 5000000000 }, // 5s in ns
        { DriverGUID: "a", TimePenaltyDuration: 3 }, // already seconds
      ],
    };
    const t = extractTelemetry(json).byGuid.get("a");
    expect(t.gamePenalties).toBe(2);
    expect(t.gamePenaltySeconds).toBe(8);
  });
});
