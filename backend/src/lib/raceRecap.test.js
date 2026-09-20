import { describe, it, expect, vi } from "vitest";

// The pieces of the recap that decide WHETHER something is shown: the switch,
// who it is on for, and which round (if any) a member is still owed. The
// pages themselves are built from the site's own services and are covered by
// those services' tests.
vi.mock("./persons.js", () => ({
  getLinkedDriverIds: vi.fn(async (id) => [id, `${id}_old`]),
}));
vi.mock("../services/seasonService.js", () => ({
  getPrivateSeasonIds: vi.fn(async () => new Set(["season-private"])),
}));
vi.mock("../services/standingsService.js", () => ({}));
vi.mock("../services/ratingHistoryService.js", () => ({}));
vi.mock("../services/raceDetailService.js", () => ({}));
vi.mock("./series.js", () => ({}));
vi.mock("./tokens.js", () => ({}));
vi.mock("./tokenRules.js", () => ({}));
vi.mock("./standingsRow.js", () => ({ isIdleReserve: () => false }));

const { recapMode, recapVisibleTo, pendingRecapRace, seenRecapRaceId } = await import("./raceRecap.js");

function fakePrisma({ setting = null, drivers = [], race = null, seen = null } = {}) {
  return {
    setting: { findUnique: vi.fn(async () => (setting == null ? null : { value: setting })) },
    driver: { findMany: vi.fn(async () => drivers) },
    race: { findFirst: vi.fn(async () => race) },
    $queryRawUnsafe: vi.fn(async () => (seen == null ? [{ recapSeenRaceId: null }] : [{ recapSeenRaceId: seen }])),
    $executeRawUnsafe: vi.fn(async () => 1),
  };
}

describe("the switch", () => {
  it("is off until somebody turns it on, and only knows its three positions", async () => {
    expect(await recapMode(fakePrisma())).toBe("off");
    expect(await recapMode(fakePrisma({ setting: "all" }))).toBe("all");
    expect(await recapMode(fakePrisma({ setting: "admins" }))).toBe("admins");
    expect(await recapMode(fakePrisma({ setting: "banana" }))).toBe("off");
  });

  it("shows admins first, then everyone", async () => {
    const admin = { isAdminRequest: true };
    const member = { isAdminRequest: false };
    expect(await recapVisibleTo(fakePrisma({ setting: "off" }), admin)).toBe(false);
    expect(await recapVisibleTo(fakePrisma({ setting: "admins" }), admin)).toBe(true);
    expect(await recapVisibleTo(fakePrisma({ setting: "admins" }), member)).toBe(false);
    expect(await recapVisibleTo(fakePrisma({ setting: "all" }), member)).toBe(true);
    expect(await recapVisibleTo(fakePrisma({ setting: "all" }), null)).toBe(true);
  });
});

describe("which round is owed", () => {
  const drivers = [
    { id: "d1", seasonId: "season-8" },
    { id: "d1_old", seasonId: "season-7" },
  ];

  it("offers the newest finished round of the person's public seasons", async () => {
    const prisma = fakePrisma({ drivers, race: { id: "race-5" } });
    expect(await pendingRecapRace(prisma, "d1", "discord-1")).toBe("race-5");
    const where = prisma.race.findFirst.mock.calls[0][0].where;
    expect(where.seasonId.in.sort()).toEqual(["season-7", "season-8"]);
    expect(where.isCompleted).toBe(true);
    expect(where.isSpecialEvent).toBe(false);
    expect(where.results).toEqual({ some: {} });
    // Only recent rounds: the cutoff is a real date about ten days back.
    const cutoff = where.date.gte.getTime();
    expect(Date.now() - cutoff).toBeGreaterThan(9 * 86_400_000);
    expect(Date.now() - cutoff).toBeLessThan(11 * 86_400_000);
  });

  it("leaves private seasons out entirely", async () => {
    const prisma = fakePrisma({ drivers: [{ id: "d1", seasonId: "season-private" }], race: { id: "race-x" } });
    expect(await pendingRecapRace(prisma, "d1", "discord-1")).toBeNull();
    expect(prisma.race.findFirst).not.toHaveBeenCalled();
  });

  it("does not offer a round the member has already seen", async () => {
    const prisma = fakePrisma({ drivers, race: { id: "race-5" }, seen: "race-5" });
    expect(await pendingRecapRace(prisma, "d1", "discord-1")).toBeNull();
  });

  it("offers a newer round even though an older one was seen", async () => {
    const prisma = fakePrisma({ drivers, race: { id: "race-6" }, seen: "race-5" });
    expect(await pendingRecapRace(prisma, "d1", "discord-1")).toBe("race-6");
  });

  it("has nothing to offer when no recent round exists", async () => {
    const prisma = fakePrisma({ drivers, race: null });
    expect(await pendingRecapRace(prisma, "d1", "discord-1")).toBeNull();
  });

  it("treats a missing seen column as nothing seen", async () => {
    const prisma = fakePrisma({ drivers });
    prisma.$queryRawUnsafe = vi.fn(async () => {
      throw new Error("no such column");
    });
    expect(await seenRecapRaceId(prisma, "discord-1")).toBeNull();
  });
});
