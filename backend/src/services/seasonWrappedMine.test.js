import { describe, expect, it, vi } from "vitest";

// One person, two seasons: the login points at their Season 6 row, and the
// person links tie it to their Season 7 row.
vi.mock("../lib/persons.js", () => ({
  getLinkedDriverIds: async (_prisma, id) => (id === "own-s6" || id === "own-s7" ? ["own-s6", "own-s7"] : [id]),
  discordIdsForDrivers: async () => new Map(),
}));

const { isOwnWrapped } = await import("./seasonWrappedService.js");

const rows = [
  { id: "own-s6", seasonId: "s6", discordUserId: "u1" },
  { id: "own-s7", seasonId: "s7", discordUserId: null },
  { id: "other-s7", seasonId: "s7", discordUserId: "u2" },
];
const prisma = {
  driver: {
    findUnique: async ({ where }) => rows.find((r) => r.id === where.id) || null,
    findFirst: async ({ where }) => {
      if (where.discordUserId) return rows.find((r) => r.discordUserId === where.discordUserId) || null;
      return rows.find((r) => where.id.in.includes(r.id) && r.seasonId === where.seasonId) || null;
    },
  },
};

describe("isOwnWrapped", () => {
  it("knows a member's row in another season through their person links", async () => {
    expect(await isOwnWrapped(prisma, "u1", "own-s7")).toBe(true);
    expect(await isOwnWrapped(prisma, "u1", "own-s6")).toBe(true);
  });

  it("is false for somebody else's Wrapped and for nobody signed in", async () => {
    expect(await isOwnWrapped(prisma, "u1", "other-s7")).toBe(false);
    expect(await isOwnWrapped(prisma, "u2", "own-s7")).toBe(false);
    expect(await isOwnWrapped(prisma, null, "own-s7")).toBe(false);
    expect(await isOwnWrapped(prisma, "u1", "missing")).toBe(false);
  });
});
