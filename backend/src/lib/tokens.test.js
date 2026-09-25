import { describe, it, expect } from "vitest";
import {
  attachReferral,
  attachReferralById,
  attachReferralByName,
  removeReferral,
  gainFromSeen,
  SHOP_ITEMS,
  pickName,
  EARN_RULES,
  SHOP_BY_KEY,
  REDEMPTION_STATUSES,
  CUSTOM_FLAIR_MAX,
  cleanFlairText,
  customFlairNote,
  flairFromNote,
  FLAIR_BY_KEY,
  moveRacePayouts,
} from "./tokens.js";

// The rules and the shop are the two tables the league will actually edit, so
// the shape they have to keep is pinned here rather than discovered in the UI.
describe("the tables the league tunes", () => {
  it("gives every rule a unique key and a usable payout", () => {
    const keys = EARN_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of EARN_RULES) {
      expect(typeof r.label).toBe("string");
      expect(Number.isInteger(r.points)).toBe(true);
      // A rule that pays nothing is only allowed if it is switched off — an
      // active 0-token rule reads to a member as a broken promise.
      if (r.active) expect(r.points).toBeGreaterThan(0);
    }
  });

  it("gives every shop item a unique key and a whole-number price", () => {
    const keys = SHOP_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(SHOP_BY_KEY.size).toBe(SHOP_ITEMS.length);
    for (const i of SHOP_ITEMS) {
      expect(Number.isInteger(i.cost)).toBe(true);
      expect(i.cost).toBeGreaterThan(0);
      expect(typeof i.description).toBe("string");
    }
  });

  it("keeps NEW as the status an order starts in", () => {
    expect(REDEMPTION_STATUSES[0]).toBe("NEW");
  });
});

// The card pack was removed on the league owner's decision: nothing in the shop
// may be a gamble. This is the guard rail for that, so a future entry with a
// pool or a draw fails here rather than in front of the owner.
describe("nothing in the shop is a gamble", () => {
  it("has no entry that hides what you are buying", () => {
    for (const item of SHOP_ITEMS) {
      expect(item.pool).toBeUndefined();
      expect(item.kind).toBeUndefined();
      expect(`${item.name} ${item.description}`.toLowerCase()).not.toContain("random");
    }
  });
});

// A flair somebody wrote themselves is the only thing in the shop that puts a
// member's own words on a public page, so the two things that keep it safe are
// pinned here: what the text is allowed to be, and that it is never confused
// with one of the fixed marks.
describe("the flair you write yourself", () => {
  it("tidies what was typed", () => {
    expect(cleanFlairText("  Late   braker ")).toEqual({ text: "Late braker" });
    expect(cleanFlairText("two\nlines")).toEqual({ text: "two lines" });
  });

  it("turns down nothing and turns down an essay", () => {
    expect(cleanFlairText("   ").error).toBeTruthy();
    expect(cleanFlairText(null).error).toBeTruthy();
    expect(cleanFlairText("x".repeat(CUSTOM_FLAIR_MAX + 1)).error).toBeTruthy();
    expect(cleanFlairText("x".repeat(CUSTOM_FLAIR_MAX))).toEqual({ text: "x".repeat(CUSTOM_FLAIR_MAX) });
  });

  it("reads back as its own kind, and never as a fixed mark", () => {
    const note = customFlairNote("Runs on currywurst");
    expect(flairFromNote(note)).toMatchObject({ label: "Runs on currywurst", custom: true });
    expect(FLAIR_BY_KEY.has(note)).toBe(false);
    expect(flairFromNote("night_owl")).toMatchObject({ label: "Night owl" });
    expect(flairFromNote("night_owl").custom).toBeUndefined();
    expect(flairFromNote("nothing_like_it")).toBeNull();
    expect(flairFromNote("custom:   ")).toBeNull();
  });
});

