import { describe, it, expect } from "vitest";
import { eventDateOf } from "./series.js";
import { parseKind } from "../lib/series.js";

const NOW = Date.parse("2026-10-17T12:00:00Z");

describe("eventDateOf", () => {
  it("is null while no race has a date", () => {
    expect(eventDateOf([], NOW)).toBe(null);
    expect(eventDateOf([{ date: null, isCompleted: false }], NOW)).toBe(null);
  });

  it("picks the first race still to come", () => {
    const races = [
      { date: "2026-11-13T17:30:00Z", isCompleted: false },
      { date: "2026-11-06T17:30:00Z", isCompleted: false },
      { date: "2026-10-01T17:30:00Z", isCompleted: true },
    ];
    expect(eventDateOf(races, NOW)).toBe("2026-11-06T17:30:00.000Z");
  });

  it("keeps tonight's race until it is marked done or a day has gone", () => {
    const races = [{ date: "2026-10-17T08:00:00Z", isCompleted: false }];
    expect(eventDateOf(races, NOW)).toBe("2026-10-17T08:00:00.000Z");
  });

  it("falls back to the last race once it is all over", () => {
    const races = [
      { date: "2026-09-01T17:30:00Z", isCompleted: true },
      { date: "2026-10-01T17:30:00Z", isCompleted: true },
    ];
    expect(eventDateOf(races, NOW)).toBe("2026-10-01T17:30:00.000Z");
  });
});

describe("parseKind", () => {
  it("stores a championship as null and an event as 'event'", () => {
    expect(parseKind("championship")).toEqual({ ok: true, value: null });
    expect(parseKind("Event")).toEqual({ ok: true, value: "event" });
    expect(parseKind("")).toEqual({ ok: true, value: null });
    expect(parseKind(undefined)).toEqual({ ok: true, skip: true });
  });

  it("rejects anything else", () => {
    expect(parseKind("cup").ok).toBe(false);
  });
});
