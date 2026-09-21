import { describe, it, expect, vi, beforeEach } from "vitest";

// EXP's two halves treat a sprint weekend differently on purpose:
//
//   * the MILEAGE block ("60 starts = full") counts race WEEKENDS, because its
//     scale was set when a season's rounds and its races were the same number;
//   * the finish RATE counts classifications, where both sides of the ratio
//     agree, and PAC's lap and consistency signals read every race driven.
//
// The standings behind the championship half are stubbed — what is under test
// is which classifications the window reads and how it counts them.
vi.mock("./standingsService.js", () => ({
  getDriverStandings: vi.fn(async () => ({ standings: [] })),
  getT1ConstructorStandings: vi.fn(async () => ({ standings: [] })),
  getT2ConstructorStandings: vi.fn(async () => ({ standings: [] })),
}));
vi.mock("../lib/persons.js", () => ({
  getPersonGroups: vi.fn(async () => ({ byDriver: new Map(), byPerson: new Map() })),
}));

const { getCareerInputs } = await import("./careerRatingService.js");

// One finished season: two rounds, the second run as a sprint weekend.
const ROUNDS = [
  { id: "r1", number: 1, seasonId: "s1", isSpecialEvent: false, isCompleted: true },
  { id: "r2", number: 2, seasonId: "s1", isSpecialEvent: false, isCompleted: true },
];
const SPRINT = { id: "r2s", number: null, seasonId: "s1", isSpecialEvent: true, isCompleted: true, parentRaceId: "r2" };

const CFG = {
  window: { seasons: 7, recency: [1] },
  exp: {
    split: { drivers: 60, constructors: 40 },
    driverCurve: [1],
    constructors: { preTier: [1], tier1: {}, tier2: {} },
  },
};

// `retireSprint` = the driver parked the sprint, so the classifications split
// two finishes from three starts while the weekends stay two.
function fakePrisma({ retireSprint = false } = {}) {
  const races = [...ROUNDS, SPRINT];
  // "b" is only here to give every race a field: a grid slot means nothing
  // against a one-car entry list (raceMeta wants gridSize > 1).
  const results = [
    { driverId: "a", raceId: "r1", status: "FINISHED", position: 1, grid: 1, bestLapMs: 90000, race: { seasonId: "s1" } },
    { driverId: "a", raceId: "r2", status: "FINISHED", position: 2, grid: 2, bestLapMs: 90500, race: { seasonId: "s1" } },
    {
      driverId: "a", raceId: "r2s", grid: 8, bestLapMs: 91000, race: { seasonId: "s1" },
      status: retireSprint ? "DNF" : "FINISHED",
      position: retireSprint ? null : 1,
    },
    { driverId: "b", raceId: "r1", status: "FINISHED", position: 2, grid: 2, bestLapMs: 90200, race: { seasonId: "s1" } },
    { driverId: "b", raceId: "r2", status: "FINISHED", position: 1, grid: 1, bestLapMs: 90100, race: { seasonId: "s1" } },
    { driverId: "b", raceId: "r2s", status: "FINISHED", position: 2, grid: 1, bestLapMs: 90900, race: { seasonId: "s1" } },
  ];
  return {
    race: { findMany: async ({ where }) => (where?.id?.in ? races.filter((r) => where.id.in.includes(r.id)) : ROUNDS) },
    driver: {
      findMany: async () => [
        { id: "a", seasonId: "s1", teamId: "t1" },
        { id: "b", seasonId: "s1", teamId: "t2" },
      ],
    },
    raceResult: {
      findMany: async ({ where }) =>
        where?.raceId?.in ? results.filter((r) => where.raceId.in.includes(r.raceId)) : results,
    },
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('"parentRaceId" IN')) {
        return races.filter((r) => r.parentRaceId && args.includes(r.parentRaceId)).map((r) => ({ id: r.id, parentRaceId: r.parentRaceId }));
      }
      if (sql.includes('FROM "Season"')) return [{ id: "s1", number: 1, champ: 2, open: 0 }];
      if (sql.includes("consistencyPct")) return [];
      if (sql.includes("qualiTimeMs")) return [];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

const inputsFor = async (world) => {
  const out = await getCareerInputs(fakePrisma(world), { id: "s1", number: 1 }, [{ id: "a" }, { id: "b" }], CFG);
  return out.get("a");
};

beforeEach(() => vi.clearAllMocks());

describe("the career window and a sprint weekend", () => {
  it("counts the sprint as a race, but the weekend as one start", async () => {
    const cw = await inputsFor();
    // Two race nights, three classifications driven.
    expect(cw.roundStarts).toBe(2);
    expect(cw.starts).toBe(3);
  });

  it("keeps the finish rate on classifications, both sides of the ratio", async () => {
    const cw = await inputsFor({ retireSprint: true });
    expect(cw.starts).toBe(3);
    expect(cw.finishes).toBe(2);
    expect(cw.finishRate).toBeCloseTo(2 / 3, 5);
    // The retirement does not cost a weekend of mileage.
    expect(cw.roundStarts).toBe(2);
  });

  it("reads the sprint's lap but not its grid", async () => {
    const cw = await inputsFor();
    // Three best laps, two grid slots: the sprint's slot 8 is reversed or
    // inherited and would wreck an average that means "where do you qualify".
    expect(cw.pace.nLap).toBe(3);
    expect(cw.pace.nGrid).toBe(2);
  });
});
