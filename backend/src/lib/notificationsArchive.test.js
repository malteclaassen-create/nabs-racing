import { describe, expect, it } from "vitest";
import { isArchiveRound } from "./notifications.js";

// Filling in a past season's results must not ring "results are in" at
// everyone (Season 3 rang "Round 1 results are in" for a race years old).
describe("isArchiveRound", () => {
  const now = Date.parse("2026-10-26T20:00:00Z");
  const days = (n) => new Date(now - n * 86_400_000);

  it("is archive work for a season older than the one its series runs", () => {
    expect(isArchiveRound({ date: null }, 3, 8, now)).toBe(true);
    expect(isArchiveRound({ date: days(1) }, 7, 8, now)).toBe(true);
  });

  it("is archive work for a round raced more than two weeks ago", () => {
    expect(isArchiveRound({ date: days(15) }, 8, 8, now)).toBe(true);
  });

  it("still rings for this season's round, a late import, and next season", () => {
    expect(isArchiveRound({ date: days(0) }, 8, 8, now)).toBe(false);
    expect(isArchiveRound({ date: days(6) }, 8, 8, now)).toBe(false);
    expect(isArchiveRound({ date: null }, 8, 8, now)).toBe(false);
    expect(isArchiveRound({ date: days(1) }, 9, 8, now)).toBe(false);
    expect(isArchiveRound({ date: days(1) }, null, null, now)).toBe(false);
  });
});
