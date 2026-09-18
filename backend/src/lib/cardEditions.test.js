import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { CARD_DESIGNS, priceOf } from "./cardShop.js";
import { unlockStateFor, isKnownEdition, CARD_EDITIONS } from "./cardEditions.js";

// Pull one edition's computed state out of the list by key.
const pick = (list, key) => list.find((e) => e.key === key);

describe("unlockStateFor — milestones (career stats over seasons <= N)", () => {
  it("locks a milestone below its threshold and reports progress", () => {
    const list = unlockStateFor({ starts: 9 }, [], [], 7);
    const rookie = pick(list, "rookie");
    expect(rookie.unlocked).toBe(false);
    expect(rookie.have).toBe(9);
    expect(rookie.need).toBe(10);
  });

  it("unlocks a milestone at its threshold", () => {
    const list = unlockStateFor({ starts: 10 }, [], [], 7);
    expect(pick(list, "rookie").unlocked).toBe(true);
  });

  it("treats a missing stat as zero", () => {
    const list = unlockStateFor({}, [], [], 7);
    expect(pick(list, "winner").unlocked).toBe(false);
    expect(pick(list, "winner").have).toBe(0);
  });
});

describe("unlockStateFor — title editions key off THIS season's seal", () => {
  const championS7 = [{ type: "champion", seasonNumber: 7 }];

  it("unlocks champion on the S7 row when the S7 seal exists", () => {
    const list = unlockStateFor({}, championS7, [], 7);
    expect(pick(list, "champion").unlocked).toBe(true);
  });

  it("does NOT unlock champion on the S8 row — the core rule", () => {
    const list = unlockStateFor({}, championS7, [], 8);
    expect(pick(list, "champion").unlocked).toBe(false);
  });

  it("a champion seal does not unlock vice — each edition tells one story", () => {
    const list = unlockStateFor({}, championS7, [], 7);
    expect(pick(list, "vice").unlocked).toBe(false);
  });

  it("title editions carry no progress numbers", () => {
    const champ = pick(unlockStateFor({}, championS7, [], 7), "champion");
    expect(champ.have).toBeUndefined();
    expect(champ.need).toBeUndefined();
  });
});

describe("unlockStateFor — team champion keys off the team seal", () => {
  it("unlocks teamchamp when the team won its tier this season", () => {
    const list = unlockStateFor({}, [], [{ position: 1, seasonNumber: 7 }], 7);
    expect(pick(list, "teamchamp").unlocked).toBe(true);
  });
  it("does not unlock teamchamp from a P2 team seal", () => {
    const list = unlockStateFor({}, [], [{ position: 2, seasonNumber: 7 }], 7);
    expect(pick(list, "teamchamp").unlocked).toBe(false);
  });
});

describe("unlockStateFor — free editions", () => {
  it("free editions are unlocked with no stats at all", () => {
    const list = unlockStateFor(null, null, null, 1);
    for (const key of ["classic", "nabs", "mono"]) {
      expect(pick(list, key).unlocked).toBe(true);
    }
  });

  it("returns an entry for every edition, earned and bought", () => {
    const list = unlockStateFor({}, [], [], 5);
    expect(list.length).toBe(CARD_EDITIONS.length + CARD_DESIGNS.length);
  });
});

// The two halves of the catalogue must not leak into each other: a design you
// bought can never satisfy a milestone, and no amount of racing hands out a
// design that is for sale.
describe("bought designs vs earned editions", () => {
  it("leaves a design locked until it is owned, and unlocks exactly that one", () => {
    const owned = new Set(["signature-gold"]);
    const list = unlockStateFor({ starts: 99, wins: 99 }, [], [], 5, owned);
    expect(pick(list, "signature-gold").unlocked).toBe(true);
    expect(pick(list, "signature-platinum").unlocked).toBe(false);
  });

  it("marks bought designs as bought and earned ones as not", () => {
    const list = unlockStateFor({}, [], [], 5, new Set());
    expect(pick(list, "spectrum-holo").bought).toBe(true);
    expect(pick(list, "spectrum-holo").requirement).toBe(null);
    expect(pick(list, "rookie").bought).toBeUndefined();
  });

  it("does not let owning every design unlock a single earned edition", () => {
    const all = new Set(CARD_DESIGNS.map((d) => d.key));
    const list = unlockStateFor({}, [], [], 5, all);
    for (const e of CARD_EDITIONS) {
      if (e.req) expect(pick(list, e.key).unlocked).toBe(false);
    }
  });

  it("prices every design", () => {
    for (const d of CARD_DESIGNS) expect(priceOf(d.key)).toBeGreaterThan(0);
  });

  it("keeps the league's key list and the frontend's drawing list in step", () => {
    // The designs are painted by frontend/src/components/collectibleEditions.js.
    // A key in one list and not the other is a design nobody can either buy or
    // see, so the file is read here rather than trusted.
    const drawn = readFileSync(
      new URL("../../../frontend/src/components/collectibleEditions.js", import.meta.url),
      "utf8"
    );
    for (const d of CARD_DESIGNS) expect(drawn).toContain(`"${d.key}"`);
  });
});

describe("isKnownEdition", () => {
  it("accepts catalogue keys and rejects junk", () => {
    expect(isKnownEdition("champion")).toBe(true);
    expect(isKnownEdition("nope")).toBe(false);
    expect(isKnownEdition(null)).toBe(false);
    expect(isKnownEdition(42)).toBe(false);
  });
});
