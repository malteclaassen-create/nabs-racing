import { describe, it, expect, beforeEach } from "vitest";
import { notePracticeLap, practiceWritesSettled, practiceProgress, __clearCaches } from "./practiceTokens.js";

// A prisma stand-in with the three tables this touches: the lap tally, the
// drivers behind the Steam ids, and the ledger with the same uniqueness the
// real index has. Enough to answer "was this lap counted" and "was it paid".
function db({ earning = "1", steam = { "76561100000000001": "d1" }, discord = { d1: "disc1" }, race = true } = {}) {
  const practice = new Map(); // `${steam}|${series}|${period}` -> row
  const ledger = new Map(); // refKey -> row
  const settings = new Map([["tokens_earning", earning]]);

  async function query(sql, ...args) {
    if (/FROM "Race" ra/.test(sql)) return race ? [{ id: "race9", track: "Spa", number: 5, date: null }] : [];
    if (/FROM "Series" se JOIN "Season"/.test(sql)) return [{ slug: "nabs", name: "NABS" }];
    if (/FROM "Setting"/.test(sql)) {
      const key = args[0];
      return settings.has(key) ? [{ value: settings.get(key) }] : [];
    }
    if (/FROM "Driver" WHERE "steamId" IN/.test(sql)) {
      return args.filter((id) => steam[id]).map((id) => ({ id: steam[id], discordUserId: discord[steam[id]] || null }));
    }
    if (/SELECT DISTINCT "steamId" FROM "Driver"/.test(sql)) {
      return Object.entries(steam)
        .filter(([, driverId]) => args.includes(driverId))
        .map(([steamId]) => ({ steamId }));
    }
    if (/FROM "Driver" WHERE "discordUserId"/.test(sql)) {
      return Object.entries(discord)
        .filter(([, d]) => d === args[0])
        .map(([id]) => ({ id }));
    }
    if (/FROM "PersonLink"/.test(sql)) return [];
    if (/SELECT "laps" FROM "TokenPractice"/.test(sql)) {
      const row = practice.get(args.join("|"));
      return row ? [{ laps: row.laps }] : [];
    }
    if (/SUM\("laps"\)/.test(sql)) {
      const period = args[args.length - 1];
      const series = args[args.length - 2];
      const ids = args.slice(0, args.length - 2);
      let laps = 0;
      let trackKey = null;
      for (const [key, row] of practice) {
        const [steamId, s, p] = key.split("|");
        if (ids.includes(steamId) && s === series && p === period) {
          laps += row.laps;
          trackKey = row.trackKey;
        }
      }
      return [{ laps, trackKey, car: null }];
    }
    if (/FROM "TokenLedger" WHERE "discordId" = \? AND "refKey" IN/.test(sql)) {
      return [...ledger.values()].filter((r) => args.includes(r.refKey)).map((r) => ({ refKey: r.refKey, createdAt: r.createdAt }));
    }
    if (/FROM "TokenAccount"/.test(sql)) return [{ discordId: args[0], code: "ABC123", referredBy: null }];
    return [];
  }

  async function exec(sql, ...args) {
    if (/INSERT INTO "TokenPractice"/.test(sql)) {
      const [steamId, series, period, trackKey, car, lastAt] = args;
      const key = `${steamId}|${series}|${period}`;
      const row = practice.get(key);
      if (!row) {
        practice.set(key, { laps: 1, trackKey, car, lastAt });
        return 1;
      }
      if (lastAt <= row.lastAt) return 0; // the same lap again
      Object.assign(row, { laps: row.laps + 1, trackKey, car, lastAt });
      return 1;
    }
    if (/INSERT OR IGNORE INTO "TokenLedger"/.test(sql)) {
      const refKey = args[6];
      if (ledger.has(refKey)) return 0;
      ledger.set(refKey, {
        discordId: args[1],
        delta: args[2],
        rule: args[3],
        detail: args[5],
        refKey,
        createdAt: args[7] || new Date().toISOString(),
      });
      return 1;
    }
    return 0;
  }

  return {
    $queryRawUnsafe: query,
    $executeRawUnsafe: exec,
    setting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { value: settings.get(where.key) } : null),
    },
    settings,
    ledger,
    practice,
  };
}

