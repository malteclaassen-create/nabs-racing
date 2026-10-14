import { describe, expect, it, vi } from "vitest";

// One series, three seasons: 6 finished, 7 being raced, 5 finished but not
// published yet.
const SEASONS = [
  { id: "s5", number: 5, name: "5", isActive: false },
  { id: "s6", number: 6, name: "6", isActive: false },
  { id: "s7", number: 7, name: "7", isActive: true },
];
const RACES = {
  s5: [{ number: 1, isCompleted: true, isSpecialEvent: false }],
  s6: [
    { number: 1, isCompleted: true, isSpecialEvent: false },
    { number: 2, isCompleted: true, isSpecialEvent: false },
  ],
  s7: [
    { number: 1, isCompleted: true, isSpecialEvent: false },
    { number: 2, isCompleted: false, isSpecialEvent: false },
  ],
};

vi.mock("../lib/series.js", async (orig) => ({
  ...(await orig()),
  resolveSeries: async () => ({ id: "f1", slug: "friday-f1", name: "NABS Racing League" }),
  seasonIdsOfSeries: async () => SEASONS.map(({ id, number }) => ({ id, number })),
}));
vi.mock("./seasonService.js", async (orig) => ({
  ...(await orig()),
  getPrivateSeasonIds: async () => new Set(["s5"]),
  getActiveSeason: async () => SEASONS[2],
  resolveSeason: async (_p, n) => SEASONS.find((s) => s.number === Number(n)) || null,
}));

const { wrappedSeasonNumbers, getWrappedHub } = await import("./seasonWrappedService.js");

const prisma = {
  race: { findMany: async ({ where }) => RACES[where.seasonId] || [] },
  season: { findMany: async () => [], findUnique: async ({ where }) => SEASONS.find((s) => s.id === where.id) || null },
};

describe("Season Wrapped is for finished seasons only", () => {
  it("lists the finished, published seasons", async () => {
    expect(await wrappedSeasonNumbers(prisma, "friday-f1")).toEqual([6]);
  });

  it("answers notFinished for a season still being raced", async () => {
    const hub = await getWrappedHub(prisma, { series: "friday-f1", season: "7" });
    expect(hub).toEqual({ notFinished: true, season: { number: 7, label: "Season 7" } });
  });

  it("has nothing to show, and says what it waits for, before any season is over", async () => {
    RACES.s6[1].isCompleted = false;
    try {
      const hub = await getWrappedHub(prisma, { series: "friday-f1" });
      expect(hub.season).toBeNull();
      expect(hub.drivers).toEqual([]);
      expect(hub.waitingFor).toBe("Season 7");
      expect(await wrappedSeasonNumbers(prisma, "friday-f1")).toEqual([]);
    } finally {
      RACES.s6[1].isCompleted = true;
    }
  });
});
