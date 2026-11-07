import { describe, it, expect } from "vitest";
import { driverStatsOf, teamStatsOf, raceStatsOf } from "./seasonAwardStats.js";

const cell = (position, status = "FINISHED", sprint) => ({ position, status, ...(sprint ? { sprint } : {}) });

describe("driverStatsOf", () => {
  it("gives position, points, wins and poles, wins counting sprints", () => {
    const row = { position: 1, total: 220, perRace: { 1: cell(1), 2: cell(2, "FINISHED", cell(1)), 3: cell(null, "DNF") } };
    expect(driverStatsOf(row, 3)).toEqual([
      { value: "P1", label: null },
      { value: "220", label: "pts" },
      { value: "2", label: "wins" },
      { value: "3", label: "poles" },
    ]);
  });
  it("leaves zero counts out and says one win, one pole", () => {
    expect(driverStatsOf({ position: 9, total: 40, perRace: { 1: cell(1) } }, 1)).toEqual([
      { value: "P9", label: null },
      { value: "40", label: "pts" },
      { value: "1", label: "win" },
      { value: "1", label: "pole" },
    ]);
    expect(driverStatsOf({ position: 14, total: 0, perRace: { 1: cell(15) } }, 0)).toEqual([
      { value: "P14", label: null },
      { value: "0", label: "pts" },
    ]);
  });
  it("gives nothing without a standings row or without a start", () => {
    expect(driverStatsOf(null)).toBe(null);
    expect(driverStatsOf({ position: 93, total: 0, perRace: {} })).toBe(null);
    expect(driverStatsOf({ position: 40, total: 0, perRace: { 1: cell(null, "DNS") } })).toBe(null);
  });
});

describe("teamStatsOf", () => {
  it("names the tier the position is in", () => {
    expect(teamStatsOf({ position: 2, total: 312 }, 2)).toEqual([
      { value: "P2", label: "Tier 2" },
      { value: "312", label: "pts" },
    ]);
  });
  it("gives nothing for a team without points", () => {
    expect(teamStatsOf({ position: 1, total: 0 }, 1)).toBe(null);
  });
});

describe("raceStatsOf", () => {
  it("halves the contacts (each is on file for both cars) and counts DNFs", () => {
    const rows = [
      { status: "FINISHED", contacts: 3, overtakes: 5 },
      { status: "DNF", contacts: 2, overtakes: 1 },
      { status: "DSQ", contacts: 0, overtakes: 0 },
      { status: "FINISHED", contacts: 2, overtakes: null },
    ];
    expect(raceStatsOf(rows)).toEqual([
      { value: "4", label: "contacts" },
      { value: "6", label: "overtakes" },
      { value: "2", label: "DNFs" },
    ]);
  });
  it("gives nothing for a race without telemetry or results", () => {
    expect(raceStatsOf([{ status: "FINISHED", contacts: null, overtakes: null }])).toBe(null);
    expect(raceStatsOf([])).toBe(null);
  });
});
