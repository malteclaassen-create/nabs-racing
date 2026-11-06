import { describe, it, expect } from "vitest";
import { liveryDeadline, defaultLiveryDeadline, carLocked, parseLiveryClosesAt } from "./eventCars.js";

const race = { id: "r1", date: new Date("2026-11-06T18:30:00Z") };

describe("liveryDeadline", () => {
  it("closes 25 hours before the start by default", () => {
    expect(liveryDeadline(race).toISOString()).toBe("2026-11-05T17:30:00.000Z");
    expect(defaultLiveryDeadline(race).toISOString()).toBe("2026-11-05T17:30:00.000Z");
  });
  it("uses the admin's own time for the event when one is set", () => {
    const own = { ...race, liveryClosesAt: new Date("2026-11-06T16:00:00Z") };
    expect(liveryDeadline(own).toISOString()).toBe("2026-11-06T16:00:00.000Z");
  });
  it("opens the liveries again when the admin's time is later than now", () => {
    const now = Date.parse("2026-11-06T05:00:00Z");
    expect(carLocked(race, now)).toBe(true);
    expect(carLocked({ ...race, liveryClosesAt: "2026-11-06T16:00:00Z" }, now)).toBe(false);
  });
});

describe("parseLiveryClosesAt", () => {
  it("leaves it alone when not sent, clears on empty", () => {
    expect(parseLiveryClosesAt(undefined)).toEqual({ ok: false });
    expect(parseLiveryClosesAt("")).toEqual({ ok: true, value: null });
    expect(parseLiveryClosesAt(null)).toEqual({ ok: true, value: null });
  });
  it("stores an ISO time and refuses nonsense", () => {
    expect(parseLiveryClosesAt("2026-11-06T16:00:00Z")).toEqual({ ok: true, value: "2026-11-06T16:00:00.000Z" });
    expect(parseLiveryClosesAt("tomorrow-ish").error).toBeTruthy();
  });
});
