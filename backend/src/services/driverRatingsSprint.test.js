import { describe, it, expect, vi, beforeEach } from "vitest";

// A sprint weekend is two races, and the sprint is raced for real. These tests
// pin that the rating formula READS it: the sprint's classification feeds
// racecraft like any other race, while the one signal it must not feed — the
// grid average behind PAC — stays on the feature races, because a sprint
// starts from a reversed or inherited grid (lib/standingsRow.js).
//
// Everything around the formula is stubbed (telemetry, admin weights, the
// career window); the race list, the results and the sprint link are real, so
// what is under test is exactly which classifications the maths reaches.
vi.mock("../lib/telemetryRead.js", () => ({ telemetryBySeason: vi.fn(async () => new Map()) }));
vi.mock("../lib/ratingWeights.js", () => ({ readRatingWeights: vi.fn(async () => null) }));
vi.mock("./careerRatingService.js", () => ({ getCareerInputs: vi.fn() }));

const { getDriverRatings } = await import("./driverRatingsService.js");
const { getCareerInputs } = await import("./careerRatingService.js");

const DRIVERS = ["a", "b", "c", "d"];
const team = (id) => ({ id: `t${id}`, name: `Team ${id}`, color: "#fff", tier: 1 });

// Identical career inputs for everyone: EXP and the career half of PAC are
// then a constant, so any difference between two runs comes from the races.
function flatCareer() {
  return new Map(
    DRIVERS.map((id) => [
      id,
      {
        starts: 3, roundStarts: 3, finishes: 3, finishRate: 1,
        activeSeasons: 1, windowSize: 1, champPct: 0.5,
        pace: {
          avgGridNorm: 0.5, nGrid: 3, avgLapGap: 0.01, nLap: 3,
          avgConsistency: 95, nCons: 3, avgPoleGap: null, nPole: 0,
        },
      },
    ])
  );
}

// Three rounds whose order rotates, so nobody is pinned at the top or bottom
// and the field can actually be reordered. Round 3 also ran a sprint, finishing
// d-c-b-a from a reversed grid — which is enough to lift d off the bottom of
// the season's finishing record and drop a onto it.
const ORDERS = {
  r1: ["a", "b", "c", "d"],
  r2: ["b", "c", "d", "a"],
  r3: ["c", "d", "a", "b"],
  r3s: ["d", "c", "b", "a"],
};
const ROUNDS = [
  { id: "r1", number: 1, track: "Spa", seasonId: "s1", isSpecialEvent: false, isCompleted: true },
  { id: "r2", number: 2, track: "Monza", seasonId: "s1", isSpecialEvent: false, isCompleted: true },
  { id: "r3", number: 3, track: "Imola", seasonId: "s1", isSpecialEvent: false, isCompleted: true },
];
const SPRINT = { id: "r3s", number: null, track: "Imola", seasonId: "s1", isSpecialEvent: true, isCompleted: true, parentRaceId: "r3" };

// Everyone starts where they finish, so the grid tells the same story as the
// result — which is what makes the sprint's reversed grid visible if it ever
// leaked into the pace average.
const resultsFor = (raceId) =>
  ORDERS[raceId].map((driverId, i) => ({
    raceId,
    driverId,
    status: "FINISHED",
    position: i + 1,
    grid: i + 1,
    bestLapMs: 90000 + i * 500,
    penaltySeconds: 0,
  }));

// `sprintOnFile` = the sprint's result has been imported. Everything else about
// the season is identical between the two worlds.
function fakePrisma({ sprintOnFile, sprintChildExists = sprintOnFile }) {
  const child = sprintChildExists ? [{ ...SPRINT, isCompleted: !!sprintOnFile }] : [];
  const races = [...ROUNDS, ...child];
  const results = [...ROUNDS.flatMap((r) => resultsFor(r.id)), ...(sprintOnFile ? resultsFor("r3s") : [])];
  return {
    season: { findUnique: async () => ({ id: "s1", number: 1 }) },
    driver: {
      findMany: async () => DRIVERS.map((id) => ({ id, name: id, tier: 1, seasonId: "s1", team: team(id) })),
    },
    race: {
      findMany: async ({ where }) => {
        if (where?.id?.in) return races.filter((r) => where.id.in.includes(r.id));
        return races.filter((r) => r.seasonId === where.seasonId && !r.isSpecialEvent && r.isCompleted);
      },
    },
    raceResult: { findMany: async () => results },
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('"parentRaceId" IN')) {
        return races
          .filter((r) => r.parentRaceId && args.includes(r.parentRaceId))
          .map((r) => ({ id: r.id, parentRaceId: r.parentRaceId }));
      }
      if (sql.includes('SUM(COALESCE(rr."contacts"')) return [];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

const byId = (rows) => new Map(rows.map((r) => [r.driverId, r]));
const run = (opts, world) => getDriverRatings(fakePrisma(world), "s1", opts).then(byId);

beforeEach(() => {
  getCareerInputs.mockReset();
  getCareerInputs.mockImplementation(async () => flatCareer());
});

describe("a sprint weekend's sprint feeds the rating", () => {
  it("counts as a race started, without becoming an extra round", async () => {
    const withSprint = await run({}, { sprintOnFile: true });
    const without = await run({}, { sprintOnFile: false });
    // Three rounds, four classifications for everyone.
    expect(without.get("a").starts).toBe(3);
    expect(withSprint.get("a").starts).toBe(4);
  });

  it("puts the sprint's result into the finishing record", async () => {
    const opts = { withComponents: true };
    const withSprint = await run(opts, { sprintOnFile: true });
    const without = await run(opts, { sprintOnFile: false });
    // d finishes last, third and second across the features (norm 0.667), then
    // wins the sprint — which is a quarter of their season, and shows.
    expect(without.get("d").raw.rac.avgFinishNorm).toBeCloseTo(0.667, 2);
    expect(withSprint.get("d").raw.rac.avgFinishNorm).toBeCloseTo(0.5, 2);
    // A sprint win is a podium like any other.
    expect(without.get("d").raw.rac.podiumRate).toBeCloseTo(0.667, 2);
    expect(withSprint.get("d").raw.rac.podiumRate).toBeCloseTo(0.75, 2);
  });

  it("moves racecraft toward what the sprint actually did", async () => {
    const withSprint = await run({}, { sprintOnFile: true });
    const without = await run({}, { sprintOnFile: false });
    // d wins the sprint and climbs off the bottom; a is last in it and lands there.
    expect(withSprint.get("d").ratings.rac).toBeGreaterThan(without.get("d").ratings.rac);
    expect(withSprint.get("a").ratings.rac).toBeLessThan(without.get("a").ratings.rac);
  });

  it("leaves the grid average alone — a sprint slot is not a qualifying result", async () => {
    const opts = { withComponents: true };
    const withSprint = await run(opts, { sprintOnFile: true });
    const without = await run(opts, { sprintOnFile: false });
    for (const id of DRIVERS) {
      expect(withSprint.get(id).raw.pac.avgGridNorm).toBe(without.get(id).raw.pac.avgGridNorm);
      expect(withSprint.get(id).components.pac.quali).toBe(without.get(id).components.pac.quali);
    }
  });

  it("ignores a sprint whose result is not on file yet", async () => {
    // The child race row exists (the weekend is known) but nothing was imported.
    const pending = await run({}, { sprintOnFile: false, sprintChildExists: true });
    expect(pending.get("a").starts).toBe(3);
  });
});
