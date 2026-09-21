import { describe, it, expect } from "vitest";
import { milestonesOf, prettiestName } from "./careerService.js";

// A short career, oldest first, the way the page hands it over.
const race = (over) => ({
  seriesName: "F1 Friday",
  seasonNumber: 1,
  round: 1,
  track: "Silverstone",
  date: null,
  status: "FINISHED",
  position: 10,
  points: 0,
  pole: false,
  ...over,
});

describe("prettiestName", () => {
  it("picks the spelling that reads like a name", () => {
    expect(prettiestName(["RedBullRing", "Red Bull Ring"])).toBe("Red Bull Ring");
    expect(prettiestName(["interlagos", "Interlagos"])).toBe("Interlagos");
    expect(prettiestName(["Monza"])).toBe("Monza");
    expect(prettiestName([])).toBe(null);
  });
});

describe("milestonesOf", () => {
  it("names the firsts and leaves out the ones that never happened", () => {
    const m = milestonesOf([
      race({ round: 1, status: "DNS", position: null }),
      race({ round: 2, position: 12 }),
      race({ round: 3, position: 8, points: 14 }),
      race({ round: 4, position: 2, points: 30 }),
    ]);
    expect(m.map((x) => x.key)).toEqual(["firstStart", "firstPoints", "firstPodium"]);
    expect(m[0].round).toBe(2); // a DNS is not a start
    expect(m[1].round).toBe(3);
    expect(m[2].round).toBe(4);
  });

  it("counts a win and a pole, and the round counts once they are reached", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      race({ round: i + 1, position: i === 5 ? 1 : 9, points: 2, pole: i === 7 })
    );
    const m = milestonesOf(many);
    const keys = m.map((x) => x.key);
    expect(keys).toContain("firstWin");
    expect(keys).toContain("firstPole");
    expect(keys).toContain("start25");
    expect(keys).not.toContain("start50");
    expect(m.find((x) => x.key === "firstWin").round).toBe(6);
    expect(m.find((x) => x.key === "firstPole").round).toBe(8);
  });

  it("orders by when it happened, not by which first it is", () => {
    const m = milestonesOf([
      race({ round: 1, date: "2026-01-02", position: 1, points: 30, pole: true }),
      race({ round: 2, date: "2026-01-09", position: 5, points: 20 }),
    ]);
    // Everything happened on the debut, so the debut's entries come first and
    // nothing from the later round jumps ahead of them.
    expect(m.every((x) => x.round === 1)).toBe(true);
  });

  it("says nothing about a career with no starts", () => {
    expect(milestonesOf([race({ status: "DNS", position: null })])).toEqual([]);
    expect(milestonesOf([])).toEqual([]);
  });
});
