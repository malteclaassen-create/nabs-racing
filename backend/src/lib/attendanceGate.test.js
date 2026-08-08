import { describe, it, expect } from "vitest";
import { attendanceGate, SIGNUP_CLOSE_AFTER_START_MS } from "./attendanceGate.js";

// The gate is pure (race + settings in, verdict out), so the auto-close rule
// added 2026-08-08 — sign-up shuts an hour after the race starts — can be
// pinned down without a database.

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const HOUR = 60 * 60 * 1000;

describe("attendanceGate auto-close after start", () => {
  it("a future race with no window rule is open", () => {
    const g = attendanceGate({ id: "r1", date: iso(2 * HOUR) }, {});
    expect(g.open).toBe(true);
    expect(g.closedForStart).toBe(false);
  });

  it("stays open during the first hour after lights-out (the stragglers' minute)", () => {
    const g = attendanceGate({ id: "r1", date: iso(-HOUR / 2) }, {});
    expect(g.open).toBe(true);
    expect(g.closedForStart).toBe(false);
  });

  it("closes once the race has been under way for an hour", () => {
    const g = attendanceGate({ id: "r1", date: iso(-(SIGNUP_CLOSE_AFTER_START_MS + 60_000)) }, {});
    expect(g.open).toBe(false);
    expect(g.closedForStart).toBe(true);
    expect(g.opensAt).toBe(null); // no future opening to promise
  });

  it("an admin forcing it open beats the auto-close (the hand wins)", () => {
    const race = { id: "r1", date: iso(-3 * HOUR) };
    const g = attendanceGate(race, {}, { r1: "open" });
    expect(g.open).toBe(true);
    expect(g.closedForStart).toBe(false);
  });

  it("an admin forcing it closed reports forced, not closedForStart", () => {
    const race = { id: "r1", date: iso(-3 * HOUR) };
    const g = attendanceGate(race, {}, { r1: "closed" });
    expect(g.open).toBe(false);
    expect(g.forced).toBe("closed");
    expect(g.closedForStart).toBe(false);
  });

  it("a race without a date cannot have started", () => {
    const g = attendanceGate({ id: "r1", date: null }, {});
    expect(g.open).toBe(true);
    expect(g.closedForStart).toBe(false);
  });
});
