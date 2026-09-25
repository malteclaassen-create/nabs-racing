// A sprint weekend through the recap: one round, two races, and the points
// told as the two that paid them.
//
// Everything the recap reads from is a service of its own with its own tests,
// so all of them are stood in for here. What is under test is the wiring: that
// the sprint comes back beside the feature race in the same shape, that each
// race reports what IT paid, that the round's total is still the championship's
// own number, that the NABS Tokens of both races are found, and that asking for
// the sprint gives you the weekend rather than half of it.
import { describe, it, expect, vi, beforeEach } from "vitest";

const PARENT = "round1";
const CHILD = "round1-sprint";
const ME = "d1";

vi.mock("./sprintRaces.js", () => ({
  readParentIds: vi.fn(async (_p, ids) => new Map(ids.includes(CHILD) ? [[CHILD, PARENT]] : [])),
  readSprintChildren: vi.fn(async (_p, ids) => new Map(ids.includes(PARENT) ? [[PARENT, CHILD]] : [])),
}));

// The two classifications of the night. The sprint is the shorter race, and
// the driver finished it a place further up.
const row = (driverId, name, position, grid, points) => ({
  driverId,
  name,
  position,
  rawPosition: position,
  status: "FINISHED",
  grid,
  points,
  fastestLap: 0,
  laps: 15,
  bestLapMs: 90_000,
  penaltySeconds: 0,
  team: { id: "t1", name: "AIX Racing", color: "#0af", tier: 1 },
});

const DETAIL = {
  [PARENT]: {
    race: { id: PARENT, number: 1, track: "Baku", raceLaps: 15, isCompleted: true },
    results: [row("d0", "Leader", 1, 1, 25), row(ME, "You", 4, 6, 12), row("d2", "Other", 5, 4, 10)],
    quali: [],
  },
  [CHILD]: {
    race: { id: CHILD, number: null, track: "Baku", raceLaps: 8, isCompleted: true, sprintOf: PARENT },
    results: [row("d0", "Leader", 1, 1, 25), row(ME, "You", 3, 5, 15), row("d2", "Other", 6, 2, 8)],
    quali: [],
  },
};

vi.mock("../services/raceDetailService.js", () => ({
  raceDetailPayload: vi.fn(async (_p, race) => DETAIL[race.id]),
}));

// The championship's own cell for the round: the total, with the sprint's
// share beside it (services/standingsService.js).
const CELL = { points: 47, status: "FINISHED", position: 4, grid: 6, sprint: { points: 22, status: "FINISHED", position: 3 } };
const standings = async () => ({
  standings: [
    { driverId: "d0", name: "Leader", total: 60, perRace: {}, team: null },
    { driverId: ME, name: "You", total: 47, perRace: { 1: CELL }, team: { id: "t1", name: "AIX Racing", color: "#0af" }, droppedRounds: [] },
  ],
  dropWorst: 0,
});
vi.mock("../services/standingsService.js", () => ({
  getDriverStandings: vi.fn(async () => standings()),
  getT1ConstructorStandings: vi.fn(async () => ({ standings: [] })),
  getT2ConstructorStandings: vi.fn(async () => ({ standings: [] })),
}));

vi.mock("../services/ratingHistoryService.js", () => ({ getDriverRatingHistory: vi.fn(async () => null) }));
vi.mock("../services/seasonService.js", () => ({ getPrivateSeasonIds: vi.fn(async () => new Set()) }));
vi.mock("../services/cardRatingService.js", () => ({ getCardRating: vi.fn(async () => null) }));
vi.mock("../services/cockpitService.js", () => ({ cockpitContext: vi.fn(async () => null) }));
vi.mock("./persons.js", () => ({
  getLinkedDriverIds: vi.fn(async (id) => [id]),
  getIdentityOverrides: vi.fn(async () => new Map()),
}));
vi.mock("./standingsRow.js", () => ({ isIdleReserve: () => false }));
vi.mock("./series.js", () => ({ getSeriesById: vi.fn(async () => ({ slug: "sunday", name: "Sunday Championship" })) }));
vi.mock("./raceHero.js", () => ({ readRaceHeroes: vi.fn(async () => new Map()) }));
vi.mock("./cardEditions.js", () => ({ readCardEdition: vi.fn(async () => null), readCardAnim: vi.fn(async () => null) }));
vi.mock("./cardPhoto.js", () => ({
  readCardPhotoPos: vi.fn(async () => null),
  cardPictureFor: () => ({ cardPhotoUrl: null, photoPos: null }),
  personPhotoFor: () => null,
  photoFallbacksFor: () => [],
}));
vi.mock("./driverRoles.js", () => ({ readDriverRoles: vi.fn(async () => new Map()) }));
vi.mock("./trackKeys.js", () => ({ groupKeyFor: (t) => t }));
vi.mock("./raceContacts.js", () => ({ contactsForDriver: () => [] }));
// No archived file in this test: the lap-by-lap story is the archive's own.
vi.mock("./cockpitArchive.js", () => ({
  findArchiveForRace: () => null,
  analyzeRaceFor: () => null,
  raceInsightsFor: () => null,
  fieldPaceTable: () => null,
  hasArchiveFor: () => false,
}));
vi.mock("./tokens.js", () => ({
  tokensVisibleTo: vi.fn(async () => true),
  isEarningOn: vi.fn(async () => true),
  syncEarned: vi.fn(async () => {}),
  dbBalance: vi.fn(async () => 500),
  tunedRules: () => [
    { key: "race_finish", points: 10, active: true },
    { key: "clean_race", points: 5, active: true },
  ],
  cardCatalogueFor: vi.fn(async () => []),
}));
vi.mock("./tokenRules.js", () => ({
  raceWasClean: () => true,
  // Still open, so both clean-race bonuses are owed rather than paid.
  stewardingClosed: () => false,
  withMultiplier: (points, rate) => points * rate,
}));

