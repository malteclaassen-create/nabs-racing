import { describe, it, expect } from "vitest";
import { analyzeSeason } from "./integrityService.js";

// Minimal season fixture: two T1 teams with two drivers each, one completed
// round whose stored constructor scores match the results exactly.
function fixture() {
  const teams = [
    { id: "t1a", name: "Alpha", tier: 1, color: "#ff0000", seasonId: "s7" },
    { id: "t1b", name: "Beta", tier: 1, color: "#0000ff", seasonId: "s7" },
    { id: "res", name: "Reserve", tier: 0, color: "#888888", seasonId: "s7" },
  ];
  const drivers = [
    { id: "d1", name: "Anna", teamId: "t1a", tier: 1, seasonId: "s7" },
    { id: "d2", name: "Ben", teamId: "t1a", tier: 1, seasonId: "s7" },
    { id: "d3", name: "Cleo", teamId: "t1b", tier: 1, seasonId: "s7" },
    { id: "d4", name: "Rick", teamId: "res", tier: 0, seasonId: "s7" },
  ];
  const races = [
    { id: "r1", number: 1, isCompleted: true, isSpecialEvent: false, seasonId: "s7", date: null, track: "A" },
  ];
  const results = [
    { raceId: "r1", driverId: "d1", position: 1, points: 35, status: "FINISHED", penaltySeconds: 0 },
    { raceId: "r1", driverId: "d2", position: 2, points: 30, status: "FINISHED", penaltySeconds: 0 },
    { raceId: "r1", driverId: "d3", position: 3, points: 25, status: "FINISHED", penaltySeconds: 0 },
  ];
  const scores = [
    { raceId: "r1", teamId: "t1a", tier: 1, points: 65 },
    { raceId: "r1", teamId: "t1b", tier: 1, points: 25 },
  ];
  return { season: { name: "S7" }, teams, drivers, races, results, scores, dropWorst: 0 };
}

describe("analyzeSeason", () => {
  it("reports nothing for a clean season", () => {
    const { issues } = analyzeSeason(fixture());
    expect(issues).toEqual([]);
  });

  it("flags a stored constructor score that no longer matches the results", () => {
    const f = fixture();
    f.scores[0].points = 60; // official says 60, results say 65
    const { issues } = analyzeSeason(f);
    expect(issues.some((i) => i.severity === "warning" && i.area === "Team points" && i.message.includes("Alpha"))).toBe(true);
  });

  it("flags stored points that contradict the stored position (the R7 case)", () => {
    const f = fixture();
    f.results[1].points = 25; // P2 should be 30
    f.scores[0].points = 60; // keep the team sum consistent so only one issue fires
    const { issues } = analyzeSeason(f);
    expect(issues.some((i) => i.message.includes("Ben") && i.message.includes("P2"))).toBe(true);
  });

  it("does NOT flag point/position differences when the round had time penalties", () => {
    const f = fixture();
    f.results[1].points = 25;
    f.results[1].penaltySeconds = 5; // a penalty legitimately shifts the classification
    f.scores[0].points = 60;
    const { issues } = analyzeSeason(f);
    expect(issues.some((i) => i.message.includes("Ben") && i.message.includes("per the table"))).toBe(false);
  });

  it("flags duplicate finishing positions as an error", () => {
    const f = fixture();
    f.results[2].position = 2; // Ben and Cleo both P2
    const { issues } = analyzeSeason(f);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("P2"))).toBe(true);
  });

  it("flags a finisher without a position", () => {
    const f = fixture();
    f.results.push({ raceId: "r1", driverId: "d4", position: null, points: 22, status: "FINISHED", penaltySeconds: 0 });
    const { issues } = analyzeSeason(f);
    expect(issues.some((i) => i.message.includes("Rick") && i.message.includes("no stored position"))).toBe(true);
  });

  it("flags reserve points that count for no team", () => {
    const f = fixture();
    f.results.push({ raceId: "r1", driverId: "d4", position: 4, points: 22, status: "FINISHED", penaltySeconds: 0 });
    const { issues } = analyzeSeason(f);
    expect(issues.some((i) => i.area === "Assignment" && i.message.includes("Rick") && i.message.includes("no team"))).toBe(true);
  });

  it("flags a non-finisher with stored points", () => {
    const f = fixture();
    f.results[2].status = "DNF";
    f.scores[1].points = 0;
    const { issues } = analyzeSeason(f);
    expect(issues.some((i) => i.message.includes("Cleo") && i.message.includes("DNF"))).toBe(true);
  });

  it("flags near-identical team colours in the same tier", () => {
    const f = fixture();
    f.teams[1].color = "#fe0101"; // basically Alpha's red
    f.scores = []; // avoid unrelated recompute noise
    const { issues } = analyzeSeason(f);
    expect(issues.some((i) => i.area === "Teams" && i.message.includes("colours"))).toBe(true);
  });

  it("flags a completed round without results and cross-season references", () => {
    const f = fixture();
    f.races.push({ id: "r2", number: 2, isCompleted: true, isSpecialEvent: false, seasonId: "s7", date: null, track: "B" });
    f.drivers[0].seasonId = "s6"; // Anna suddenly belongs to another season
    const { issues } = analyzeSeason(f);
    expect(issues.some((i) => i.message.includes("Round 2") && i.message.includes("no results"))).toBe(true);
    expect(issues.some((i) => i.severity === "error" && i.area === "Season" && i.message.includes("Anna"))).toBe(true);
  });
});
