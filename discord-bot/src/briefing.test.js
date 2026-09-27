import { describe, it, expect } from "vitest";
import { briefingOpen } from "./briefing.js";

const times = { beforeMin: 5, afterMin: 60, kickoffs: ["2026-10-02T17:30:00.000Z"] };
const at = (min) => Date.parse(times.kickoffs[0]) + min * 60_000;

describe("briefingOpen", () => {
  it("only around a start", () => {
    expect(briefingOpen(times, at(-6))).toBe(false);
    expect(briefingOpen(times, at(-5))).toBe(true);
    expect(briefingOpen(times, at(30))).toBe(true);
    expect(briefingOpen(times, at(61))).toBe(false);
  });
  it("nothing known yet is closed", () => {
    expect(briefingOpen(null, at(0))).toBe(false);
    expect(briefingOpen({ kickoffs: [] }, at(0))).toBe(false);
  });
});

describe("Start now", () => {
  it("opens it outside the race times till openUntil", () => {
    const manual = { ...times, openUntil: new Date(at(-120)).toISOString() };
    expect(briefingOpen(manual, at(-180))).toBe(true);
    expect(briefingOpen(manual, at(-119))).toBe(false);
  });
});