// One driver doing `n` laps, a lap every two minutes.
async function drive(prisma, n, { steamId = "76561100000000001", from = 1_700_000_000 } = {}) {
  for (let i = 0; i < n; i++) {
    notePracticeLap(prisma, { series: "nabs", steamId, car: "bmw", trackKey: "spa--nabs-spa", at: from + i * 120 });
  }
  await practiceWritesSettled();
}

describe("training laps", () => {
  beforeEach(() => __clearCaches());

  it("counts every completed lap, and pays at 20 and at 50", async () => {
    const prisma = db();
    await drive(prisma, 19);
    expect([...prisma.ledger.values()]).toEqual([]);

    await drive(prisma, 1, { from: 1_700_000_000 + 19 * 120 });
    expect([...prisma.ledger.values()].map((r) => [r.rule, r.delta])).toEqual([["practice_20", 10]]);

    await drive(prisma, 30, { from: 1_700_000_000 + 20 * 120 });
    expect([...prisma.ledger.values()].map((r) => [r.rule, r.delta])).toEqual([
      ["practice_20", 10],
      ["practice_50", 20],
    ]);
  });

  it("files the payment under the round the week led up to", async () => {
    const prisma = db();
    await drive(prisma, 20);
    expect([...prisma.ledger.keys()]).toEqual(["practice:practice_20:nabs:race:race9"]);
    expect([...prisma.ledger.values()][0].detail).toBe("Round 5, Spa");
  });

  it("does not count the same lap twice", async () => {
    const prisma = db();
    await drive(prisma, 20);
    // The relay reconnects and sees the whole session again.
    await drive(prisma, 20);
    const row = [...prisma.practice.values()][0];
    expect(row.laps).toBe(20);
    expect([...prisma.ledger.values()]).toHaveLength(1);
  });

  it("keeps counting while the payout is switched off, and settles later", async () => {
    const off = db({ earning: "0" });
    await drive(off, 25);
    expect([...off.practice.values()][0].laps).toBe(25);
    expect([...off.ledger.values()]).toEqual([]);

    const progress = await practiceProgress(off, "disc1");
    expect(progress.laps).toBe(25);
    expect([...off.ledger.values()]).toEqual([]); // still off
  });

  it("pays what a week already earned the next time the page is opened", async () => {
    const prisma = db({ earning: "0" });
    await drive(prisma, 22);
    prisma.settings.set("tokens_earning", "1"); // the league starts the counting
    __clearCaches();
    const progress = await practiceProgress(prisma, "disc1");
    expect(progress.laps).toBe(22);
    expect(progress.earned).toBe(10);
    expect([...prisma.ledger.values()].map((r) => r.rule)).toEqual(["practice_20"]);
  });

  it("tells the page how far it is to the next milestone", async () => {
    const prisma = db();
    await drive(prisma, 30);
    const progress = await practiceProgress(prisma, "disc1");
    expect(progress).toMatchObject({ laps: 30, target: 50, earned: 10, label: "Round 5, Spa" });
    expect(progress.next).toEqual({ laps: 50, points: 20, toGo: 20 });
    expect(progress.tiers.map(({ key, laps, points, done }) => ({ key, laps, points, done }))).toEqual([
      { key: "practice_20", laps: 20, points: 10, done: true },
      { key: "practice_50", laps: 50, points: 20, done: false },
    ]);
    // The cue at the bottom of the site only celebrates a fresh payment, so it
    // has to be told when the milestone paid.
    expect(progress.tiers[0].paidAt).toBeTruthy();
    expect(progress.tiers[1].paidAt).toBeNull();
  });

  it("keeps the laps of a driver nobody has linked to a login", async () => {
    const prisma = db({ steam: {}, discord: {} });
    await drive(prisma, 25);
    expect([...prisma.practice.values()][0].laps).toBe(25);
    expect([...prisma.ledger.values()]).toEqual([]);
  });

  it("files laps under the week rather than the round when the calendar is empty", async () => {
    const prisma = db({ race: false });
    await drive(prisma, 20);
    const [key] = [...prisma.ledger.keys()];
    expect(key).toMatch(/^practice:practice_20:nabs:week:\d{4}-\d{2}-\d{2}$/);
  });
});
