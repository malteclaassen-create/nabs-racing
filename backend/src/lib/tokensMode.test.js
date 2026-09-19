import { describe, it, expect } from "vitest";
import { tokensMode, isTokensEnabled, tokensPublic, tokensVisibleTo, setTokensMode } from "./tokens.js";

// A prisma stand-in holding the one setting row.
function db(value) {
  const rows = new Map();
  if (value != null) rows.set("tokens_enabled", value);
  const state = { get value() { return rows.get("tokens_enabled") ?? null; } };
  return {
    state,
    setting: {
      async findUnique({ where }) {
        return rows.has(where.key) ? { value: rows.get(where.key) } : null;
      },
      async upsert({ where, update }) {
        rows.set(where.key, update.value);
      },
      async deleteMany() {},
    },
  };
}
const admin = { isAdminRequest: true };
const member = { isAdminRequest: false };

describe("the three settings", () => {
  it("reads the old on/off values too", async () => {
    expect(await tokensMode(db("1"))).toBe("all");
    expect(await tokensMode(db("0"))).toBe("off");
    expect(await tokensMode(db("admins"))).toBe("admins");
  });

  it("admins-only: on for the league, seen by admins, nothing public", async () => {
    const d = db("admins");
    expect(await isTokensEnabled(d)).toBe(true);
    expect(await tokensPublic(d)).toBe(false);
    expect(await tokensVisibleTo(d, admin)).toBe(true);
    expect(await tokensVisibleTo(d, member)).toBe(false);
    expect(await tokensVisibleTo(d, undefined)).toBe(false);
  });

  it("everyone: seen by all, public pages included", async () => {
    const d = db("all");
    expect(await tokensPublic(d)).toBe(true);
    expect(await tokensVisibleTo(d, member)).toBe(true);
  });

  it("off: nobody, not even admins", async () => {
    const d = db("off");
    expect(await isTokensEnabled(d)).toBe(false);
    expect(await tokensVisibleTo(d, admin)).toBe(false);
  });

  it("saves a mode and refuses nonsense by falling back to off", async () => {
    const d = db(null);
    expect(await setTokensMode(d, "admins")).toBe("admins");
    expect(d.state.value).toBe("admins");
    expect(await setTokensMode(d, "banana")).toBe("off");
  });
});
