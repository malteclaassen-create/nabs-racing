import { describe, it, expect, vi } from "vitest";
import { preStartRows } from "./tokens.js";
import { leagueDayStart } from "./tokenRules.js";

// The start day lives in a Setting that only the token routes used to load.
// Straight after a restart, anything else that paid out (the race recap, an
// import) ran with no start day and paid every race back to season 1. A fresh
// copy of the modules is a fresh process: nothing has been read yet.
async function freshTokens() {
  vi.resetModules();
  return import("./tokens.js");
}

function db({ tuning }) {
  const seen = [];
  const settings = new Map([
    ["tokens_earning", "1"],
    ["token_tuning", JSON.stringify(tuning)],
  ]);
  return {
    seen,
    async $queryRawUnsafe(sql, ...args) {
      // the payout's own query, not the one that stamps the multipliers
      if (/"penaltySeconds"/.test(sql)) seen.push({ sql, args });
      return [];
    },
    async $executeRawUnsafe() {
      return 0;
    },
    setting: {
      async findUnique({ where }) {
        return settings.has(where.key) ? { value: settings.get(where.key) } : null;
      },
      async upsert() {},
    },
  };
}

describe("the start day after a restart", () => {
  it("an import pays nothing from before it, even when no token page was opened first", async () => {
    const { payRace } = await freshTokens();
    const d = db({ tuning: { startDay: "2026-09-27" } });
    await payRace(d, "round5");
    expect(d.seen.length).toBe(1);
    expect(d.seen[0].sql).toMatch(/ra\."date" >= \?/);
    expect(d.seen[0].args).toContain(leagueDayStart("2026-09-27"));
  });
});

describe("taking back what was paid before the start day", () => {
  const from = leagueDayStart("2026-09-27");
  const raceDate = new Map([
    ["melbourne", new Date("2026-04-10T18:00:00Z").getTime()],
    ["poznan", new Date("2026-10-02T17:30:00Z").getTime()],
    ["archive", null],
  ]);
  const resultRace = new Map([["oldresult", "melbourne"]]);
  const pick = (rows) => preStartRows(rows, { from, raceDate, resultRace }).map((r) => r.refKey);

  it("takes the finish, the bonus and a correction for an old round", () => {
    expect(
      pick([
        { refKey: "race:melbourne:wal" },
        { refKey: "clean:melbourne:wal" },
        { refKey: "race-fix:melbourne:wal" },
        { refKey: "clean-fix:melbourne:wal" },
      ])
    ).toEqual(["race:melbourne:wal", "clean:melbourne:wal", "race-fix:melbourne:wal", "clean-fix:melbourne:wal"]);
  });

  it("takes the archive rounds that have no date at all", () => {
    expect(pick([{ refKey: "race:archive:wal" }])).toEqual(["race:archive:wal"]);
  });

  it("leaves every round from the start day on alone", () => {
    expect(pick([{ refKey: "race:poznan:wal" }, { refKey: "clean:poznan:wal" }])).toEqual([]);
  });

  it("reads the oldest keys, filed under the result row", () => {
    expect(pick([{ refKey: "race:oldresult" }])).toEqual(["race:oldresult"]);
  });

  it("takes a referral's round and an early sign-up bonus, nothing else", () => {
    expect(
      pick([
        { refKey: "referral-race:222:melbourne" },
        { refKey: "referral-race:222:poznan" },
        { refKey: "referral-join:222", createdAt: "2026-04-10T18:00:00.000Z" },
        { refKey: "referral-join:333", createdAt: "2026-10-02T17:30:00.000Z" },
        { refKey: "practice:p20:f1:2026-04-10:nabs1" },
        { refKey: "studio:theme-x" },
      ])
    ).toEqual(["referral-race:222:melbourne", "referral-join:222"]);
  });

  it("leaves a row alone when its round is gone", () => {
    expect(pick([{ refKey: "race:deleted:wal" }])).toEqual([]);
  });

  it("does nothing without a start day", () => {
    expect(preStartRows([{ refKey: "race:melbourne:wal" }], { from: null, raceDate, resultRace })).toEqual([]);
  });
});
