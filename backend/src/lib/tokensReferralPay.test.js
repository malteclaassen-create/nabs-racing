import { describe, it, expect } from "vitest";
import { syncEarned } from "./tokens.js";

// Naming an inviter costs nothing, so nothing is paid for it until the person
// named has actually raced: otherwise every spare Discord account somebody
// signs in with is 50 points for them.
function db({ inviteeRaces = [] } = {}) {
  const ledger = [];
  return {
    ledger,
    setting: {
      findUnique: async ({ where }) => (where.key === "tokens_earning" ? { value: "1" } : null),
    },
    async $queryRawUnsafe(sql, ...args) {
      if (sql.includes('FROM "TokenAccount" WHERE "discordId"')) return [{ discordId: args[0], code: "AAAA11" }];
      if (sql.includes('WHERE "referredBy" = ?')) return args[0] === "steve" ? [{ discordId: "new" }] : [];
      if (sql.includes('SELECT "id" FROM "Driver" WHERE "discordUserId"')) return args[0] === "new" ? [{ id: "d-new" }] : [];
      if (sql.includes('FROM "RaceResult" r')) return args.includes("d-new") ? inviteeRaces : [];
      if (sql.includes('FROM "MemberAccount"')) return [{ displayName: "Jayden" }];
      return [];
    },
    async $executeRawUnsafe(sql, ...args) {
      if (sql.includes('INSERT OR IGNORE INTO "TokenLedger"')) {
        if (ledger.some((r) => r.discordId === args[1] && r.refKey === args[6])) return 0;
        ledger.push({ discordId: args[1], delta: args[2], rule: args[3], refKey: args[6] });
        return 1;
      }
      return 0;
    },
  };
}

describe("paying for somebody you brought in", () => {
  it("pays nothing while they have not raced", async () => {
    const prisma = db();
    await syncEarned(prisma, "steve");
    expect(prisma.ledger.filter((r) => r.rule.startsWith("referral"))).toEqual([]);
  });

  it("pays the bonus and the race once they have finished one", async () => {
    const prisma = db({
      inviteeRaces: [{ raceId: "r1", driverId: "d-new", date: Date.now(), track: "Spa", series: "f1", parentRaceId: null }],
    });
    await syncEarned(prisma, "steve");
    const rules = prisma.ledger.filter((r) => r.discordId === "steve").map((r) => r.rule).sort();
    expect(rules).toEqual(["referral_join", "referral_race"]);
  });
});
