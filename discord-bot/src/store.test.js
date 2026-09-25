import { describe, it, expect } from "vitest";
import { bootSnapshot, bumpMessages, bumpMinutes, forgetOldDays, markSent, pendingActivity, seedFromSite } from "./store.js";

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
  it("drops old days the site has taken", () => {
    const s = fresh();
    bumpMessages(s, "steve", 1, "2026-09-18");
    bumpMessages(s, "steve", 1, "2026-07-01");
    markSent(s, [{ discordId: "steve", day: "2026-07-01", messages: 1, minutes: 0 }]);
    expect(forgetOldDays(s, Date.parse("2026-09-18T12:00:00Z"))).toBe(1);
    expect(Object.keys(s.days)).toEqual(["2026-09-18"]);
  });

  it("keeps an old day the site never took", () => {
    const s = fresh();
    bumpMessages(s, "steve", 1, "2026-07-01");
    expect(forgetOldDays(s, Date.parse("2026-09-18T12:00:00Z"))).toBe(0);
    expect(Object.keys(s.days)).toEqual(["2026-07-01"]);
  });
});

describe("seedFromSite", () => {
  const day = "2026-09-25";

  it("a restart that lost its notes carries on from the site's totals", () => {
    // state.json is gone: the day starts empty, then one message comes in
    // before the site has answered
    const s = fresh();
    const boot = bootSnapshot(s, day);
    bumpMessages(s, "malte", 1, day);
    seedFromSite(s, day, [{ discordId: "malte", messages: 30, minutes: 120 }], boot);
    expect(s.days[day].malte).toMatchObject({ messages: 31, minutes: 120 });
    // and that is what gets sent, above what the site has, so it counts
    expect(pendingActivity(s)).toEqual([{ discordId: "malte", day, messages: 31, minutes: 120 }]);
  });

  it("notes that survived are not counted twice", () => {
    const s = fresh();
    bumpMessages(s, "steve", 30, day);
    bumpMinutes(s, "steve", 120, day);
    const boot = bootSnapshot(s, day);
    bumpMinutes(s, "steve", 5, day);
    seedFromSite(s, day, [{ discordId: "steve", messages: 30, minutes: 118 }], boot);
    expect(s.days[day].steve).toMatchObject({ messages: 30, minutes: 125 });
  });

  it("members the bot has not seen since the restart are taken as the site has them", () => {
    const s = fresh();
    seedFromSite(s, day, [{ discordId: "duck", messages: 4, minutes: 60 }], bootSnapshot(s, day));
    expect(s.days[day].duck).toMatchObject({ messages: 4, minutes: 60 });
  });
});