const { buildRaceRecap } = await import("./raceRecap.js");

// The payout wrote a row per race: the sprint is saved as its own race, so it
// has its own ledger key (lib/tokens.js payRace).
const LEDGER = [
  { rule: "race_finish", title: "Finished a race", delta: 10, refKey: `race:${PARENT}:${ME}` },
  { rule: "race_finish", title: "Finished a race", delta: 10, refKey: `race:${CHILD}:${ME}` },
];

function fakePrisma() {
  const races = {
    [PARENT]: { id: PARENT, number: 1, track: "Baku", date: new Date("2026-09-20T17:00:00Z"), seasonId: "s6", isSpecialEvent: false, season: { id: "s6", number: 6, name: "Season 6", seriesId: "sun" } },
    [CHILD]: { id: CHILD, number: null, track: "Baku", date: new Date("2026-09-20T17:00:00Z"), seasonId: "s6", isSpecialEvent: true, season: { id: "s6", number: 6, name: "Season 6", seriesId: "sun" } },
  };
  return {
    race: {
      findUnique: vi.fn(async ({ where }) => races[where.id] || null),
      findFirst: vi.fn(async () => ({ number: 1 })),
      findMany: vi.fn(async () => [{ id: PARENT, number: 1, track: "Baku", isCompleted: true }]),
    },
    driver: {
      findMany: vi.fn(async () => [{ id: ME, seasonId: "s6" }]),
      findUnique: vi.fn(async () => ({ steamId: "76561198000000001", team: null })),
    },
    raceResult: { findMany: vi.fn(async () => []) },
    $queryRawUnsafe: vi.fn(async (sql, ...args) => {
      if (sql.includes("TokenLedger")) return LEDGER.filter((r) => args.includes(r.refKey));
      if (sql.includes("TokenRaceRate")) return [{ rate: 1 }];
      if (sql.includes("cardsEnabled")) return [{ cardsEnabled: 0 }];
      if (sql.includes("heroImageUrl")) return [{ heroImageUrl: null }];
      if (sql.includes("recapSeenRaceId")) return [{ recapSeenRaceId: null }];
      return [];
    }),
    $executeRawUnsafe: vi.fn(async () => 1),
  };
}

let prisma;
const build = (raceId) => buildRaceRecap(prisma, { raceId, driverId: ME, discordId: "disc1", req: {} });
beforeEach(() => {
  prisma = fakePrisma();
});

describe("a sprint weekend in the recap", () => {
  it("brings both races back, each with what it paid", async () => {
    const recap = await build(PARENT);
    expect(recap.you).toMatchObject({ position: 4, grid: 6, points: 25 });
    expect(recap.sprint.you).toMatchObject({ position: 3, grid: 5, points: 22 });
    // The sprint's own classification, not the feature's.
    expect(recap.sprint.results.map((r) => r.position)).toEqual([1, 3, 6]);
    expect(recap.sprint.race).toMatchObject({ id: CHILD, isSprint: true, number: 1, raceLaps: 8 });
  });

  it("shows the round's total as the two races that made it", async () => {
    const { weekend } = await build(PARENT);
    expect(weekend).toMatchObject({ isSprintWeekend: true, feature: 25, sprint: 22, total: 47 });
    expect(weekend.feature + weekend.sprint).toBe(weekend.total);
  });

  it("finds the NABS Tokens of both races and says which paid what", async () => {
    const { points } = await build(PARENT);
    expect(points.earned).toBe(20);
    expect(points.entries.map((e) => e.race)).toEqual(["Feature race", "Sprint"]);
    // One clean-race bonus still owed per race, not one for the weekend.
    expect(points.pending.map((p) => p.race)).toEqual(["Feature race", "Sprint"]);
  });

  it("gives the whole weekend when the sprint itself is asked for", async () => {
    const recap = await build(CHILD);
    expect(recap.race.id).toBe(PARENT);
    expect(recap.sprint.race.id).toBe(CHILD);
    expect(recap.you.points).toBe(25);
  });
});

describe("a round that ran one race", () => {
  it("has no sprint half and no weekend split", async () => {
    const { readSprintChildren } = await import("./sprintRaces.js");
    readSprintChildren.mockImplementationOnce(async () => new Map());
    const recap = await build(PARENT);
    expect(recap.sprint).toBe(null);
    // The cell still carries a sprint share in this fixture, so the split is
    // the standings' own; what changes is that there is no second race to show.
    expect(recap.weekend.total).toBe(47);
    const { points } = recap;
    expect(points.entries.every((e) => e.race === null)).toBe(true);
  });
});
