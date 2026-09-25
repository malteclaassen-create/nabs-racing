import { describe, it, expect, beforeEach } from "vitest";
import { cleanTuning, saveTuning, resetTuning } from "./tokenTuning.js";
import {
  tunedRules,
  tunedShop,
  tunedReferralLimit,
  tunedMultiplier,
  tunedStartDay,
  setEarning,
  EARN_RULES,
  SHOP_ITEMS,
} from "./tokens.js";
import { activityMultiplier, MULTIPLIER, REFERRAL_RACE_LIMIT } from "./tokenRules.js";
import { priceOf, catalogueFor } from "./cardShop.js";

const ALLOWED = {
  rules: EARN_RULES.map((r) => r.key),
  shop: SHOP_ITEMS.map((i) => i.key),
  cards: ["concepts", "spectrum", "velocity", "signature"],
};

// A prisma stand-in: the tuning module only ever upserts and deletes one row.
const fakePrisma = {
  setting: {
    async upsert() {},
    async deleteMany() {},
    async findUnique() {
      return null;
    },
  },
};

describe("cleanTuning", () => {
  it("keeps only what was filled in, as whole numbers", () => {
    const out = cleanTuning(
      { rules: { race_finish: { points: "60", active: true } }, shop: { helmet: { cost: 1000 } } },
      ALLOWED
    );
    expect(out.tuning).toEqual({ rules: { race_finish: { points: 60, active: true } }, shop: { helmet: { cost: 1000 } } });
  });

  it("takes the word that goes in front of a price", () => {
    const out = cleanTuning({ shop: { helmet: { prefix: "  from " } } }, ALLOWED);
    expect(out.tuning).toEqual({ shop: { helmet: { prefix: "from" } } });
    // Empty is the league saying "just the number", and a default the code
    // moves later reaches them again.
    expect(cleanTuning({ shop: { helmet: { prefix: "   " } } }, ALLOWED).tuning).toEqual({});
    expect(cleanTuning({ shop: { helmet: { prefix: "starting from about" } } }, ALLOWED).error).toMatch(/characters/);
  });

  it("drops empty fields so the default takes over again", () => {
    const out = cleanTuning({ rules: { race_finish: { points: "" } }, referralRaceLimit: "" }, ALLOWED);
    expect(out.tuning).toEqual({});
  });

  it("refuses decimals and negatives", () => {
    expect(cleanTuning({ rules: { race_finish: { points: 12.5 } } }, ALLOWED).error).toMatch(/whole number/);
    expect(cleanTuning({ shop: { helmet: { cost: -5 } } }, ALLOWED).error).toMatch(/whole number/);
    expect(cleanTuning({ referralRaceLimit: "abc" }, ALLOWED).error).toMatch(/whole number/);
  });

  it("ignores rules and items the code does not know", () => {
    const out = cleanTuning({ rules: { jackpot: { points: 9999 } }, shop: { lambo: { cost: 1 } } }, ALLOWED);
    expect(out.tuning).toEqual({});
  });

  it("wants the multiplier's upper number above the lower one", () => {
    expect(cleanTuning({ multiplier: { chat: { min: 500, max: 50 } } }, ALLOWED).error).toMatch(/above/);
    expect(cleanTuning({ multiplier: { voice: { min: 60, max: 600 } } }, ALLOWED).tuning).toEqual({
      multiplier: { voice: { min: 60, max: 600 } },
    });
  });
});

describe("the numbers the site actually uses", () => {
  beforeEach(async () => {
    await resetTuning(fakePrisma);
  });

  it("are the code's defaults with nothing saved", () => {
    expect(tunedRules().find((r) => r.key === "race_finish").points).toBe(50);
    expect(tunedShop().find((i) => i.key === "helmet").cost).toBe(1500);
    expect(tunedReferralLimit()).toBe(REFERRAL_RACE_LIMIT);
    expect(tunedMultiplier()).toEqual(MULTIPLIER);
  });

  it("follow a saved override, field by field", async () => {
    await saveTuning(fakePrisma, {
      rules: { race_finish: { points: 60 }, clean_race: { active: false } },
      shop: { helmet: { cost: 999, active: false } },
      referralRaceLimit: 6,
      multiplier: { chat: { max: 300 } },
    });
    const rules = tunedRules();
    expect(rules.find((r) => r.key === "race_finish").points).toBe(60);
    expect(rules.find((r) => r.key === "clean_race")).toMatchObject({ points: 20, active: false });
    expect(rules.find((r) => r.key === "referral_join").points).toBe(50); // untouched
    const helmet = tunedShop().find((i) => i.key === "helmet");
    expect(helmet).toMatchObject({ cost: 999, active: false });
    expect(tunedReferralLimit()).toBe(6);
    // only the one number moved, the rest of the half stays as in the code
    expect(tunedMultiplier().chat).toEqual({ ...MULTIPLIER.chat, max: 300 });
    expect(tunedMultiplier().voice).toEqual(MULTIPLIER.voice);
  });

  it("cannot switch the activity line on: it is a multiplier, not a payout", async () => {
    await saveTuning(fakePrisma, { rules: { activity: { active: true, points: 100 } } });
    const a = tunedRules().find((r) => r.key === "activity");
    expect(a.active).toBe(false);
  });

  it("go back to the defaults on reset", async () => {
    await saveTuning(fakePrisma, { rules: { race_finish: { points: 60 } } });
    await resetTuning(fakePrisma);
    expect(tunedRules().find((r) => r.key === "race_finish").points).toBe(50);
  });
});

describe("the multiplier with the league's own thresholds", () => {
  it("reaches 2.0x for chat at whatever the upper number is", () => {
    const m = { ...MULTIPLIER, chat: { min: 10, max: 100 } };
    expect(activityMultiplier({ chatMessages: 100 }, m).chat).toBe(2);
    expect(activityMultiplier({ chatMessages: 100 }).chat).toBeLessThan(2); // defaults: 500 needed
  });
});

describe("card prices with an override per series", () => {
  it("prices every design of the series, and only that series", () => {
    const o = { spectrum: { cost: 350 } };
    expect(priceOf("spectrum-holo", o)).toBe(350);
    expect(priceOf("concept-liquid", o)).toBe(900);
    const cat = catalogueFor(new Set(), o);
    expect(cat.find((c) => c.key === "spectrum").cost).toBe(350);
    expect(cat.find((c) => c.key === "spectrum").designs.every((d) => d.cost === 350)).toBe(true);
  });
});

describe("the start day", () => {
  beforeEach(async () => {
    await resetTuning(fakePrisma);
  });

  it("is a plain date or nothing", () => {
    expect(cleanTuning({ startDay: "2026-09-19" }, ALLOWED).tuning).toEqual({ startDay: "2026-09-19" });
    expect(cleanTuning({ startDay: "" }, ALLOWED).tuning).toEqual({});
    expect(cleanTuning({ startDay: "19.09.2026" }, ALLOWED).error).toMatch(/YYYY-MM-DD/);
  });

  it("is today whenever the COUNTING is started, so nothing before it pays", async () => {
    expect(tunedStartDay()).toBe(null);
    await setEarning(fakePrisma, true);
    const today = tunedStartDay();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A day left over from a trial run, or typed in by hand, does not survive
    // the switch: starting means from now on.
    await saveTuning(fakePrisma, { startDay: "2026-01-01" });
    await setEarning(fakePrisma, false);
    await setEarning(fakePrisma, true);
    expect(tunedStartDay()).toBe(today);
  });
});
