import { describe, it, expect, beforeEach } from "vitest";
import { notePracticeLap, practiceWritesSettled, practiceProgress, __clearCaches } from "./practiceTokens.js";
import { saveTuning } from "./tokenTuning.js";

// A prisma stand-in with the three tables this touches: the lap tally, the
// drivers behind the Steam ids, and the ledger with the same uniqueness the
// real index has. Enough to answer "was this lap counted" and "was it paid".
function db({
  earning = "1",
  steam = { "76561100000000001": "d1" },
  discord = { d1: "disc1" },
  race = true,
  seriesList = ["nabs"],
  driverSeries = {},
  nextRaceBySeries = null,
} = {}) {
  const practice = new Map(); // `${steam}|${series}|${period}` -> row
  const ledger = new Map(); // refKey -> row
  const settings = new Map([["tokens_earning", earning]]);

  async function query(sql, ...args) {
    if (/FROM "Race" ra/.test(sql)) {
      if (!race) return [];
      if (nextRaceBySeries) {
        const track = nextRaceBySeries[args[0]];
        return track ? [{ id: `race-${args[0]}`, track, number: 5, date: null }] : [];
      }
      return [{ id: "race9", track: "Spa", number: 5, date: null }];
    }
    if (/SELECT DISTINCT se\."slug" AS "slug"\s+FROM "Series" se JOIN "Season"/.test(sql)) {
      return seriesList.map((slug) => ({ slug }));
    }
    if (/FROM "Series" se JOIN "Season"/.test(sql)) return seriesList.map((slug) => ({ slug, name: slug }));
    if (/FROM "Driver" d\s+JOIN "Season"/.test(sql)) {
      return (driverSeries[args[0]] || []).map((slug) => ({ slug }));
    }
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
    if (/SUM\("laps"\)/.test(sql)) {
      const period = args[args.length - 1];
      const series = args[args.length - 2];
      const ids = args.slice(0, args.length - 2);
      const byServer = new Map();
      let trackKey = null;
      for (const [key, row] of practice) {
        const [steamId, s, p, server] = key.split("|");
        if (!ids.includes(steamId) || s !== series || p !== period) continue;
        byServer.set(server, (byServer.get(server) || 0) + row.laps);
        trackKey = row.trackKey;
      }
      // The week as one number (what countLap asks) or split by server (what
      // the page asks), the same way SQLite answers the two queries.
      if (!/GROUP BY "server"/.test(sql)) {
        return [{ laps: [...byServer.values()].reduce((a, b) => a + b, 0) }];
      }
      return [...byServer.entries()]
        .map(([server, laps]) => ({ server, laps, trackKey, car: null }))
        .sort((a, b) => b.laps - a.laps);
    }
    if (/FROM "TokenLedger" WHERE "discordId" = \? AND "refKey" IN/.test(sql)) {
      return [...ledger.values()].filter((r) => args.includes(r.refKey)).map((r) => ({ refKey: r.refKey, createdAt: r.createdAt }));
    }
    if (/FROM "TokenAccount"/.test(sql)) return [{ discordId: args[0], code: "ABC123", referredBy: null }];
    return [];
  }

  async function exec(sql, ...args) {
    if (/INSERT INTO "TokenPractice"/.test(sql)) {
      const [steamId, series, period, server, laps, trackKey, car, lastAt] = args;
      const key = `${steamId}|${series}|${period}|${server}`;
      const row = practice.get(key);
      if (!row) {
        practice.set(key, { laps, trackKey, car, lastAt });
        return 1;
      }
      if (lastAt <= row.lastAt) return 0; // the same lap again
      Object.assign(row, { laps: row.laps + laps, trackKey, car, lastAt });
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
      upsert: async ({ where, create, update }) => {
        settings.set(where.key, (update?.value ?? create?.value) || "");
        return { key: where.key, value: settings.get(where.key) };
      },
    },
    settings,
    ledger,
    practice,
  };
}

