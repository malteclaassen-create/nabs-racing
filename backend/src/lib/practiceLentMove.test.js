import { describe, it, expect, beforeEach } from "vitest";
import { moveLentServerLapsOnce, msOf, __clearCaches } from "./practiceTokens.js";

// The week Server 2 was lent to the Friday league: its Friday tallies and
// payments, next to Server 1's own Friday week, Server 2's own Sunday week and
// an older week that has nothing to do with it.
const S1 = "76561100000000001";
const S2 = "76561100000000002";
const S3 = "76561100000000003";
const FRI = "race:r-fri";
const IN_WEEK = "2026-09-30 18:00:00";

function db({ map = { friday: "nabs1", sunday: "nabs2" } } = {}) {
  const settings = new Map([
    ["tokens_earning", "1"],
    ["live_server_map", JSON.stringify(map)],
  ]);
  const steam = { [S1]: "disc1", [S2]: "disc2", [S3]: "disc3" };
  const practice = new Map(); // `${steamId}|${series}|${period}|${server}` -> row
  const ledger = new Map(); // `${discordId}|${refKey}` -> row
  const put = (steamId, series, period, server, laps, updatedAt = IN_WEEK) =>
    practice.set(`${steamId}|${series}|${period}|${server}`, {
      laps,
      trackKey: "vhe-interlagos--nabs-interlagos-2025-v2",
      car: "f1",
      lastAt: 1_759_000_000,
      updatedAt,
    });
  const paid = (discordId, refKey, delta, createdAt = IN_WEEK) =>
    ledger.set(`${discordId}|${refKey}`, { discordId, refKey, delta, createdAt });

  async function query(sql, ...args) {
    if (/SELECT DISTINCT se\."slug" AS "slug"\s+FROM "Series" se JOIN "Season"/.test(sql)) {
      return [{ slug: "friday" }, { slug: "sunday" }];
    }
    if (/FROM "TokenLedger" WHERE "refKey" LIKE 'practice:%'/.test(sql)) {
      return [...ledger.values()].filter((r) => r.refKey.startsWith("practice:"));
    }
    if (/FROM "Race" WHERE "id" = \?/.test(sql)) {
      return args[0] === "r-fri" ? [{ track: "Interlagos", date: null }] : [];
    }
    if (/SELECT "laps","trackKey","car","lastAt" FROM "TokenPractice"/.test(sql)) {
      const row = practice.get(args.join("|"));
      return row ? [row] : [];
    }
    if (/FROM "TokenPractice"/.test(sql)) {
      return [...practice].map(([key, row]) => {
        const [steamId, series, period, server] = key.split("|");
        return { steamId, series, period, server, ...row };
      });
    }
    if (/FROM "Driver" WHERE "steamId" IN/.test(sql)) {
      return args.filter((id) => steam[id]).map((id) => ({ id: `drv-${id}`, discordUserId: steam[id] }));
    }
    if (/FROM "TokenAccount"/.test(sql)) return [{ discordId: args[0], code: "ABC123", referredBy: null }];
    return [];
  }

  async function exec(sql, ...args) {
    if (/DELETE FROM "TokenLedger"/.test(sql)) return ledger.delete(`${args[0]}|${args[1]}`) ? 1 : 0;
    if (/DELETE FROM "TokenPractice"/.test(sql)) return practice.delete(args.join("|")) ? 1 : 0;
    if (/INSERT INTO "TokenPractice"/.test(sql)) {
      const [steamId, series, period, server, laps, trackKey, car, lastAt] = args;
      practice.set(`${steamId}|${series}|${period}|${server}`, { laps, trackKey, car, lastAt, updatedAt: IN_WEEK });
      return 1;
    }
    if (/INSERT OR IGNORE INTO "TokenLedger"/.test(sql)) {
      const key = `${args[1]}|${args[6]}`;
      if (ledger.has(key)) return 0;
      ledger.set(key, { discordId: args[1], refKey: args[6], delta: args[2], createdAt: IN_WEEK });
      return 1;
    }
    return 0;
  }

  return {
    $queryRawUnsafe: query,
    $executeRawUnsafe: exec,
    setting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create, update }) => {
        settings.set(where.key, (update?.value ?? create?.value) || "");
        return { key: where.key, value: settings.get(where.key) };
      },
    },
    settings,
    practice,
    ledger,
    put,
    paid,
  };
}

