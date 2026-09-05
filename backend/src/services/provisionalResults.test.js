import { describe, it, expect } from "vitest";
import { classifyByLine, coveredByOfficial } from "./provisionalResults.js";

// A v1 file: saved in the running order of the cool-down lap, with gaps
// measured against the car saved first (who did win here, as at Most; the
// board gives the reference car itself a gap of 0, never null).
const most = {
  v: 1,
  laps: 61,
  entries: [
    { guid: "a", name: "13Bot", lapCount: 61, lapsDown: 0, gapToLeaderMs: 0, position: 1 },
    { guid: "b", name: "Rashford", lapCount: 61, lapsDown: 0, gapToLeaderMs: 30983, position: 2 },
    { guid: "c", name: "Siggsta", lapCount: 61, lapsDown: 0, gapToLeaderMs: 8086, position: 3 },
    { guid: "d", name: "Maltegoat", lapCount: 61, lapsDown: 0, gapToLeaderMs: 8316, position: 4 },
    { guid: "e", name: "Duck", lapCount: 60, lapsDown: 1, gapToLeaderMs: null, position: 5 },
    { guid: "f", name: "Tball", lapCount: 61, lapsDown: 0, gapToLeaderMs: 30463, position: 6 },
    { guid: "sc", name: "Pace car", lapCount: 61, isSafetyCar: true, gapToLeaderMs: null, position: 7 },
  ],
};

describe("classifyByLine", () => {
  it("orders a v1 result by laps and the gap at the flag, and renumbers", () => {
    const r = classifyByLine(most);
    expect(r.v).toBe(2);
    expect(r.entries.map((e) => e.name)).toEqual(["13Bot", "Siggsta", "Maltegoat", "Tball", "Rashford", "Duck", "Pace car"]);
    expect(r.entries.map((e) => e.position).slice(0, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.entries[1].gapToLeaderMs).toBe(8086);
    expect(r.entries[5]).toMatchObject({ name: "Duck", lapsDown: 1, gapToLeaderMs: null });
  });

  it("re-bases the gaps when the saved reference was not the winner", () => {
    const r = classifyByLine({
      v: 1,
      entries: [
        { guid: "a", name: "Ref", lapCount: 20, gapToLeaderMs: 4000 },
        { guid: "b", name: "Winner", lapCount: 20, gapToLeaderMs: 1000 },
        { guid: "c", name: "Third", lapCount: 20, gapToLeaderMs: 9000 },
      ],
    });
    expect(r.entries.map((e) => [e.name, e.gapToLeaderMs])).toEqual([["Winner", 0], ["Ref", 3000], ["Third", 8000]]);
  });

  it("leaves an already classified result alone", () => {
    const r = classifyByLine(classifyByLine(most));
    expect(r.entries.map((e) => e.name)).toEqual(["13Bot", "Siggsta", "Maltegoat", "Tball", "Rashford", "Duck", "Pace car"]);
  });
});

describe("coveredByOfficial", () => {
  const r = { finishedAt: "2026-09-04T19:25:00Z", trackName: "NABS Autodrom Most (no chicane)", track: "rt_autodrom_most" };

  it("the league's race of that evening on that circuit, with results in, covers it", () => {
    expect(coveredByOfficial(r, [{ date: "2026-09-04T17:30:00Z", track: "Most" }])).toBe(true);
    // a date-only row (midnight) still counts
    expect(coveredByOfficial(r, [{ date: "2026-09-04T00:00:00Z", track: "Most" }])).toBe(true);
  });

  it("another circuit or another week does not", () => {
    expect(coveredByOfficial(r, [{ date: "2026-09-04T17:30:00Z", track: "Spa" }])).toBe(false);
    expect(coveredByOfficial(r, [{ date: "2026-08-28T17:30:00Z", track: "Most" }])).toBe(false);
    expect(coveredByOfficial(r, [{ date: "2026-09-11T17:30:00Z", track: "Most" }])).toBe(false);
    expect(coveredByOfficial(r, [])).toBe(false);
  });
});