// One driver doing `n` laps, a lap every two minutes.
async function drive(prisma, n, { steamId = "76561100000000001", from = 1_700_000_000, ...rest } = {}) {
  for (let i = 0; i < n; i++) {
    notePracticeLap(prisma, {
      serverKey: "nabs2",
      scopes: [],
      steamId,
      car: "bmw",
      trackKey: "spa--nabs-spa",
      at: from + i * 120,
      ...rest,
    });
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

  it("says whether the feature is out in the open, which the live page waits for", async () => {
    const prisma = db();
    await drive(prisma, 5);
    prisma.settings.set("tokens_enabled", "admins");
    __clearCaches();
    expect((await practiceProgress(prisma, "disc1")).publicPages).toBe(false);
    prisma.settings.set("tokens_enabled", "all");
    expect((await practiceProgress(prisma, "disc1")).publicPages).toBe(true);
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

  it("counts the laps driven while the feed was away, not just the last one", async () => {
    const prisma = db();
    // Two laps seen, then the relay is gone for a while and comes back to a
    // driver who has done eight more.
    notePracticeLap(prisma, { serverKey: "nabs2", scopes: [], steamId: "76561100000000001", at: 1_700_000_000, laps: 1 });
    notePracticeLap(prisma, { serverKey: "nabs2", scopes: [], steamId: "76561100000000001", at: 1_700_000_120, laps: 1 });
    notePracticeLap(prisma, { serverKey: "nabs2", scopes: [], steamId: "76561100000000001", at: 1_700_001_200, laps: 8 });
    await practiceWritesSettled();
    expect([...prisma.practice.values()][0].laps).toBe(10);
  });

  it("counts laps on a server that has no series assigned to it", async () => {
    // The second race server, which is the one the league practices on and the
    // one nothing is assigned to.
    const prisma = db();
    await drive(prisma, 20, { serverKey: "nabs2", scopes: [] });
    expect([...prisma.practice.values()][0]).toMatchObject({ laps: 20 });
    expect([...prisma.ledger.keys()]).toEqual(["practice:practice_20:nabs:race:race9"]);
  });

  it("follows the server's own assignment when it has exactly one series", async () => {
    const prisma = db({ seriesList: ["f1", "gt"] });
    await drive(prisma, 3, { serverKey: "nabs1", scopes: [{ series: "gt", season: 2 }] });
    expect([...prisma.practice.keys()][0]).toContain("|gt|");
  });

  it("with two series on one server, the track this week decides", async () => {
    const prisma = db({
      seriesList: ["f1", "gt"],
      nextRaceBySeries: { f1: "Monza", gt: "Spa" },
    });
    await drive(prisma, 3, {
      serverKey: "nabs1",
      scopes: [{ series: "f1", season: 8 }, { series: "gt", season: 2 }],
      trackKey: "ks_monza--nabs-monza",
    });
    expect([...prisma.practice.keys()][0]).toContain("|f1|");
  });

  it("and when the track says nothing, the driver's own series does", async () => {
    const prisma = db({
      seriesList: ["f1", "gt"],
      nextRaceBySeries: { f1: "Monza", gt: "Spa" },
      driverSeries: { "76561100000000001": ["gt"] },
    });
    await drive(prisma, 3, {
      serverKey: "nabs1",
      scopes: [{ series: "f1", season: 8 }, { series: "gt", season: 2 }],
      trackKey: "somewhere_else--x",
    });
    expect([...prisma.practice.keys()][0]).toContain("|gt|");
  });

  it("adds up both servers into one week, and says where the laps came from", async () => {
    const prisma = db();
    await drive(prisma, 12, { serverKey: "nabs1", from: 1_700_000_000 });
    await drive(prisma, 9, { serverKey: "nabs2", from: 1_700_500_000 });
    const progress = await practiceProgress(prisma, "disc1");
    expect(progress.laps).toBe(21);
    expect(progress.servers.map(({ key, laps }) => ({ key, laps }))).toEqual([
      { key: "nabs1", laps: 12 },
      { key: "nabs2", laps: 9 },
    ]);
    // Named, because "nabs2" is not what the league calls it.
    expect(progress.servers[0].name).toBe("NABS Server 1");
    // One milestone for the week, not one per server.
    expect([...prisma.ledger.values()].map((r) => r.rule)).toEqual(["practice_20"]);
  });

  it("counts nothing on a server the league has switched off", async () => {
    const prisma = db();
    await saveTuning(prisma, { practiceServers: { nabs2: false } });
    await drive(prisma, 25, { serverKey: "nabs2" });
    expect([...prisma.practice.values()]).toEqual([]);
    await saveTuning(prisma, {});
  });

  it("files laps under the week rather than the round when the calendar is empty", async () => {
    const prisma = db({ race: false });
    await drive(prisma, 20);
    const [key] = [...prisma.ledger.keys()];
    expect(key).toMatch(/^practice:practice_20:nabs:week:\d{4}-\d{2}-\d{2}$/);
  });
});
