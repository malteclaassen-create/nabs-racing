import { describe, it, expect, vi, afterEach } from "vitest";
import { activityBoard, activityForDay, activityTotals } from "./tokens.js";

// Two F1 briefings: Fri 18 Sep and Fri 25 Sep 2026, 19:00 Berlin (17:00 UTC),
// and a race of the Sunday series in between them.
const B1 = Date.parse("2026-09-18T17:00:00Z");
const B2 = Date.parse("2026-09-25T17:00:00Z");
const SUN = Date.parse("2026-09-20T16:00:00Z");
function db({ days, cuts }) {
  return {
    async $queryRawUnsafe(sql, ...a) {
      if (/FROM "Race"/.test(sql)) return [
          { date: B1, parentRaceId: null, primary: 1 },
          { date: B2, parentRaceId: null, primary: 1 },
          { date: B2, parentRaceId: "x", primary: 1 }, // sprint half: no briefing of its own
          { date: SUN, parentRaceId: null, primary: 0 }, // Sunday series: no reset
        ];
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
  it("a Sunday race is paid on the last complete F1 window", async () => {
    const sunday = Date.parse("2026-09-27T16:00:00Z"); // after B2
    const t = await activityTotals(db({ days, cuts }), "1", sunday);
    expect(t).toMatchObject({ chatMessages: 20 + 100 + 40, vcMinutes: 40 + 200 + 50, since: B1 });
  });

  it("resets right after a briefing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-09-26T12:00:00Z"));
    const t = await activityTotals(db({ days, cuts }), "1");
    expect(t).toMatchObject({ chatMessages: 10 + 7, vcMinutes: 20 + 9, since: B2 });
  });

  it("the admin board counts every member since the last briefing, like their own multiplier", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-09-26T12:00:00Z"));
    const base = db({ days, cuts });
    const prisma = {
      async $queryRawUnsafe(sql, ...a) {
        if (/FROM "TokenAccount"/.test(sql)) return [{ discordId: "1", username: "timmis" }, { discordId: "2", username: "quiet" }];
        if (/GROUP BY "discordId"/.test(sql)) {
          const [from, to] = a;
          const r = Object.entries(days).filter(([d]) => d >= from && d <= to);
          return [{ discordId: "1", m: r.reduce((s, [, x]) => s + x.m, 0), v: r.reduce((s, [, x]) => s + x.v, 0) }];
        }
        if (/TokenActivityCut/.test(sql)) return cuts[a[0]] ? [{ discordId: "1", ...cuts[a[0]] }] : [];
        if (/FROM "TokenActivity" WHERE "day" = \?/.test(sql)) return days[a[0]] ? [{ discordId: "1", ...days[a[0]] }] : [];
        return base.$queryRawUnsafe(sql, ...a);
      },
    };
    const board = await activityBoard(prisma);
    expect(board.since).toBe(B2);
    expect(board.members.map((m) => [m.name, m.chatMessages, m.vcMinutes])).toEqual([
      ["timmis", 10 + 7, 20 + 9],
      ["quiet", 0, 0],
    ]);
    expect(board.members[1].multiplier.total).toBe(1);
  });

  it("hands the bot a whole day back, so a restart can carry on from it", async () => {
    const prisma = {
      async $queryRawUnsafe(sql, day) {
        return day === "2026-09-25" ? [{ discordId: "1", messages: 30, minutes: 120 }] : [];
      },
    };
    expect(await activityForDay(prisma, "2026-09-25")).toEqual({
      ok: true,
      day: "2026-09-25",
      entries: [{ discordId: "1", messages: 30, minutes: 120 }],
    });
    expect((await activityForDay(prisma, "friday")).error).toBeTruthy();
  });
});
