import { describe, it, expect, vi, afterEach } from "vitest";
import { activityTotals } from "./tokens.js";

// Two briefings: Fri 18 Sep and Fri 25 Sep 2026, 19:00 Berlin (17:00 UTC).
const B1 = Date.parse("2026-09-18T17:00:00Z");
const B2 = Date.parse("2026-09-25T17:00:00Z");
function db({ days, cuts }) {
  return {
    async $queryRawUnsafe(sql, ...a) {
      if (/FROM "Race"/.test(sql)) return [{ date: B1, parentRaceId: null }, { date: B2, parentRaceId: null }, { date: B2, parentRaceId: "x" }];
      if (/TokenActivityCut/.test(sql)) return cuts[a[1]] ? [cuts[a[1]]] : [];
      if (/SUM/.test(sql)) {
        const [, from, to] = a;
        const r = Object.entries(days).filter(([d]) => d >= from && d < to);
        return [{ m: r.reduce((s, [, x]) => s + x.m, 0), v: r.reduce((s, [, x]) => s + x.v, 0) }];
      }
      if (/FROM "TokenActivity"/.test(sql)) return days[a[1]] ? [days[a[1]]] : [];
      return [];
    },
  };
}
const days = {
  "2026-09-17": { m: 1000, v: 1000 }, // before B1: never counts after B1
  "2026-09-18": { m: 30, v: 60 }, // B1 day: 10/20 before the briefing
  "2026-09-20": { m: 100, v: 200 },
  "2026-09-25": { m: 50, v: 70 }, // B2 day: 40/50 before the briefing
  "2026-09-26": { m: 7, v: 9 },
};
const cuts = { [B1]: { m: 10, v: 20 }, [B2]: { m: 40, v: 50 } };
afterEach(() => vi.useRealTimers());

describe("multiplier window: briefing to briefing", () => {
  it("a round's rate counts from the previous briefing up to its own", async () => {
    const t = await activityTotals(db({ days, cuts }), "1", B2);
    expect(t).toMatchObject({ chatMessages: 20 + 100 + 40, vcMinutes: 40 + 200 + 50, since: B1 });
  });
  it("resets right after a briefing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-09-26T12:00:00Z"));
    const t = await activityTotals(db({ days, cuts }), "1");
    expect(t).toMatchObject({ chatMessages: 10 + 7, vcMinutes: 20 + 9, since: B2 });
  });
});
