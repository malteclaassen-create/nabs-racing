import { describe, it, expect } from "vitest";
import { RECENT_ROUNDS, recentRoundIds, withinRounds } from "./reportWindow.js";

const race = (id, date) => ({ id, date });

describe("recentRoundIds", () => {
  it("keeps the newest rounds by date, not the order they arrive in", () => {
    const races = [
      race("r1", "2026-08-01"),
      race("r3", "2026-08-14"),
      race("r2", "2026-08-07"),
      race("r0", "2026-07-25"),
    ];
    expect([...recentRoundIds(races, 2)]).toEqual(["r3", "r2"]);
  });

  it("takes everything when there are fewer rounds than the window", () => {
    expect(recentRoundIds([race("r1", "2026-08-01")], 3).size).toBe(1);
  });

  it("sorts a round with no date last, so it cannot push a race night out", () => {
    const races = [race("undated", null), race("r1", "2026-08-01"), race("r2", "2026-08-14")];
    const kept = recentRoundIds(races, 2);
    expect([...kept]).toEqual(["r2", "r1"]);
    expect(kept.has("undated")).toBe(false);
  });

  it("treats an unparseable date the same as a missing one", () => {
    const races = [race("junk", "not a date"), race("r1", "2026-08-01"), race("r2", "2026-08-14")];
    expect([...recentRoundIds(races, 2)]).toEqual(["r2", "r1"]);
  });

  it("is empty for no rounds, a zero window, or something that is not a list", () => {
    expect(recentRoundIds([], 3).size).toBe(0);
    expect(recentRoundIds([race("r1", "2026-08-01")], 0).size).toBe(0);
    expect(recentRoundIds(null, 3).size).toBe(0);
  });

  it("defaults to the shipped window", () => {
    const races = ["a", "b", "c", "d", "e"].map((id, i) => race(id, `2026-08-0${i + 1}`));
    expect(recentRoundIds(races).size).toBe(RECENT_ROUNDS);
  });
});

describe("withinRounds", () => {
  const reports = [
    { id: "1", raceId: "r2" },
    { id: "2", raceId: "r1" },
    { id: "3", raceId: null },
    { id: "4", raceId: "old" },
  ];

  it("serves the windowed rounds and everything with no round at all", () => {
    const kept = withinRounds(reports, new Set(["r1", "r2"]));
    expect(kept.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("still serves a report with no round when the window is empty", () => {
    expect(withinRounds(reports, new Set()).map((r) => r.id)).toEqual(["3"]);
  });
});
