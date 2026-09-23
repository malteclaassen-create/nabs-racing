import { describe, it, expect } from "vitest";
import { overdueRounds, OVERDUE_AFTER_MS } from "./overdueRounds.js";

const NOW = Date.parse("2026-07-05T12:00:00Z");
const race = (over) => ({
  id: "r",
  number: 11,
  track: "COTA",
  date: "2026-07-03T18:00:00Z",
  isCompleted: false,
  isSpecialEvent: false,
  resultCount: 0,
  ...over,
});

describe("overdueRounds", () => {
  it("lists a championship round that ran and has no result", () => {
    expect(overdueRounds([race({ id: "r11" })], { now: NOW })).toEqual([
      { raceId: "r11", number: 11, track: "COTA", date: "2026-07-03T18:00:00.000Z" },
    ]);
  });

  it("waits twelve hours after the start before calling it overdue", () => {
    const start = NOW - OVERDUE_AFTER_MS;
    expect(overdueRounds([race({ date: new Date(start).toISOString() })], { now: NOW })).toEqual([]);
    expect(overdueRounds([race({ date: new Date(start - 60_000).toISOString() })], { now: NOW })).toHaveLength(1);
  });

  it("leaves out what is done, undated, in the future, or not a round", () => {
    const rows = [
      race({ id: "done", isCompleted: true }),
      race({ id: "has-results", resultCount: 30 }),
      race({ id: "undated", date: null }),
      race({ id: "future", date: "2026-07-10T18:00:00Z" }),
      race({ id: "special", isSpecialEvent: true, number: null }),
      race({ id: "training" }),
      race({ id: "sprint" }),
    ];
    const typeOf = new Map([["training", "TRAINING"]]);
    expect(overdueRounds(rows, { now: NOW, typeOf, sprintChildIds: new Set(["sprint"]) })).toEqual([]);
  });

  it("puts the round that has waited longest first", () => {
    const rows = [race({ id: "r12", number: 12, date: "2026-07-04T18:00:00Z" }), race({ id: "r11" })];
    expect(overdueRounds(rows, { now: NOW }).map((r) => r.raceId)).toEqual(["r11", "r12"]);
  });
});
