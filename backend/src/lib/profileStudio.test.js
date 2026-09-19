import { describe, it, expect } from "vitest";
import {
  STUDIO_ITEMS,
  STUDIO_BY_ID,
  STUDIO_SLOTS,
  studioPriceOf,
  studioCatalogue,
  validateContent,
  profileMediaOwner,
  equipStudio,
  ownedStudioItems,
  EMPTY_PROFILE_CONTENT,
} from "./profileStudio.js";
import { SHOP_ITEMS } from "./tokens.js";

describe("the studio catalogue", () => {
  it("has unique ids, a slot the site knows and a price", () => {
    const ids = STUDIO_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of STUDIO_ITEMS) {
      expect(STUDIO_SLOTS).toContain(i.slot);
      expect(Number.isInteger(i.price) && i.price > 0).toBe(true);
    }
  });

  it("prices per type, with the league's override winning", () => {
    const theme = STUDIO_ITEMS.find((i) => i.slot === "theme");
    expect(studioPriceOf(theme)).toBe(theme.price);
    expect(studioPriceOf(theme, { theme: { cost: 500 } })).toBe(500);
    expect(studioPriceOf(theme, { banner: { cost: 1 } })).toBe(theme.price);
    expect(studioCatalogue({ effect: { cost: 99 } }).filter((i) => i.slot === "effect").every((i) => i.price === 99)).toBe(true);
  });

  it("is reached from the shop through a link, never as an order", () => {
    const tile = SHOP_ITEMS.find((i) => i.key === "profile_studio");
    expect(tile.link).toBe("/profile/style");
    expect(tile.catalogue).toBe(true);
    // the tile's number is the cheapest design, so "from 150" is true
    expect(tile.cost).toBe(Math.min(...STUDIO_ITEMS.map((i) => i.price)));
  });
});

describe("validateContent", () => {
  const me = "111";
  const mine = `/api/uploads/profile-studio/${profileMediaOwner(me)}-banner-abc.png`;

  it("keeps saved settings a client did not send", () => {
    const prev = { ...EMPTY_PROFILE_CONTENT, title: "Rain master", nameScale: 110 };
    const out = validateContent({ density: "compact" }, me, prev);
    expect(out).toMatchObject({ title: "Rain master", nameScale: 110, density: "compact" });
  });

  it("trims and limits the texts", () => {
    expect(validateContent({ title: "  Pole king  " }, me).title).toBe("Pole king");
    expect(validateContent({ title: "x".repeat(33) }, me).error).toMatch(/title/);
  });

  it("refuses values outside their range", () => {
    expect(validateContent({ nameScale: 121 }, me).error).toMatch(/nameScale/);
    expect(validateContent({ bannerStrength: -1 }, me).error).toMatch(/bannerStrength/);
    expect(validateContent({ accentColor: "red" }, me).error).toMatch(/accent/);
    expect(validateContent({ panelShape: "hexagon" }, me).error).toMatch(/panelShape/);
    expect(validateContent({ motion: "yes" }, me).error).toMatch(/motion/);
    expect(validateContent({ nothing: 1 }, me).error).toMatch(/Invalid profile content/);
  });

  it("takes the extremes as they are", () => {
    const out = validateContent({ bannerStrength: 0, effectStrength: 100, nameScale: 80, motion: false }, me);
    expect(out).toMatchObject({ bannerStrength: 0, effectStrength: 100, nameScale: 80, motion: false });
  });

  it("only accepts the member's own uploaded pictures", () => {
    expect(validateContent({ bannerImage: mine }, me).bannerImage).toBe(mine);
    expect(validateContent({ bannerImage: mine }, "222").error).toMatch(/uploaded pictures/);
    expect(validateContent({ bannerImage: "https://elsewhere/x.png" }, me).error).toMatch(/uploaded pictures/);
    expect(validateContent({ bannerImage: null }, me).bannerImage).toBe(null);
  });
});

// A stand-in database: purchases as TokenRedemption rows, one ProfileStyle row.
function fakeDb(bought = [], style = null) {
  const state = { style };
  return {
    state,
    async $queryRawUnsafe(sql, ...args) {
      if (sql.includes('FROM "TokenRedemption"')) {
        const ids = args.slice(1);
        return bought.filter((b) => ids.includes(b)).map((itemKey) => ({ itemKey }));
      }
      if (sql.includes('FROM "ProfileStyle"')) return state.style ? [state.style] : [];
      return [];
    },
    async $executeRawUnsafe(sql, ...args) {
      if (sql.includes('INSERT INTO "ProfileStyle"')) {
        const [discordId, ...rest] = args;
        const row = { discordId };
        STUDIO_SLOTS.forEach((s, i) => (row[s] = rest[i]));
        row.content = rest[STUDIO_SLOTS.length];
        state.style = row;
        return 1;
      }
      return 0;
    },
  };
}

describe("wearing designs", () => {
  const theme = STUDIO_ITEMS.find((i) => i.slot === "theme").id;
  const banner = STUDIO_ITEMS.find((i) => i.slot === "banner").id;

  it("only what is owned, and only in its own slot", async () => {
    const db = fakeDb([theme]);
    expect((await equipStudio(db, "111", { theme })).equipped.theme).toBe(theme);
    expect((await equipStudio(db, "111", { banner })).error).toMatch(/Unlock/);
    expect((await equipStudio(db, "111", { banner: theme })).error).toMatch(/Unlock/);
  });

  it("keeps slots that were not sent and clears one sent as null", async () => {
    const db = fakeDb([theme, banner]);
    await equipStudio(db, "111", { theme, banner });
    const out = await equipStudio(db, "111", { banner: null });
    expect(out.equipped).toMatchObject({ theme, banner: null });
  });

  it("stops showing a design whose purchase was refunded", async () => {
    // bought and worn, then the purchase declined: the row still names it,
    // the ownership check no longer does
    const db = fakeDb([], { discordId: "111", theme, content: null });
    expect((await ownedStudioItems(db, "111")).size).toBe(0);
    const worn = await equipStudio(db, "111", {});
    expect(worn.equipped.theme).toBe(null);
  });
});