// The nav bar plays a "+100" over the token count when something has been
// earned since it last spoke. What counts as "earned since" is this, and the
// two things it must never do are celebrate somebody's whole history on their
// first visit and congratulate them on money they just spent.
describe("gainFromSeen", () => {
  it("says nothing on a first look, whatever the balance", () => {
    expect(gainFromSeen(null, 5000)).toBe(null);
    expect(gainFromSeen(undefined, 5000)).toBe(null);
  });

  it("says nothing when the balance has not moved", () => {
    expect(gainFromSeen(1200, 1200)).toBe(null);
  });

  it("says nothing after spending", () => {
    expect(gainFromSeen(1200, 800)).toBe(null);
  });

  it("reports a rise, and where it started", () => {
    expect(gainFromSeen(1200, 1300)).toEqual({ gained: 100, from: 1200 });
  });

  it("survives nonsense instead of showing NaN in the nav bar", () => {
    expect(gainFromSeen("x", 100)).toBe(null);
    expect(gainFromSeen(100, undefined)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Who invited whom can arrive two ways: the ?ref= link somebody clicked, or the
// league's Discord bot saying which server invite a new member joined through.
// Both end in the same place, and these check that the second way cannot be
// used to claim anything the first way could not.
// ---------------------------------------------------------------------------
function fakeDb({ accounts = [], hasRaced = [], ledger = [] } = {}) {
  const rows = accounts.map((a) => ({ referredBy: null, ...a }));
  return {
    rows,
    ledger,
    async $queryRawUnsafe(sql, ...args) {
      if (sql.includes('LEFT JOIN "MemberAccount"')) return rows;
      if (sql.includes('FROM "MemberAccount" WHERE')) return rows.filter((r) => r.discordId === args[0]);
      if (sql.includes('"TokenAccount" WHERE "discordId"')) return rows.filter((r) => r.discordId === args[0]);
      if (sql.includes('"TokenAccount" WHERE "code"')) return rows.filter((r) => r.code === args[0]);
      if (sql.includes('FROM "Driver"')) return hasRaced.includes(args[0]) ? [{ id: `driver-${args[0]}` }] : [];
      if (sql.includes('FROM "PersonLink"')) return [];
      if (sql.includes('FROM "RaceResult"')) return [{ one: 1 }]; // only asked about a driver that exists
      return [];
    },
    async $executeRawUnsafe(sql, ...args) {
      if (sql.includes('INSERT INTO "TokenAccount"')) {
        rows.push({ discordId: args[0], code: args[1], referredBy: null });
        return 1;
      }
      if (sql.includes('SET "referredBy" = NULL')) {
        const row = rows.find((r) => r.discordId === args[0]);
        if (row) row.referredBy = null;
        return 1;
      }
      if (sql.includes('DELETE FROM "TokenLedger"')) {
        const [owner, joinKey, raceLike] = args;
        const prefix = raceLike.replace(/%$/, "").replace(/\\(.)/g, "$1");
        const before = ledger.length;
        for (let i = ledger.length - 1; i >= 0; i--) {
          const r = ledger[i];
          if (r.discordId === owner && (r.refKey === joinKey || r.refKey.startsWith(prefix))) ledger.splice(i, 1);
        }
        return before - ledger.length;
      }
      if (sql.includes('SET "referredBy"')) {
        const row = rows.find((r) => r.discordId === args[1]);
        if (!row || row.referredBy) return 0; // WHERE "referredBy" IS NULL
        row.referredBy = args[0];
        return 1;
      }
      return 0;
    },
  };
}

describe("a referral the Discord bot reports", () => {
  const STEVE = { discordId: "steve", code: "AAAA11" };

  it("links a new member to whoever's invite they joined through", async () => {
    const db = fakeDb({ accounts: [STEVE, { discordId: "new" }] });
    expect(await attachReferralById(db, "new", "steve")).toBe("steve");
    expect(db.rows.find((r) => r.discordId === "new").referredBy).toBe("steve");
  });

  it("works for an inviter who has never opened the website", async () => {
    // People bring friends into the Discord long before they first visit the
    // site; the account is made here rather than the credit being lost.
    const db = fakeDb({ accounts: [{ discordId: "new" }] });
    expect(await attachReferralById(db, "new", "steve")).toBe("steve");
    expect(db.rows.some((r) => r.discordId === "steve")).toBe(true);
  });

  it("keeps the first inviter when the same join is reported again", async () => {
    const db = fakeDb({ accounts: [STEVE, { discordId: "other" }, { discordId: "new" }] });
    await attachReferralById(db, "new", "steve");
    expect(await attachReferralById(db, "new", "other")).toBe(null);
    expect(db.rows.find((r) => r.discordId === "new").referredBy).toBe("steve");
  });

  it("refuses somebody inviting themselves", async () => {
    const db = fakeDb({ accounts: [STEVE] });
    expect(await attachReferralById(db, "steve", "steve")).toBe(null);
  });

  it("refuses somebody who has already raced in the league", async () => {
    // The same guard as the link: payouts run over a whole career, so claiming
    // a long-standing driver as your invite must stay impossible whichever way
    // the claim arrives.
    const db = fakeDb({ accounts: [STEVE, { discordId: "veteran" }], hasRaced: ["veteran"] });
    expect(await attachReferralById(db, "veteran", "steve")).toBe(null);
  });

  it("shrugs off half-filled entries instead of writing them", async () => {
    const db = fakeDb({ accounts: [STEVE] });
    expect(await attachReferralById(db, "", "steve")).toBe(null);
    expect(await attachReferralById(db, "new", null)).toBe(null);
  });

  it("agrees with the invite link, which resolves to the same member", async () => {
    const byLink = fakeDb({ accounts: [STEVE, { discordId: "new" }] });
    const byBot = fakeDb({ accounts: [STEVE, { discordId: "new" }] });
    expect(await attachReferral(byLink, "new", "aaaa11")).toBe("steve"); // codes are not case sensitive
    expect(await attachReferralById(byBot, "new", "steve")).toBe("steve");
  });

  it("ignores an invite code that belongs to nobody", async () => {
    const db = fakeDb({ accounts: [{ discordId: "new" }] });
    expect(await attachReferral(db, "new", "ZZZZ99")).toBe(null);
  });
});

// The newcomer types who brought them in: a code or a name.
describe("naming who invited you", () => {
  const STEVE = { discordId: "steve", code: "AAAA11", displayName: "Steve" };

  it("takes the inviter's name, whatever the case", async () => {
    const db = fakeDb({ accounts: [STEVE, { discordId: "new" }] });
    expect(await attachReferralByName(db, "new", "  steve ")).toEqual({ ok: true, inviter: "Steve" });
    expect(db.rows.find((r) => r.discordId === "new").referredBy).toBe("steve");
  });

  it("takes the inviter's code", async () => {
    const db = fakeDb({ accounts: [STEVE, { discordId: "new" }] });
    expect((await attachReferralByName(db, "new", "aaaa11")).ok).toBe(true);
  });

  it("refuses a name two members share, rather than guess", async () => {
    const db = fakeDb({ accounts: [STEVE, { discordId: "steve2", code: "BBBB22", username: "steve" }, { discordId: "new" }] });
    expect((await attachReferralByName(db, "new", "Steve")).error).toMatch(/more than one/i);
    expect(db.rows.find((r) => r.discordId === "new").referredBy).toBe(null);
  });

  it("refuses nobody, yourself, a second inviter and a driver who has raced", async () => {
    const db = fakeDb({
      accounts: [STEVE, { discordId: "me", displayName: "Me" }, { discordId: "vet" }],
      hasRaced: ["vet"],
    });
    expect((await attachReferralByName(db, "me", "Nobody")).error).toBeTruthy();
    expect((await attachReferralByName(db, "me", "Me")).error).toBeTruthy();
    expect((await attachReferralByName(db, "vet", "Steve")).error).toBeTruthy();
    expect((await attachReferralByName(db, "me", "Steve")).ok).toBe(true);
    expect((await attachReferralByName(db, "me", "Steve")).error).toMatch(/already/);
  });
});

describe("taking a wrong inviter back", () => {
  it("clears the inviter and what they were paid for that member, nothing else", async () => {
    const db = fakeDb({
      accounts: [{ discordId: "steve", code: "AAAA11" }, { discordId: "jayden", referredBy: "steve" }],
      ledger: [
        { discordId: "steve", refKey: "referral-join:jayden" },
        { discordId: "steve", refKey: "referral-race:jayden:race1" },
        { discordId: "steve", refKey: "referral-join:someone" },
        { discordId: "steve", refKey: "race:race1:d1" },
      ],
    });
    expect(await removeReferral(db, "jayden")).toEqual({ ok: true, removed: 2 });
    expect(db.rows.find((r) => r.discordId === "jayden").referredBy).toBe(null);
    expect(db.ledger.map((r) => r.refKey)).toEqual(["referral-join:someone", "race:race1:d1"]);
  });

  it("says so when there is nobody to take back", async () => {
    const db = fakeDb({ accounts: [{ discordId: "jayden" }] });
    expect((await removeReferral(db, "jayden")).error).toBeTruthy();
  });
});


// A member the site has never seen is the normal case for anybody who was
// invited into the Discord: no login, maybe no driver row, and the admin list
// used to print their id where the name goes.
describe("what to call somebody", () => {
  it("takes the best name there is", () => {
    expect(pickName({ displayName: "Takoda", username: "takoda_", driverName: "T. Claassen" })).toBe("Takoda");
    expect(pickName({ username: "takoda_", driverName: "T. Claassen" })).toBe("takoda_");
    expect(pickName({ driverName: "T. Claassen", discordName: "tak" })).toBe("T. Claassen");
    expect(pickName({ discordName: "tak" })).toBe("tak");
  });

  it("says nothing rather than something blank", () => {
    expect(pickName({ displayName: "  ", username: null })).toBe(null);
    expect(pickName({})).toBe(null);
    expect(pickName()).toBe(null);
  });
});

// A merge moves a row's results onto the kept row. The payments for them are
// filed under the row id (race:<raceId>:<driverId>), and a payment the next
// reconciliation cannot find under the kept row is a payment it makes again.
describe("moveRacePayouts", () => {
  // Just enough of a ledger for the four statements the move runs.
  function fakeDb(keys) {
    const ledger = keys.map((refKey, i) => ({ id: String(i), refKey }));
    // SQLite's LIKE with ESCAPE '\': % any run, _ one character, \x literal x.
    const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const likeToRegex = (pat) => {
      let re = "";
      for (let i = 0; i < pat.length; i++) {
        const c = pat[i];
        if (c === "\\") re += esc(pat[++i]);
        else if (c === "%") re += ".*";
        else if (c === "_") re += ".";
        else re += esc(c);
      }
      return new RegExp(`^${re}$`);
    };
    return {
      ledger,
      $queryRawUnsafe: async (sql, pat) => ledger.filter((r) => likeToRegex(pat).test(r.refKey)),
      $executeRawUnsafe: async (sql, a, b) => {
        if (sql.includes('"TokenLedger"')) {
          const row = ledger.find((r) => r.id === b);
          if (!row || ledger.some((r) => r.refKey === a)) return 0;
          row.refKey = a;
          return 1;
        }
        return 0;
      },
    };
  }

  it("files the dropped row's race payments under the kept row", async () => {
    const db = fakeDb(["race:r1:old_s8", "clean:r1:old_s8", "race:r2:old_s8", "race:r1:other_s8", "shop:x"]);
    expect(await moveRacePayouts(db, "old_s8", "new_s8")).toBe(3);
    expect(db.ledger.map((r) => r.refKey)).toEqual([
      "race:r1:new_s8",
      "clean:r1:new_s8",
      "race:r2:new_s8",
      "race:r1:other_s8",
      "shop:x",
    ]);
  });

  it("does not take a row whose id only ends the same way", async () => {
    // "_" is a LIKE wildcard: unescaped, old_s8 would also match oldXs8.
    const db = fakeDb(["race:r1:oldXs8", "race:r1:xold_s8"]);
    expect(await moveRacePayouts(db, "old_s8", "new_s8")).toBe(0);
  });
});
