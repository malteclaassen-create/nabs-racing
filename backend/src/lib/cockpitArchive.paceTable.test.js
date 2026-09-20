// The whole field's race pace from one result file: ranked by clean median,
// cars that ran too little kept but unranked.
import { describe, it, expect } from "vitest";
import { fieldPaceTable, raceInsightsFor } from "./cockpitArchive.js";

const lap = (guid, ms, tyre = "M") => ({ DriverGuid: guid, LapTime: ms, Sectors: [ms / 3, ms / 3, ms / 3], Tyre: tyre, Cuts: 0 });
const laps = (guid, times) => times.map((t) => lap(guid, t));

function raceFile() {
  const fast = laps("1", [100_000, 98_000, 98_100, 97_900, 98_050, 130_000, 98_000, 97_950, 98_100, 98_000]);
  const slow = laps("2", [101_000, 99_500, 99_600, 99_400, 99_550, 99_500, 99_450, 99_600, 99_500, 99_550]);
  const early = laps("3", [99_000, 98_500, 98_600]); // out after three laps
  return {
    Type: "RACE",
    Result: [
      { DriverGuid: "1", DriverName: "Quick" },
      { DriverGuid: "2", DriverName: "Steady" },
      { DriverGuid: "3", DriverName: "Gone" },
    ],
    Laps: [...fast, ...slow, ...early],
  };
}

describe("fieldPaceTable", () => {
  it("ranks the cars that ran the distance by their clean median, and keeps the rest unranked", () => {
    const t = fieldPaceTable(raceFile());
    expect(t.field).toBe(2);
    expect(t.rows.map((r) => [r.name, r.rank])).toEqual([
      ["Quick", 1],
      ["Steady", 2],
      ["Gone", null],
    ]);
    // The pit lap (130 s) is not part of the clean median.
    expect(t.rows[0].paceMs).toBe(98_000);
    expect(t.rows[0].gapMs).toBe(0);
    expect(t.rows[1].gapMs).toBe(1_525);
    expect(t.rows[2].gapMs).toBeNull();
    expect(t.rows[2].laps).toBe(3);
    expect(t.rows[0].bestLapMs).toBe(97_900);
  });

  it("says the same as the one-driver insight", () => {
    const json = raceFile();
    const t = fieldPaceTable(json);
    const ins = raceInsightsFor(json, "2");
    const row = t.rows.find((r) => r.guid === "2");
    expect(row.paceMs).toBe(ins.ownPaceMs);
    expect(row.rank).toBe(ins.paceRank);
    expect(t.field).toBe(ins.paceField);
  });

  it("is null without laps", () => {
    expect(fieldPaceTable({ Laps: [] })).toBeNull();
    expect(fieldPaceTable(null)).toBeNull();
  });
});
