import { describe, it, expect } from "vitest";
import {
  ACTIVITY_WINDOW_DAYS,
  EARN_RULES,
  MULTIPLIER,
  REFERRAL_RACE_LIMIT,
  activityMultiplier,
  halfMultiplier,
  raceWasClean,
  stewardingClosed,
  stewardsDoneAt,
  activityWindowStart,
  leagueDay,
  withMultiplier,
} from "./tokenRules.js";

// The league wrote these numbers down; this file is where they are kept honest.
describe("the league's own examples", () => {
  it("makes 1.6 and 1.4 into 2.0, the way the league adds them up", () => {
    // What each half earns ON TOP of one, added together: 0.6 and 0.4 make 1.0
    // on top, so 2.0. Which is the same arithmetic as chat + voice - 1.
    const chat = 1.6;
    const voice = 1.4;
    expect(Math.round((1 + (chat - 1) + (voice - 1)) * 100) / 100).toBe(2);
    expect(Math.round((chat + voice - 1) * 100) / 100).toBe(2);
  });

  it("tops out at 3.0x with both halves maxed", () => {
    const m = activityMultiplier({ chatMessages: 5000, vcMinutes: 100 * 60 });
    expect(m.chat).toBe(2);
    expect(m.voice).toBe(2);
    expect(m.total).toBe(MULTIPLIER.total);
  });
});

describe("halfMultiplier", () => {
  it("does not count at all below the lower threshold", () => {
    expect(halfMultiplier(49, MULTIPLIER.chat)).toBe(1);
    expect(halfMultiplier(0, MULTIPLIER.chat)).toBe(1);
  });

  it("is worth 1.1x exactly at the lower threshold", () => {
    expect(halfMultiplier(50, MULTIPLIER.chat)).toBeCloseTo(1.1, 5);
    expect(halfMultiplier(5 * 60, MULTIPLIER.voice)).toBeCloseTo(1.1, 5);
  });

  it("is worth 2.0x at the upper threshold and never more", () => {
    expect(halfMultiplier(500, MULTIPLIER.chat)).toBe(2);
    expect(halfMultiplier(50000, MULTIPLIER.chat)).toBe(2);
  });

  it("runs in a straight line in between", () => {
    // Half way from 50 to 500 messages is half way from 1.1 to 2.0.
    expect(halfMultiplier(275, MULTIPLIER.chat)).toBeCloseTo(1.55, 5);
  });

  it("treats nonsense as no activity rather than as a jackpot", () => {
    expect(halfMultiplier(undefined, MULTIPLIER.chat)).toBe(1);
    expect(halfMultiplier("lots", MULTIPLIER.chat)).toBe(1);
  });
});

describe("activityMultiplier", () => {
  it("leaves somebody who is never on Discord on a plain 1.0x", () => {
    expect(activityMultiplier({}).total).toBe(1);
    expect(activityMultiplier({ chatMessages: 10, vcMinutes: 60 }).total).toBe(1);
  });

  it("never drops below 1.0x, whatever the halves do", () => {
    expect(activityMultiplier({ chatMessages: 0, vcMinutes: 0 }).total).toBe(1);
  });

  it("adds the two halves minus one", () => {
    const m = activityMultiplier({ chatMessages: 275, vcMinutes: 15 * 60 });
    expect(m.chat).toBe(1.55);
    expect(m.voice).toBe(1.55);
    expect(m.total).toBe(2.1);
  });
});

describe("withMultiplier", () => {
  it("pays whole tokens", () => {
    expect(withMultiplier(50, 1.55)).toBe(78); // 77.5
    expect(withMultiplier(20, 2.1)).toBe(42);
  });

  it("falls back to paying the plain amount on a broken multiplier", () => {
    expect(withMultiplier(50, undefined)).toBe(50);
    expect(withMultiplier(50, 0)).toBe(50);
  });
});

