import { describe, it, expect } from "vitest";
import { weeklyTurnovers, sameTimeWeeksLater } from "./weeklyTurnover.js";

const iso = (t) => new Date(t).toISOString();

describe("weekly turnover without a race on the calendar", () => {
  it("keeps the Berlin race time across the clock change", () => {
    // Fri 23 Oct 19:30 summer time is 17:30 UTC; a week later it is winter time.
    expect(iso(sameTimeWeeksLater(Date.parse("2026-10-23T17:30:00Z"), 1))).toBe("2026-10-30T18:30:00.000Z");
  });

  it("turns over every Friday after the last round of the season", () => {
    const abuDhabi = Date.parse("2026-10-30T18:30:00Z");
    const out = weeklyTurnovers([Date.parse("2026-10-23T17:30:00Z"), abuDhabi], {
      until: Date.parse("2026-11-21T00:00:00Z"),
    });
    expect(out.map(iso)).toEqual(["2026-11-06T18:30:00.000Z", "2026-11-13T18:30:00.000Z", "2026-11-20T18:30:00.000Z"]);
  });

  it("adds nothing between rounds a week apart", () => {
    const a = Date.parse("2026-10-23T17:30:00Z");
    const b = Date.parse("2026-10-30T18:30:00Z");
    expect(weeklyTurnovers([a, b], { until: b })).toEqual([]);
  });

  it("fills a free Friday between two rounds, but not right before a moved one", () => {
    const a = Date.parse("2026-08-21T17:30:00Z");
    expect(weeklyTurnovers([a, Date.parse("2026-09-04T17:30:00Z")], { until: a + 14 * 864e5 }).map(iso)).toEqual([
      "2026-08-28T17:30:00.000Z",
    ]);
    // Next round only a day after where the stand-in would be: no extra week.
    expect(weeklyTurnovers([a, Date.parse("2026-08-29T17:30:00Z")], { until: a + 9 * 864e5 })).toEqual([]);
  });
});