const ref = (tier, server, series = "friday", period = FRI) => `practice:${tier}:${series}:${period}:${server}`;

describe("moving the lent server's week to the Friday server", () => {
  beforeEach(() => __clearCaches());

  it("adds Server 2's Friday laps to Server 1 and pays on the combined count", async () => {
    const prisma = db();
    // Neither half reached 20 on its own; together they do.
    prisma.put(S1, "friday", FRI, "nabs1", 15);
    prisma.put(S1, "friday", FRI, "nabs2", 10);
    // Paid 20 on both servers; together it is 40, which is one 20 and no 50.
    prisma.put(S2, "friday", FRI, "nabs1", 20);
    prisma.put(S2, "friday", FRI, "nabs2", 20);
    prisma.paid("disc2", ref("practice_20", "nabs1"), 10);
    prisma.paid("disc2", ref("practice_20", "nabs2"), 10);
    // Only on Server 2, with both milestones paid there: moved and paid again on Server 1.
    prisma.put(S3, "friday", FRI, "nabs2", 50);
    prisma.paid("disc3", ref("practice_20", "nabs2"), 10);
    prisma.paid("disc3", ref("practice_50", "nabs2"), 20);

    const out = await moveLentServerLapsOnce(prisma);

    expect(prisma.practice.get(`${S1}|friday|${FRI}|nabs1`).laps).toBe(25);
    expect(prisma.practice.get(`${S2}|friday|${FRI}|nabs1`).laps).toBe(40);
    expect(prisma.practice.get(`${S3}|friday|${FRI}|nabs1`).laps).toBe(50);
    expect([...prisma.practice.keys()].filter((k) => k.endsWith("|nabs2"))).toEqual([]);

    expect([...prisma.ledger.keys()].sort()).toEqual(
      [
        `disc1|${ref("practice_20", "nabs1")}`,
        `disc2|${ref("practice_20", "nabs1")}`,
        `disc3|${ref("practice_20", "nabs1")}`,
        `disc3|${ref("practice_50", "nabs1")}`,
      ].sort()
    );
    expect(out).toMatchObject({ moved: 80, tallies: 3, removedTokens: 40, paid: 40 });
  });

  it("leaves Server 2's own series and other weeks alone, and runs only once", async () => {
    const prisma = db();
    prisma.put(S1, "sunday", "race:r-sun", "nabs2", 30);
    prisma.paid("disc1", ref("practice_20", "nabs2", "sunday", "race:r-sun"), 5);
    prisma.put(S2, "friday", "race:r-old", "nabs2", 20, "2026-09-20 18:00:00");
    prisma.paid("disc2", ref("practice_20", "nabs2", "friday", "race:r-old"), 10, "2026-09-20 18:00:00");

    await moveLentServerLapsOnce(prisma);
    expect(prisma.practice.size).toBe(2);
    expect(prisma.ledger.size).toBe(2);
    expect(prisma.settings.has("practice_lent_server_moved_v1")).toBe(true);

    prisma.put(S3, "friday", FRI, "nabs2", 20);
    expect(await moveLentServerLapsOnce(prisma)).toBeNull();
    expect(prisma.practice.has(`${S3}|friday|${FRI}|nabs2`)).toBe(true);
  });

  it("does nothing, and tries again later, when no server has a series of its own", async () => {
    const prisma = db({ map: {} });
    prisma.put(S1, "friday", FRI, "nabs2", 20);
    expect(await moveLentServerLapsOnce(prisma)).toBeNull();
    expect(prisma.practice.has(`${S1}|friday|${FRI}|nabs2`)).toBe(true);
    expect(prisma.settings.has("practice_lent_server_moved_v1")).toBe(false);
  });

  it("reads the database's timestamps as UTC", () => {
    expect(msOf("2026-10-02 17:30:00")).toBe(Date.parse("2026-10-02T17:30:00Z"));
    expect(msOf("2026-10-02T17:30:00.000Z")).toBe(Date.parse("2026-10-02T17:30:00Z"));
    expect(msOf(1759426200000)).toBe(1759426200000);
    expect(msOf(new Date(1759426200000))).toBe(1759426200000);
  });
});