describe("the clean-race bonus", () => {
  it("wants no steward penalty and no in-game penalty", () => {
    expect(raceWasClean({ penaltySeconds: 0, gamePenalties: 0 })).toBe(true);
    expect(raceWasClean({ penaltySeconds: 5, gamePenalties: 0 })).toBe(false);
    expect(raceWasClean({ penaltySeconds: 0, gamePenalties: 2 })).toBe(false);
  });

  it("does not pay out on missing data", () => {
    // A round imported before the game-penalty columns existed knows nothing
    // about penalties, and "we do not know" must not read as "clean".
    expect(raceWasClean({ penaltySeconds: 0, gamePenalties: null })).toBe(false);
    expect(raceWasClean(null)).toBe(false);
  });

  // The league's stewards read the reports on MONDAY, so a round is settled on
  // the Tuesday morning after it. These check the weekday, not a day count: a
  // Friday round and a Sunday round land on the SAME Tuesday.
  const berlinWeekday = (t) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "long" }).format(new Date(t));
  const berlinHour = (t) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(
      new Date(t)
    );

  it("settles a Friday round on the Tuesday morning after it", () => {
    const friday = Date.parse("2026-09-04T17:00:00Z"); // 19:00 in the league's time
    const done = stewardsDoneAt(friday);
    expect(berlinWeekday(done)).toBe("Tuesday");
    expect(berlinHour(done)).toBe("09");
    expect(stewardingClosed(friday, done - 1000)).toBe(false);
    expect(stewardingClosed(friday, done)).toBe(true);
  });

  it("settles a Sunday round on the same Tuesday", () => {
    const friday = Date.parse("2026-09-04T17:00:00Z");
    const sunday = Date.parse("2026-09-06T17:00:00Z");
    expect(stewardsDoneAt(sunday)).toBe(stewardsDoneAt(friday));
  });

  it("does not settle a Tuesday round the same morning it is raced", () => {
    // Its reports are read the Monday AFTER it, so it waits for the next one.
    const tuesday = Date.parse("2026-09-08T17:00:00Z");
    const done = stewardsDoneAt(tuesday);
    expect(berlinWeekday(done)).toBe("Tuesday");
    expect(done - tuesday).toBeGreaterThan(5 * 24 * 3600 * 1000);
  });

  it("is still a Tuesday morning across the clock change", () => {
    // The last race before the clocks go back, and the first after.
    for (const iso of ["2026-10-23T17:00:00Z", "2026-10-30T18:00:00Z"]) {
      const done = stewardsDoneAt(Date.parse(iso));
      expect(berlinWeekday(done)).toBe("Tuesday");
      expect(berlinHour(done)).toBe("09");
    }
  });

  it("never settles a round with no date on it", () => {
    expect(stewardingClosed(null)).toBe(false);
    expect(stewardingClosed("not a date")).toBe(false);
  });
});

describe("the rules as written", () => {
  const rule = (key) => EARN_RULES.find((r) => r.key === key);

  it("pays what the league's sheet says", () => {
    expect(rule("race_finish").points).toBe(50);
    expect(rule("clean_race").points).toBe(20);
    expect(rule("referral_join").points).toBe(50);
    expect(rule("referral_race").points).toBe(30);
    expect(REFERRAL_RACE_LIMIT).toBe(12);
  });

  it("multiplies the racing and nothing else", () => {
    // The green boxes on the sheet, and only those: if bringing people in were
    // multiplied too, the way to earn would stop being racing.
    expect(rule("race_finish").boosted).toBe(true);
    expect(rule("clean_race").boosted).toBe(true);
    expect(rule("referral_join").boosted).toBeUndefined();
    expect(rule("referral_race").boosted).toBeUndefined();
  });
});

// The multiplier measures the last thirty days, counted afresh every day rather
// than per calendar month, so a busy month fades again in a quiet one. These
// pin down which days are still inside that window.
describe("the thirty-day window", () => {
  it("counts thirty days including today", () => {
    expect(ACTIVITY_WINDOW_DAYS).toBe(30);
    const noon = Date.parse("2026-09-18T12:00:00Z");
    expect(leagueDay(noon)).toBe("2026-09-18");
    expect(activityWindowStart(noon)).toBe("2026-08-20"); // 29 days back
  });

  it("walks over the end of a month and over a year", () => {
    expect(activityWindowStart(Date.parse("2026-03-05T12:00:00Z"))).toBe("2026-02-04");
    expect(activityWindowStart(Date.parse("2026-01-10T12:00:00Z"))).toBe("2025-12-12");
  });

  it("uses the league's own day, not the server's", () => {
    // Half past midnight in Germany is still the previous day in UTC, and the
    // bot counts in league days.
    expect(leagueDay(Date.parse("2026-06-01T22:30:00Z"))).toBe("2026-06-02");
  });

  it("moves the window forward with the day", () => {
    const a = activityWindowStart(Date.parse("2026-09-18T12:00:00Z"));
    const b = activityWindowStart(Date.parse("2026-09-19T12:00:00Z"));
    expect(b > a).toBe(true);
  });
});
