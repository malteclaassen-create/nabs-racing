import { describe, it, expect } from "vitest";
import { payRace, recordActivity } from "./tokens.js";
import { saveTuning, resetTuning } from "./tokenTuning.js";

// A prisma stand-in for one saved round. It answers the three queries payRace
// asks and records every ledger insert, so a test can see what was paid, what
// it was filed under, and what happened the second time the same round is
// saved (which is what a correction or a penalty fix does).
function db({ results, rates = {}, earning = "1", discord = {}, series = "f1" }) {
  const ledger = new Map(); // refKey -> row, the same uniqueness the real index has
  const rateRows = new Map(Object.entries(rates));
  const settings = new Map([["tokens_earning", earning]]);

  async function query(sql, ...args) {
    if (/FROM "TokenRaceRate"/.test(sql) && /LEFT JOIN/.test(sql) === false) return [];
    if (/SELECT r\."driverId" FROM "RaceResult"/.test(sql)) {
      // the ones with no rate yet
      return results.filter((r) => !rateRows.has(r.driverId)).map((r) => ({ driverId: r.driverId }));
    }
    if (/FROM "Driver" WHERE "id" IN/.test(sql)) {
      return args.map((id) => ({ id, discordUserId: discord[id] || null }));
    }
    if (/FROM "PersonLink"/.test(sql)) return [];
    if (/FROM "RaceResult" r/.test(sql)) {
      return results
        .filter((r) => r.status === "FINISHED")
        .map((r) => ({
          driverId: r.driverId,
          penaltySeconds: r.penaltySeconds || 0,
          gamePenalties: r.gamePenalties || 0,
          raceId: "round5",
          track: "Spa",
          date: new Date("2026-01-09T18:00:00Z"),
          series,
          rate: rateRows.has(r.driverId) ? Number(rateRows.get(r.driverId)) : null,
        }));
    }
    if (/FROM "TokenActivity"/.test(sql)) return [{ messages: 0, minutes: 0 }];
    if (/FROM "TokenAccount"/.test(sql)) return [];
    return [];
  }

  async function exec(sql, ...args) {
    if (/INSERT OR IGNORE INTO "TokenRaceRate"/.test(sql)) {
      const [, driverId, rate] = args;
      if (rateRows.has(driverId)) return 0;
      rateRows.set(driverId, rate);
      return 1;
    }
    if (/INSERT OR IGNORE INTO "TokenLedger"/.test(sql)) {
      const refKey = args[6];
      if (ledger.has(refKey)) return 0; // OR IGNORE: the second one is dropped
      ledger.set(refKey, { discordId: args[1], delta: args[2], rule: args[3] });
      return 1;
    }
    return 0;
  }

  return {
    ledger,
    rateRows,
    $queryRawUnsafe: query,
    $executeRawUnsafe: exec,
    setting: {
      async findUnique({ where }) {
        return settings.has(where.key) ? { value: settings.get(where.key) } : null;
      },
      async upsert() {},
    },
  };
}

const finisher = (driverId, extra = {}) => ({ driverId, status: "FINISHED", ...extra });

