import { describe, it, expect } from "vitest";
import { clockDrift, clockNote } from "./reportClock.js";

// The evening this was written for: the relay machine runs on UTC, the league
// reads its site from Berlin, and every in-game report carried two times two
// hours apart with nothing to say which one a steward should scrub to.
describe("in-game report clocks", () => {
  const arrived = new Date("2026-08-14T18:36:05.027Z");

  it("a whole timezone between the app and the site is not drift", () => {
    // What actually landed on 14 Aug: the app said 18:36:03, the report was
    // stamped 18:36:05Z and shown as 20:36:05 in Berlin. One moment, three
    // renderings, nothing wrong.
    expect(clockDrift("18:36:03", arrived)).toBe(null);
    expect(clockNote("18:36:03", arrived)).toBe(null);
  });

  it("neither is a clock two hours out from a different zone", () => {
    expect(clockDrift("20:36:04", arrived)).toBe(null); // as if the app ran on Berlin time
    expect(clockDrift("13:36:07", arrived)).toBe(null); // …or New York
    expect(clockDrift("00:06:05", arrived)).toBe(null); // …or Kathmandu, +5:45
  });

  it("a clock genuinely set wrong still gets said out loud", () => {
    const note = clockNote("18:24:05", arrived); // twelve minutes early
    expect(note).toContain("18:24:05");
    expect(note).toContain("12 minutes");
    expect(note).toContain("behind");
  });

  // A PC eight minutes fast sits nearer the NEXT quarter hour than its own, so
  // dividing the timezone out at quarter-hour steps reported it as seven
  // minutes slow — the drift said out loud, in the wrong direction.
  it("reads drift the right way round", () => {
    expect(clockDrift("18:44:05", arrived)).toBe(8 * 60); // app ahead
    expect(clockDrift("18:28:05", arrived)).toBe(-8 * 60); // app behind
    expect(clockNote("18:44:05", arrived)).toContain("ahead of");
  });

  it("a foreign timezone AND a wrong clock still reports only the wrong clock", () => {
    expect(clockDrift("20:44:05", arrived)).toBe(8 * 60); // Berlin, eight minutes fast
  });

  it("a session over midnight is drift of seconds, not of a day", () => {
    const justBefore = new Date("2026-08-14T23:59:58.000Z");
    expect(clockDrift("00:00:01", justBefore)).toBe(null);
  });

  it("says nothing at all when there is no clock to read", () => {
    expect(clockNote("", arrived)).toBe(null);
    expect(clockNote("Malte", arrived)).toBe(null);
    expect(clockNote("25:00:00", arrived)).toBe(null);
    expect(clockNote("18:21:05", new Date("nonsense"))).toBe(null);
  });
});
