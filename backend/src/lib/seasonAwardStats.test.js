import { describe, it, expect } from "vitest";
import {
  statKindOf,
  driverSeason,
  driverStatsOf,
  pairStatsOf,
  driveStatsOf,
  teamStatsOf,
  raceStatsOf,
} from "./seasonAwardStats.js";

const cell = (position, status = "FINISHED", sprint) => ({ position, status, ...(sprint ? { sprint } : {}) });
const text = (stats) => (stats || []).map((x) => [x.pre, x.value, x.label].filter(Boolean).join(" ")).join(" · ");

describe("statKindOf", () => {
  it("reads what the figures should be about from the award's name", () => {
    expect(statKindOf("Qualifying Merchant")).toBe("quali");
    expect(statKindOf("Pole Master")).toBe("quali");
    expect(statKindOf("Cleanest Racer")).toBe("clean");
    expect(statKindOf("Fair Play Award")).toBe("clean");
    expect(statKindOf("Most Improved")).toBe("improved");
    expect(statKindOf("Biggest Climber")).toBe("climber");
    expect(statKindOf("Going Against The Grain")).toBe("climber");
    expect(statKindOf("T1 Driver of the Season")).toBe("season");
    expect(statKindOf("Most Chaotic Race", "race")).toBe("chaos");
    expect(statKindOf("Race of the Season", "race")).toBe("race");
  });
});

describe("driverStatsOf", () => {
  const row = { position: 1, total: 265, perRace: { 1: cell(1), 2: cell(2, "FINISHED", cell(1)), 3: cell(5), 4: cell(null, "DNF") } };
  const results = [
    { status: "FINISHED", position: 1, grid: 10, contacts: 2, overtakes: 9 },
    { status: "FINISHED", position: 2, grid: 2, contacts: 0, overtakes: 1 },
    { status: "FINISHED", position: 5, grid: 3, contacts: 4, overtakes: 2 },
    { status: "DNF", position: null, grid: 6, contacts: 2, overtakes: 0 },
  ];
  const s = driverSeason(row, results, [1, 2, 4, 6], 1);

  it("gives a season award position, points, wins and poles", () => {
    expect(text(driverStatsOf(s, "season"))).toBe("P1 · 265 pts · 2 wins · 1 pole");
  });
  it("gives a qualifying award qualifying figures only", () => {
    expect(text(driverStatsOf(s, "quali"))).toBe("1 pole · 2 front rows · avg quali P3.3");
  });
  it("gives a clean-racing award contacts per race, DNFs (even none) and starts (a sprint is a start)", () => {
    expect(text(driverStatsOf(s, "clean"))).toBe("2.0 contacts per race · 1 DNF · 5 starts");
    const clean = driverSeason({ position: 3, total: 9, perRace: { 1: cell(3) } }, [{ status: "FINISHED", position: 3, grid: 3, contacts: 0 }]);
    expect(text(driverStatsOf(clean, "clean"))).toBe("0.0 contacts per race · 0 DNFs · 1 start");
  });
  it("gives a climber places gained and overtakes", () => {
    expect(text(driverStatsOf(s, "climber"))).toBe("+7 places gained · 12 overtakes");
  });
  it("gives most improved last season's position against this one's", () => {
    expect(text(driverStatsOf(s, "improved", 14))).toBe("P14 → P1 · 265 pts");
    expect(text(driverStatsOf(s, "improved", null))).toBe("P1 · 265 pts · 2 wins · 1 pole");
  });
  it("gives nothing for a driver who never started", () => {
    expect(driverStatsOf(driverSeason({ position: 93, total: 0, perRace: {} }), "season")).toBe(null);
    expect(driverStatsOf(driverSeason(null), "season")).toBe(null);
  });
});

describe("pairStatsOf", () => {
  it("gives both positions and what they scored together", () => {
    const a = driverSeason({ position: 12, total: 80, perRace: { 1: cell(3) } });
    const b = driverSeason({ position: 9, total: 92, perRace: { 1: cell(1) } });
    expect(text(pairStatsOf(a, b))).toBe("P12 & P9 · 172 pts together · 1 win");
  });
});

describe("driveStatsOf", () => {
  it("tells the race the award was won in", () => {
    expect(text(driveStatsOf({ status: "FINISHED", position: 1, grid: 14, overtakes: 9 }))).toBe("P1 from P14 · 9 overtakes");
    expect(text(driveStatsOf({ status: "DNF", position: null, grid: 3, overtakes: 0 }))).toBe("DNF from P3");
    expect(driveStatsOf({ status: "DNS" })).toBe(null);
    expect(driveStatsOf(undefined)).toBe(null);
  });
});

describe("teamStatsOf", () => {
  it("names the tier, and gives nothing without points", () => {
    expect(text(teamStatsOf({ position: 2, total: 312 }, 2))).toBe("P2 Tier 2 · 312 pts");
    expect(teamStatsOf({ position: 1, total: 0 }, 1)).toBe(null);
  });
});

describe("raceStatsOf", () => {
  const rows = [
    { driverId: "a", status: "FINISHED", position: 1, grid: 36, contacts: 3, overtakes: 5 },
    { driverId: "b", status: "DNF", position: null, grid: 1, contacts: 2, overtakes: 1 },
    { driverId: "c", status: "DSQ", position: null, grid: 2, contacts: 0, overtakes: 0 },
    { driverId: "d", status: "FINISHED", position: 1, grid: 4, contacts: 2, overtakes: null, sprint: true },
  ];
  it("gives a chaotic race contacts (halved: each is on file for both cars), DNFs and overtakes", () => {
    expect(text(raceStatsOf(rows, "chaos"))).toBe("4 contacts · 2 DNFs · 6 overtakes");
  });
  it("gives a race of the season its feature race winner and where they started", () => {
    expect(text(raceStatsOf(rows, "race", new Map([["a", "13bot"], ["d", "Sprinter"]])))).toBe("won by 13bot from P36 · 6 overtakes");
  });
  it("gives nothing for a race without telemetry or results", () => {
    expect(raceStatsOf([{ status: "FINISHED", contacts: null, overtakes: null }], "chaos")).toBe(null);
    expect(raceStatsOf([], "race")).toBe(null);
  });
});
