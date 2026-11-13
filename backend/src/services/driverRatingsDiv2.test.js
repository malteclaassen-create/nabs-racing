import { describe, it, expect, vi, beforeEach } from "vitest";

// Division 2 feeds the rating, worth less than Division 1 (driverRatingsService
// header). These tests pin the three promises made to the league: a Division 2
// driver gets a rating that moves, a Division 2 result counts at its share
// (half by default), and nothing in Division 1 moves because Division 2 is
// there.
//
// Same stubbing as driverRatingsSprint.test.js: telemetry, saved weights and
// the career window are flat, the race list, the results and the Division 2
// link are real.
vi.mock("../lib/telemetryRead.js", () => ({ telemetryBySeason: vi.fn(async () => new Map()) }));
vi.mock("../lib/ratingWeights.js", () => ({ readRatingWeights: vi.fn(async () => null) }));
vi.mock("./careerRatingService.js", () => ({ getCareerInputs: vi.fn() }));
vi.mock("../lib/divisions.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, activeDivision2Drivers: vi.fn(async () => new Set(["x", "y"])) };
});

const { getDriverRatings } = await import("./driverRatingsService.js");
const { getCareerInputs } = await import("./careerRatingService.js");

const FIRST = ["a", "b", "c", "d"];
const SECOND = ["x", "y"];

function flatCareer() {
  return new Map(
    [...FIRST, ...SECOND].map((id) => [
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

const ORDERS = {
  r1: ["a", "b", "c", "d"],
  r2: ["b", "c", "d", "a"],
  r3: ["c", "d", "a", "b"],
  // Division 2's race of round 3: x wins, y second.
  r3d: ["x", "y"],
};
const ROUNDS = [
  { id: "r1", number: 1, track: "Spa", seasonId: "s1", isSpecialEvent: false, isCompleted: true },
  { id: "r2", number: 2, track: "Monza", seasonId: "s1", isSpecialEvent: false, isCompleted: true },
  { id: "r3", number: 3, track: "Imola", seasonId: "s1", isSpecialEvent: false, isCompleted: true },
];
const DIV2 = { id: "r3d", number: null, track: "Imola", seasonId: "s1", isSpecialEvent: true, isCompleted: true, parentRaceId: "r3", division: 2 };

const resultsFor = (raceId) =>
  ORDERS[raceId].map((driverId, i) => ({
    raceId,
    driverId,
    status: "FINISHED",
    position: i + 1,
    grid: i + 1,
    // Division 2 is a second slower than the main field's pole lap.
    bestLapMs: (raceId === "r3d" ? 91000 : 90000) + i * 500,
    penaltySeconds: 0,
  }));

function fakePrisma({ div2OnFile }) {
  const races = [...ROUNDS, ...(div2OnFile ? [DIV2] : [])];
  const results = [...ROUNDS.flatMap((r) => resultsFor(r.id)), ...(div2OnFile ? resultsFor("r3d") : [])];
  const team = (id, tier) => ({ id: `t${id}`, name: `Team ${id}`, color: "#fff", tier });
  return {
    season: { findUnique: async () => ({ id: "s1", number: 1 }) },
    driver: {
      findMany: async () => [
        ...FIRST.map((id) => ({ id, name: id, tier: 1, seasonId: "s1", team: team(id, 1) })),
        ...SECOND.map((id) => ({ id, name: id, tier: 3, seasonId: "s1", team: team(id, 3) })),
      ],
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
        const wantDiv2 = sql.includes('"division" = 2');
        return races
          .filter((r) => r.parentRaceId && args.includes(r.parentRaceId))
          .filter((r) => (r.division === 2) === wantDiv2)
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

describe("Division 2 in the rating", () => {
  it("gives its drivers a rating, marked as Division 2", async () => {
    const rows = await run({}, { div2OnFile: true });
    expect(rows.get("x").division).toBe(2);
    expect(rows.get("x").starts).toBe(1);
    expect(rows.get("a").division).toBe(1);
  });

  it("moves no Division 1 rating", async () => {
    const opts = { withComponents: true };
    const withDiv2 = await run(opts, { div2OnFile: true });
    const without = await run(opts, { div2OnFile: false });
    for (const id of FIRST) {
      expect(withDiv2.get(id).ratings).toEqual(without.get(id).ratings);
      expect(withDiv2.get(id).components).toEqual(without.get(id).components);
    }
  });

  it("counts a Division 2 win at half: like the middle of the main field", async () => {
    const rows = await run({ withComponents: true }, { div2OnFile: true });
    expect(rows.get("x").raw.rac.avgFinishNorm).toBeCloseTo(0.5, 3);
    expect(rows.get("x").raw.rac.podiumRate).toBeCloseTo(0.5, 3);
    // Last stays last.
    expect(rows.get("y").raw.rac.avgFinishNorm).toBeCloseTo(1, 3);
  });

  it("the admin's share sets what it is worth", async () => {
    const full = await run({ withComponents: true, division2: { weight: 100 } }, { div2OnFile: true });
    expect(full.get("x").raw.rac.avgFinishNorm).toBeCloseTo(0, 3);
    const none = await run({ withComponents: true, division2: { weight: 0 } }, { div2OnFile: true });
    expect(none.get("x").raw.rac.avgFinishNorm).toBeCloseTo(1, 3);
    expect(none.get("x").raw.rac.podiumRate).toBeCloseTo(0, 3);
  });

  it("a Division 2 winner rates below a Division 1 winner but above Division 2's last", async () => {
    const rows = await run({}, { div2OnFile: true });
    expect(rows.get("x").ratings.rac).toBeGreaterThan(rows.get("y").ratings.rac);
    // c won a round in Division 1 and is never worse than fourth.
    expect(rows.get("x").ratings.rac).toBeLessThan(rows.get("c").ratings.rac);
  });
});
