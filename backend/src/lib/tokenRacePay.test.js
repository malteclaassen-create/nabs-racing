import { describe, it, expect } from "vitest";
import { payRace } from "./tokens.js";

// A prisma stand-in for one saved round. It answers the three queries payRace
// asks and records every ledger insert, so a test can see what was paid, what
// it was filed under, and what happened the second time the same round is
// saved (which is what a correction or a penalty fix does).
function db({ results, rates = {}, earning = "1", discord = {} }) {
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
