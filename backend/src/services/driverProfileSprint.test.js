import { describe, it, expect } from "vitest";
import { sprintStatsOf } from "./driverProfileService.js";

// The sprint half of a driver's record, kept apart from the feature races.
describe("sprintStatsOf", () => {
  it("is null without a sprint weekend, so the sprint tiles hide", () => {
    expect(sprintStatsOf([])).toBeNull();
    expect(sprintStatsOf([null, null])).toBeNull();
  });

  it("counts starts, finishes, wins and podiums over the sprints run", () => {
    const s = sprintStatsOf([
      { status: "FINISHED", position: 1, points: 35 },
      { status: "FINISHED", position: 3, points: 25 },
      { status: "DNF", position: null, points: 0 },
      { status: "DNS", position: null, points: 0 },
    ]);
    expect(s).toEqual({
      rounds: 4, starts: 3, finishes: 2, wins: 1, podiums: 2,
      bestFinish: 1, worstFinish: 3, avgFinish: 2, points: 60,
    });
  });

  it("a driver who missed every sprint has the rounds but no finish", () => {
    const s = sprintStatsOf([{ status: "DNS", position: null, points: 0 }]);
    expect(s.starts).toBe(0);
    expect(s.bestFinish).toBeNull();
    expect(s.avgFinish).toBeNull();
  });
});
