import { describe, it, expect, beforeEach } from "vitest";
import {
  isWidgetsPagePublic,
  setWidgetsPagePublic,
  isAndroidWidgetsPublic,
  setAndroidWidgetsPublic,
  invalidateWidgetsPageVisibility,
} from "./widgetsPage.js";

// A Setting table small enough to hold in a Map.
function fakePrisma() {
  const rows = new Map();
  return {
    setting: {
      findUnique: async ({ where }) => rows.get(where.key) ?? null,
      upsert: async ({ where, create, update }) => {
        const row = rows.has(where.key) ? { ...rows.get(where.key), ...update } : create;
        rows.set(where.key, row);
        return row;
      },
    },
  };
}

describe("the widgets page switches", () => {
  beforeEach(() => invalidateWidgetsPageVisibility());

  it("start with the admins", async () => {
    const prisma = fakePrisma();
    expect(await isWidgetsPagePublic(prisma)).toBe(false);
    expect(await isAndroidWidgetsPublic(prisma)).toBe(false);
  });

  it("open the page and its Android half separately", async () => {
    const prisma = fakePrisma();
    await setWidgetsPagePublic(prisma, true);
    expect(await isWidgetsPagePublic(prisma)).toBe(true);
    expect(await isAndroidWidgetsPublic(prisma)).toBe(false);
    await setAndroidWidgetsPublic(prisma, true);
    expect(await isAndroidWidgetsPublic(prisma)).toBe(true);
    await setWidgetsPagePublic(prisma, false);
    expect(await isWidgetsPagePublic(prisma)).toBe(false);
    expect(await isAndroidWidgetsPublic(prisma)).toBe(true);
  });

  it("keep it with the admins when the database cannot answer", async () => {
    const broken = { setting: { findUnique: async () => { throw new Error("down"); } } };
    expect(await isAndroidWidgetsPublic(broken)).toBe(false);
  });
});
