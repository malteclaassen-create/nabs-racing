import { describe, it, expect } from "vitest";
import { podiumTimes } from "./resultShareImage.js";

describe("podiumTimes", () => {
  it("gives the winner's race time and the others' gap, penalties included", () => {
    const rows = [
      { totalTimeMs: 5085550, penaltySeconds: 0, laps: 56 },
      { totalTimeMs: 5087035, penaltySeconds: 0, laps: 56 },
      { totalTimeMs: 5090083, penaltySeconds: 5, laps: 56 },
    ];
    expect(podiumTimes(rows)).toEqual(["1:24:45.550", "+1.485", "+9.533"]);
  });

  it("says laps down for a lapped car instead of a time gap", () => {
    const rows = [
      { totalTimeMs: 3600000, laps: 40 },
      { totalTimeMs: 3610000, laps: 39 },
      { totalTimeMs: 3620000, laps: 38 },
    ];
    expect(podiumTimes(rows)).toEqual(["1:00:00.000", "+1 LAP", "+2 LAPS"]);
  });

  it("puts minutes in a long gap and falls back to points without times", () => {
    expect(podiumTimes([{ totalTimeMs: 600000 }, { totalTimeMs: 675500 }])).toEqual(["10:00.000", "+1:15.500"]);
    expect(podiumTimes([{ points: 25 }, { points: 18 }])).toEqual(["25 PTS", "18 PTS"]);
  });
});
