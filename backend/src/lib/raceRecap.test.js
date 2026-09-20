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
vi.mock("./tokenRules.js", () => ({ raceWasClean: (row) => !(Number(row.penaltySeconds) > 0) }));
vi.mock("./standingsRow.js", () => ({ isIdleReserve: () => false }));

const { recapMode, recapVisibleTo, pendingRecapRace, seenRecapRaceId, sprintChapter } = await import("./raceRecap.js");

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

describe("the sprint chapter of a sprint weekend", () => {
  const team = (id) => ({ id, name: id, color: "#000", tier: 1 });
  const rows = [
    { driverId: "a", name: "A", status: "FINISHED", position: 1, grid: 3, points: 25, fastestLap: 0, bestLapMs: 90_000, team: team("red") },
    { driverId: "b", name: "B", status: "FINISHED", position: 2, grid: 1, points: 19, fastestLap: 1, bestLapMs: 89_500, team: team("blue") },
    { driverId: "c", name: "C", status: "FINISHED", position: 3, grid: 2, points: 15, fastestLap: 0, bestLapMs: 91_000, team: team("blue") },
    { driverId: "d", name: "D", status: "DNF", position: null, grid: 4, points: 0, fastestLap: 0, bestLapMs: 92_000, team: team("red") },
    { driverId: "e", name: "E", status: "DNS", position: null, grid: null, points: 0, fastestLap: 0, bestLapMs: null, team: team("green") },
  ];
  const race = { id: "sprint-1", track: "Monza", date: "2026-09-20T18:00:00Z", raceLaps: 12, hasPositions: true, scores: true };

  it("is nothing on a round without a sprint, or before the sprint is saved", () => {
    expect(sprintChapter({ race: null, rows })).toBeNull();
    expect(sprintChapter({ race, rows: [] })).toBeNull();
  });

  it("tells the driver's sprint from their seat, paid as the standings cell says", () => {
    const cell = { points: 43, status: "FINISHED", position: 2, sprint: { points: 25, status: "FINISHED", position: 1 } };
    const ch = sprintChapter({ race, rows, rowId: "a", cell });
    expect(ch.race).toMatchObject({ id: "sprint-1", laps: 12, fieldSize: 5, starters: 4, finishers: 3 });
    expect(ch.you).toMatchObject({ driverId: "a", finished: true, position: 1, grid: 3, gained: 2, points: 25, racePoints: 25, fieldSize: 3 });
    expect(ch.you.fastestLapMs).toBe(89_500);
    expect(ch.you.lapGapMs).toBe(500);
    // Both blue cars finished behind: a whole team beaten.
    expect(ch.you.beatTeams).toEqual(["blue"]);
    expect(ch.you.sprint).toBeNull();
  });

  it("falls back to the classification's own points without a standings cell", () => {
    const ch = sprintChapter({ race, rows, rowId: "b" });
    expect(ch.you.points).toBe(19);
    expect(ch.you.racePoints).toBe(19);
    expect(ch.you.fastestLapBonus).toBe(1);
    expect(ch.you.beatTeams).toEqual([]);
  });

  it("has no 'you' for a spectator or somebody who was not in the sprint", () => {
    expect(sprintChapter({ race, rows }).you).toBeNull();
    expect(sprintChapter({ race, rows, rowId: "zz" }).you).toBeNull();
    expect(sprintChapter({ race, rows, rowId: "zz" }).results).toHaveLength(5);
  });

  it("takes the event's sprint distance when the child row has no length of its own", () => {
    expect(sprintChapter({ race: { ...race, raceLaps: null, sprintLaps: 10 }, rows }).race.laps).toBe(10);
  });
});
