// The search snippet for the season landing page, and the one fact in it that
// could ever go stale: the race night.
//
// The page turns up under a wide spread of searches (F1 league, Assetto Corsa
// league, online sim racing), so the snippet is deliberately broad and says
// nothing about the season in progress. What it does claim, it has to be able to
// back up, which is what most of these tests are about: the league races Friday
// evenings today and may not always, so the day is read off the calendar and
// dropped entirely whenever the calendar does not clearly support one.
import { describe, it, expect } from "vitest";
import { seasonDescription, raceNight } from "./pageMeta.js";

// Real Fridays and Sundays in league time, stored the way the app stores them.
const FRIDAYS = ["2026-05-01", "2026-05-08", "2026-05-15", "2026-05-22", "2026-05-29"];
const SUNDAYS = ["2026-05-03", "2026-05-10", "2026-05-17", "2026-05-24"];
const SATURDAYS = ["2026-05-02", "2026-05-09", "2026-05-16", "2026-05-23"];
// 17:00 UTC is 19:00 in Berlin in May, the league's usual start.
const at = (days, time = "T17:00:00.000Z") => days.map((d) => ({ date: `${d}${time}` }));

describe("raceNight", () => {
  it("names the night the calendar settles on", () => {
    expect(raceNight(at(FRIDAYS))).toBe("Friday night");
    expect(raceNight(at(SUNDAYS))).toBe("Sunday night");
  });

  it("follows a move to another day without anything being edited", () => {
    expect(raceNight(at(SATURDAYS))).toBe("Saturday night");
  });

  it("names no day when the calendar is split between two", () => {
    expect(raceNight([...at(FRIDAYS.slice(0, 3)), ...at(SATURDAYS.slice(0, 3))])).toBe(null);
  });

  it("still names the day when a single round falls outside the pattern", () => {
    expect(raceNight([...at(FRIDAYS), ...at(SATURDAYS.slice(0, 1))])).toBe("Friday night");
  });

  it("leaves out 'night' for an afternoon series", () => {
    expect(raceNight(at(SUNDAYS, "T13:00:00.000Z"))).toBe("Sunday");
  });

  it("treats a date with no time as the league's usual 19:00", () => {
    // The archive holds date-only rows; raceKickoff supplies the evening.
    expect(raceNight(at(FRIDAYS, "T00:00:00.000Z"))).toBe("Friday night");
  });

  it("names nothing when no race carries a date", () => {
    expect(raceNight([{ date: null }, { date: null }])).toBe(null);
    expect(raceNight([])).toBe(null);
  });
});

describe("seasonDescription", () => {
  it("leads with the discipline and the game", () => {
    const text = seasonDescription({ discipline: "Formula 1", night: "Friday night" });
    expect(text.startsWith("Formula 1 sim racing league on Assetto Corsa.")).toBe(true);
    expect(text).toContain("Online F1 championship");
    expect(text).toContain("Friday night races");
    expect(text).toContain("standings");
    expect(text).toContain("sign-ups");
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it("reads correctly with no race night at all", () => {
    const text = seasonDescription({ discipline: "Formula 1", night: null });
    expect(text).not.toContain("races,");
    expect(text).toContain("Online F1 championship with driver and team standings");
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it("takes whatever night it is given, including a daytime one", () => {
    expect(seasonDescription({ discipline: "Formula 1", night: "Sunday" })).toContain("Sunday races,");
  });

  it("claims no Formula 1 for a series that is not", () => {
    const text = seasonDescription({ discipline: null, night: "Sunday night" });
    expect(text).toContain("Online sim racing league on Assetto Corsa.");
    expect(text).not.toContain("F1");
    expect(text).not.toContain("Formula");
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it("says nothing that would date the snippet", () => {
    const text = seasonDescription({ discipline: "Formula 1", night: "Friday night" });
    for (const dated of ["Season", "Round", "leads", "won", "points"]) {
      expect(text).not.toContain(dated);
    }
  });

  it("never ends mid-sentence, whatever it had to drop", () => {
    for (const night of ["Friday night", "Wednesday", null]) {
      for (const discipline of ["Formula 1", null]) {
        const text = seasonDescription({ discipline, night });
        expect(text.length).toBeLessThanOrEqual(160);
        expect(text.endsWith(".")).toBe(true);
      }
    }
  });
});
