import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map();
const prisma = {
  setting: {
    findUnique: vi.fn(async ({ where }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null)),
    upsert: vi.fn(async ({ where, create, update }) => {
      store.set(where.key, store.has(where.key) ? update.value : create.value);
      return {};
    }),
  },
};
vi.mock("./adminUsers.js", () => ({ isDiscordAdmin: vi.fn(async (_p, id) => id === "admin1") }));

const rc = await import("./raceControl.js");

beforeEach(() => {
  store.clear();
  rc.invalidateRaceControlCache();
  rc.__testing.misses.clear();
  rc.__testing.appSeen.clear();
});

describe("race control role and codes", () => {
  it("admins count, listed members count, others do not", async () => {
    await rc.setRaceControl(prisma, "m1", true);
    expect(await rc.isRaceControl(prisma, "m1")).toBe(true);
    expect(await rc.isRaceControl(prisma, "admin1")).toBe(true);
    expect(await rc.isRaceControl(prisma, "m2")).toBe(false);
  });

  it("a code is six easy characters and finds its owner, typed any old way", async () => {
    await rc.setRaceControl(prisma, "m1", true);
    const code = await rc.codeFor(prisma, "m1");
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(await rc.codeFor(prisma, "m1")).toBe(code);
    expect(await rc.discordIdForCode(prisma, ` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `)).toBe("m1");
  });

  it("a new code retires the old one, and losing the role retires both", async () => {
    await rc.setRaceControl(prisma, "m1", true);
    const old = await rc.codeFor(prisma, "m1");
    const fresh = await rc.newCode(prisma, "m1");
    expect(await rc.discordIdForCode(prisma, old)).toBeNull();
    expect(await rc.discordIdForCode(prisma, fresh)).toBe("m1");
    await rc.setRaceControl(prisma, "m1", false);
    expect(await rc.discordIdForCode(prisma, fresh)).toBeNull();
  });

  it("stops an address after twenty wrong codes", () => {
    for (let i = 0; i < 19; i++) rc.noteMiss("1.2.3.4", 1000);
    expect(rc.tooManyMisses("1.2.3.4", 1000)).toBe(false);
    rc.noteMiss("1.2.3.4", 1000);
    expect(rc.tooManyMisses("1.2.3.4", 1000)).toBe(true);
    expect(rc.tooManyMisses("1.2.3.4", 1000 + 11 * 60_000)).toBe(false);
  });

  it("says the app is connected while it keeps asking", () => {
    rc.markAppSeen("m1", 1000);
    expect(rc.appStatus("m1", 20_000).connected).toBe(true);
    expect(rc.appStatus("m1", 60_000).connected).toBe(false);
  });
});