describe("paying a round when it is imported", () => {
  it("pays each finisher once and files it under the round and the driver", async () => {
    const d = db({
      results: [finisher("ayrton_s8"), finisher("nigel_s8")],
      discord: { ayrton_s8: "111", nigel_s8: "222" },
    });
    const out = await payRace(d, "round5");
    expect(out.paid).toBe(2);
    expect([...d.ledger.keys()].sort()).toEqual([
      "clean:round5:ayrton_s8",
      "clean:round5:nigel_s8",
      "race:round5:ayrton_s8",
      "race:round5:nigel_s8",
    ]);
  });

  it("saving the same round again pays nobody a second time", async () => {
    const d = db({
      results: [finisher("ayrton_s8")],
      discord: { ayrton_s8: "111" },
    });
    await payRace(d, "round5");
    const first = [...d.ledger.keys()];
    const again = await payRace(d, "round5");
    expect(again.paid).toBe(0);
    expect([...d.ledger.keys()]).toEqual(first);
  });

  it("uses the rate stamped for the round, not whatever the member has today", async () => {
    const d = db({
      results: [finisher("ayrton_s8")],
      discord: { ayrton_s8: "111" },
      rates: { ayrton_s8: 2.5 },
    });
    await payRace(d, "round5");
    expect(d.ledger.get("race:round5:ayrton_s8").delta).toBe(125); // 50 at 2.5x
    expect(d.ledger.get("clean:round5:ayrton_s8").delta).toBe(50); // 20 at 2.5x
  });

  it("stamps the rate once and leaves it alone on a later save", async () => {
    const d = db({ results: [finisher("ayrton_s8")], discord: { ayrton_s8: "111" } });
    expect((await payRace(d, "round5")).stamped).toBe(1);
    const stamped = d.rateRows.get("ayrton_s8");
    expect((await payRace(d, "round5")).stamped).toBe(0);
    expect(d.rateRows.get("ayrton_s8")).toBe(stamped);
  });

  it("with the counting paused it fixes the rate and pays nothing", async () => {
    const d = db({
      results: [finisher("ayrton_s8")],
      discord: { ayrton_s8: "111" },
      earning: "0",
    });
    const out = await payRace(d, "round5");
    expect(out.stamped).toBe(1);
    expect(out.paid).toBe(0);
    expect(d.ledger.size).toBe(0);
  });

  it("pays a series its own numbers: the Sunday league at half", async () => {
    const noSave = { setting: { async upsert() {}, async deleteMany() {} } };
    await saveTuning(noSave, { seriesRules: { "gt-sunday": { race_finish: { points: 25 }, clean_race: { points: 10 } } } });
    try {
      const sunday = db({ results: [finisher("ayrton_s8")], discord: { ayrton_s8: "111" }, rates: { ayrton_s8: 2 }, series: "gt-sunday" });
      await payRace(sunday, "round5");
      expect(sunday.ledger.get("race:round5:ayrton_s8").delta).toBe(50); // 25 at 2x
      expect(sunday.ledger.get("clean:round5:ayrton_s8").delta).toBe(20); // 10 at 2x
      const friday = db({ results: [finisher("ayrton_s8")], discord: { ayrton_s8: "111" }, rates: { ayrton_s8: 2 } });
      await payRace(friday, "round5");
      expect(friday.ledger.get("race:round5:ayrton_s8").delta).toBe(100); // the league's 50 at 2x
    } finally {
      await resetTuning(noSave);
    }
  });

  it("pays a round before the series' start day at the league's numbers", async () => {
    const noSave = { setting: { async upsert() {}, async deleteMany() {} } };
    const seriesRules = { "gt-sunday": { race_finish: { points: 25 }, clean_race: { points: 10 } } };
    try {
      // the round is on 9 January 2026
      await saveTuning(noSave, { seriesRules, seriesFrom: { "gt-sunday": { race: "2026-01-10" } } });
      const before = db({ results: [finisher("ayrton_s8")], discord: { ayrton_s8: "111" }, rates: { ayrton_s8: 1 }, series: "gt-sunday" });
      await payRace(before, "round5");
      expect(before.ledger.get("race:round5:ayrton_s8").delta).toBe(50);
      expect(before.ledger.get("clean:round5:ayrton_s8").delta).toBe(20);
      await saveTuning(noSave, { seriesRules, seriesFrom: { "gt-sunday": { race: "2026-01-09" } } });
      const onTheDay = db({ results: [finisher("ayrton_s8")], discord: { ayrton_s8: "111" }, rates: { ayrton_s8: 1 }, series: "gt-sunday" });
      await payRace(onTheDay, "round5");
      expect(onTheDay.ledger.get("race:round5:ayrton_s8").delta).toBe(25);
    } finally {
      await resetTuning(noSave);
    }
  });

  it("skips a driver who has never signed in, and pays the rest", async () => {
    const d = db({
      results: [finisher("ayrton_s8"), finisher("ghost_s8")],
      discord: { ayrton_s8: "111" },
    });
    const out = await payRace(d, "round5");
    expect(out.paid).toBe(1);
    expect([...d.ledger.keys()].every((k) => k.endsWith("ayrton_s8"))).toBe(true);
  });

  it("a penalty on the night means no clean-race bonus", async () => {
    const d = db({
      results: [finisher("ayrton_s8", { penaltySeconds: 5 })],
      discord: { ayrton_s8: "111" },
    });
    await payRace(d, "round5");
    expect(d.ledger.has("race:round5:ayrton_s8")).toBe(true);
    expect(d.ledger.has("clean:round5:ayrton_s8")).toBe(false);
  });
});

// A day's activity row, as the bot reports it. The bot sends absolute totals for
// the day, over and over, so the same day arrives many times.
function activityDb() {
  const rows = new Map(); // "id|day" -> { messages, minutes }
  return {
    rows,
    async $queryRawUnsafe() {
      return [];
    },
    async $executeRawUnsafe(sql, ...args) {
      if (!/INSERT INTO "TokenActivity"/.test(sql)) return 0;
      const [discordId, day, messages, minutes] = args;
      const key = `${discordId}|${day}`;
      const had = rows.get(key);
      // what the real ON CONFLICT does: the higher number wins
      const max = /MAX\("TokenActivity"/.test(sql);
      rows.set(key, {
        messages: had && max ? Math.max(had.messages, messages) : messages,
        minutes: had && max ? Math.max(had.minutes, minutes) : minutes,
      });
      return 1;
    },
  };
}

describe("a day of Discord activity", () => {
  it("keeps the higher figure when the bot restarts and starts the day again", async () => {
    const d = activityDb();
    await recordActivity(d, "111", { day: "2026-09-19", messages: 120, minutes: 90 });
    // the bot's host wiped its disk, so it counts today from zero again
    await recordActivity(d, "111", { day: "2026-09-19", messages: 4, minutes: 2 });
    expect(d.rows.get("111|2026-09-19")).toEqual({ messages: 120, minutes: 90 });
  });

  it("still moves up once the day really passes the stored figure", async () => {
    const d = activityDb();
    await recordActivity(d, "111", { day: "2026-09-19", messages: 120, minutes: 90 });
    await recordActivity(d, "111", { day: "2026-09-19", messages: 200, minutes: 140 });
    expect(d.rows.get("111|2026-09-19")).toEqual({ messages: 200, minutes: 140 });
  });

  it("refuses a day that is not a day", async () => {
    const d = activityDb();
    expect((await recordActivity(d, "111", { day: "friday" })).error).toBeTruthy();
  });
});
