import { describe, it, expect } from "vitest";
import {
  tokensMode,
  isTokensEnabled,
  tokensPublic,
  tokensVisibleTo,
  setTokensMode,
  isEarningOn,
  setEarning,
  tunedStartDay,
} from "./tokens.js";
import { saveTuning } from "./tokenTuning.js";

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

// Being seen and being earned are separate switches: the league can show the
// whole thing to everybody while nothing is being counted yet.
describe("the earning switch", () => {
  it("is off until somebody turns it on", async () => {
    const d = db("all");
    expect(await isEarningOn(d)).toBe(false);
    await setEarning(d, true);
    expect(await isEarningOn(d)).toBe(true);
    await setEarning(d, false);
    expect(await isEarningOn(d)).toBe(false);
  });

  it("is independent of who can see the feature", async () => {
    const d = db("admins");
    await setEarning(d, true);
    expect(await tokensMode(d)).toBe("admins");
    expect(await isEarningOn(d)).toBe(true);
    await setTokensMode(d, "all");
    expect(await isEarningOn(d)).toBe(true); // changing the mode leaves it alone
  });

  it("keeps the start day when it is pressed while already running", async () => {
    const d = db("all");
    await setEarning(d, true);
    await saveTuning(d, { startDay: "2026-01-01" });
    await setEarning(d, true);
    expect(tunedStartDay()).toBe("2026-01-01");
  });
});
