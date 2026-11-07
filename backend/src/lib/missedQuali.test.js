import { describe, it, expect } from "vitest";
import { sheetOf, missedQuali, statGrid } from "./missedQuali.js";

const sheet = (entries) => new Map([["r1", sheetOf(JSON.stringify({ entries }))]]);

describe("missed qualifying", () => {
  it("drops the grid slot of a driver who is not on the sheet", () => {
    const sheets = sheet([{ driverId: "a", position: 1 }, { driverId: "b", position: 2 }]);
    expect(missedQuali({ raceId: "r1", driverId: "c", grid: 3 }, sheets)).toBe(true);
    expect(statGrid({ raceId: "r1", driverId: "c", grid: 3 }, sheets)).toBe(null);
  });

  it("keeps the grid slot of a driver who qualified", () => {
    const sheets = sheet([{ driverId: "a", position: 1 }, { driverId: "b", position: 2 }]);
    expect(statGrid({ raceId: "r1", driverId: "b", grid: 2 }, sheets)).toBe(2);
  });

  it("keeps every grid slot of a round with no qualifying on file", () => {
    expect(statGrid({ raceId: "r2", driverId: "c", grid: 36 }, sheet([{ driverId: "a" }]))).toBe(36);
  });

  it("with an unmatched entrant, only a slot behind the whole sheet counts as missed", () => {
    const sheets = sheet([{ driverId: "a" }, { driverId: null, name: "Someone" }, { driverId: "b" }]);
    // could be the unmatched entrant, so it stays
    expect(statGrid({ raceId: "r1", driverId: "c", grid: 2 }, sheets)).toBe(2);
    // behind all three cars on the sheet: never set a lap there
    expect(statGrid({ raceId: "r1", driverId: "c", grid: 4 }, sheets)).toBe(null);
  });

  it("ignores a corrupt or empty blob", () => {
    expect(sheetOf("{nope")).toBe(null);
    expect(sheetOf(JSON.stringify({ entries: [] }))).toBe(null);
  });
});
