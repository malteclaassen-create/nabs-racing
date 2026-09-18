import { describe, it, expect } from "vitest";
import { bumpMessages, bumpMinutes, forgetOldDays, markSent, pendingActivity } from "./store.js";

const fresh = () => ({ days: {}, invites: {}, referrals: [] });

describe("counters", () => {
  it("per user per day", () => {
    const s = fresh();
    bumpMessages(s, "steve", 1, "2026-09-18");
    bumpMessages(s, "steve", 1, "2026-09-18");
    bumpMinutes(s, "steve", 1, "2026-09-18");
    bumpMessages(s, "malte", 1, "2026-09-19");
    expect(s.days["2026-09-18"].steve).toMatchObject({ messages: 2, minutes: 1 });
    expect(s.days["2026-09-19"].malte).toMatchObject({ messages: 1, minutes: 0 });
  });
});

describe("pendingActivity", () => {
  it("new day is pending", () => {
    const s = fresh();
    bumpMessages(s, "steve", 3, "2026-09-18");
    expect(pendingActivity(s)).toEqual([{ discordId: "steve", day: "2026-09-18", messages: 3, minutes: 0 }]);
  });

  it("not pending after markSent", () => {
    const s = fresh();
    bumpMessages(s, "steve", 3, "2026-09-18");
    markSent(s, pendingActivity(s));
    expect(pendingActivity(s)).toEqual([]);
  });

  it("pending again when a number changes", () => {
    const s = fresh();
    bumpMessages(s, "steve", 3, "2026-09-18");
    markSent(s, pendingActivity(s));
    bumpMinutes(s, "steve", 1, "2026-09-18");
    expect(pendingActivity(s)).toEqual([{ discordId: "steve", day: "2026-09-18", messages: 3, minutes: 1 }]);
  });

  it("sends totals, not diffs", () => {
    const s = fresh();
    bumpMessages(s, "steve", 3, "2026-09-18");
    markSent(s, pendingActivity(s));
    bumpMessages(s, "steve", 2, "2026-09-18");
    expect(pendingActivity(s)[0].messages).toBe(5);
  });

  it("markSent ignores unknown rows", () => {
    const s = fresh();
    expect(() => markSent(s, [{ discordId: "ghost", day: "1999-01-01", messages: 1, minutes: 0 }])).not.toThrow();
  });
});

describe("forgetOldDays", () => {
  it("drops old days only", () => {
    const s = fresh();
    bumpMessages(s, "steve", 1, "2026-09-18");
    bumpMessages(s, "steve", 1, "2026-07-01");
    expect(forgetOldDays(s, Date.parse("2026-09-18T12:00:00Z"))).toBe(1);
    expect(Object.keys(s.days)).toEqual(["2026-09-18"]);
  });
});
