import { describe, it, expect } from "vitest";
import { stampRacePointsTable, pointsTableOf, getDriverResultPoints, calculateT2ConstructorContributions } from "./pointsCalculator.js";
import { getDriverStandings, getT2ConstructorStandings, applyChampionOverride } from "./standingsService.js";
import { previewRaceImpact } from "./previewService.js";

// ---------------------------------------------------------------------------
// A round's own points table (Race.pointsTable) and the league-decided
// champion (Season.championDriverId), priced and applied through the same
// reads the services make against the real database.
// ---------------------------------------------------------------------------

const row = (raceId, driverId, position, extra = {}) => ({
  raceId, driverId, position, status: "FINISHED", points: null, penaltySeconds: 0, grid: null,
  teamId: null, subForTeamId: null, totalTimeMs: null, bestLapMs: null, ...extra,
});
const DOUBLE = [70, 60, 50];

describe("stampRacePointsTable + pricing", () => {
  it("prices derived points by the round's table, never explicit ones", () => {
    const rows = stampRacePointsTable([row("r1", "A", 1), row("r1", "B", 2, { points: 30 }), row("r1", "C", 4)], new Map([["r1", DOUBLE]]));
    expect(getDriverResultPoints(rows[0])).toBe(70);
    expect(getDriverResultPoints(rows[1])).toBe(30);
    expect(getDriverResultPoints(rows[2])).toBe(0); // beyond the round's table
  });

  it("adds the fastest-lap bonus on top, and prices the Tier-2 re-rank by it", () => {
    const rows = stampRacePointsTable([{ ...row("r1", "A", 2), fastestLapBonus: 1 }], new Map([["r1", DOUBLE]]));
    expect(getDriverResultPoints(rows[0])).toBe(61);
    const c = calculateT2ConstructorContributions(rows, [{ id: "A", teamId: "t" }], [{ id: "t", tier: 2 }]);
    expect(c[0].points).toBe(71); // re-ranked P1 by the round's table + 1
  });

  it("leaves rows alone without a table, and falls back to the season's", () => {
    const rows = [row("r1", "A", 1)];
    expect(stampRacePointsTable(rows, new Map([["r1", null]]))).toBe(rows);
    expect(stampRacePointsTable(rows, new Map())).toBe(rows);
    expect(pointsTableOf(rows[0], [9])).toEqual([9]);
  });
});

describe("applyChampionOverride", () => {
  const rows = () => [
    { driverId: "A", name: "Ann", position: 1, total: 100 },
    { driverId: "B", name: "Ben", position: 2, total: 90 },
    { driverId: "C", name: "Cal", position: 3, total: 50 },
  ];
  it("moves the decided champion to the top and renumbers", () => {
    const r = rows();
    expect(applyChampionOverride(r, "B")).toEqual({ driverId: "B", name: "Ben" });
    expect(r.map((x) => [x.driverId, x.position])).toEqual([["B", 1], ["A", 2], ["C", 3]]);
  });
  it("is nothing to report when the champion leads on points anyway, or is unknown", () => {
    expect(applyChampionOverride(rows(), "A")).toBeNull();
    expect(applyChampionOverride(rows(), "Z")).toBeNull();
    expect(applyChampionOverride(rows(), null)).toBeNull();
  });
});

// --- the season, end to end -------------------------------------------------
const SEASON = "s1";
const TEAMS = [
  { id: "t1", seasonId: SEASON, name: "Alpha", color: "#f00", tier: 1, logoUrl: null },
  { id: "t2", seasonId: SEASON, name: "Beta", color: "#0f0", tier: 2, logoUrl: null },
];
const DRIVERS = [
  { id: "A", seasonId: SEASON, name: "Ann", teamId: "t1", tier: 1, isActive: true },
  { id: "B", seasonId: SEASON, name: "Ben", teamId: "t2", tier: 2, isActive: true },
];
// r1 ordinary; r2 a sprint weekend on its own (doubled) table — the sprint
// child r2s uses its round's.
const RACES = [
  { id: "r1", seasonId: SEASON, number: 1, track: "Monza", isSpecialEvent: false, isCompleted: true, parentRaceId: null, raceFormat: "SINGLE", pointsTable: null },
  { id: "r2", seasonId: SEASON, number: 2, track: "Spa", isSpecialEvent: false, isCompleted: true, parentRaceId: null, raceFormat: "SPRINT_FEATURE", pointsTable: JSON.stringify(DOUBLE) },
  { id: "r2s", seasonId: SEASON, number: null, track: "Spa", isSpecialEvent: true, isCompleted: true, parentRaceId: "r2", raceFormat: "SINGLE", pointsTable: null },
];
const RESULTS = [
  row("r1", "A", 1), row("r1", "B", 2),
  row("r2", "B", 1), row("r2", "A", 2),
  row("r2s", "A", 1), row("r2s", "B", 2),
];

function fakePrisma({ champion = null } = {}) {
  const teamById = new Map(TEAMS.map((t) => [t.id, t]));
  const rowOf = (r) => ({ ...r });
  return {
    driver: {
      findMany: async ({ where, include }) =>
        DRIVERS.filter((d) => d.seasonId === where.seasonId).map((d) => (include?.team ? { ...d, team: teamById.get(d.teamId) } : { ...d })),
    },
    team: { findMany: async ({ where }) => TEAMS.filter((t) => t.seasonId === where.seasonId).map(rowOf) },
    race: {
      findMany: async ({ where }) =>
        RACES.filter((r) => r.seasonId === where.seasonId && (where.isSpecialEvent === undefined || r.isSpecialEvent === where.isSpecialEvent))
          .sort((a, b) => (a.number ?? 999) - (b.number ?? 999)).map(rowOf),
      findUnique: async ({ where }) => RACES.find((r) => r.id === where.id) || null,
    },
    raceResult: {
      findMany: async ({ where }) => {
        if (where?.raceId?.in) return RESULTS.filter((r) => where.raceId.in.includes(r.raceId)).map(rowOf);
        return RESULTS.map(rowOf);
      },
    },
    season: { findUnique: async ({ where }) => ({ id: where.id, number: 1, name: "Season 1", dropWorst: 0, pointsTable: null, finalStandings: null, seriesId: null }) },
    $queryRaw: async () => { throw new Error("fake prisma: no raw tables"); },
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('"championDriverId"')) return [{ teamDropWorst: null, teamDropMode: null, fastestLapPoints: 0, championDriverId: champion }];
      if (sql.includes('"parentRaceId" IS NOT NULL')) return RACES.filter((r) => r.parentRaceId && args.includes(r.id)).map((r) => ({ id: r.id, parentRaceId: r.parentRaceId }));
      if (sql.includes('"parentRaceId" IN')) return RACES.filter((r) => args.includes(r.parentRaceId)).map((r) => ({ id: r.id, parentRaceId: r.parentRaceId }));
      if (sql.includes('"raceFormat"')) return RACES.filter((r) => args.includes(r.id)).map((r) => ({ id: r.id, qualiMinutes: null, raceLaps: null, raceFormat: r.raceFormat, sprintLaps: null, pointsTable: r.pointsTable }));
      throw new Error(`fake prisma: ${sql.slice(0, 60)}`);
    },
  };
}

describe("a round on its own points table", () => {
  it("pays the round by that table, sprint included, and names it", async () => {
    const table = await getDriverStandings(fakePrisma(), SEASON);
    expect(table.customPoints).toEqual({ 2: DOUBLE });
    const totals = Object.fromEntries(table.standings.map((r) => [r.driverId, r.total]));
    // A: 35 + (60 + 70) = 165; B: 30 + (70 + 60) = 160.
    expect(totals).toEqual({ A: 165, B: 160 });
    expect(table.standings.find((r) => r.driverId === "A").perRace[2]).toEqual({
      points: 130, status: "FINISHED", position: 2, grid: null, sprint: { points: 70, status: "FINISHED", position: 1 },
    });
  });

  it("the Tier-2 table re-ranks by the round's table too", async () => {
    const t2 = await getT2ConstructorStandings(fakePrisma(), SEASON);
    expect(t2.standings.find((r) => r.teamId === "t2").perRace).toEqual({ 1: 35, 2: 140 });
  });

  it("the admin preview prices a proposal for that round the same way", async () => {
    const proposal = [
      { driverId: "B", position: 1, status: "FINISHED", penaltySeconds: 0 },
      { driverId: "A", position: 2, status: "FINISHED", penaltySeconds: 0 },
    ];
    const p = await previewRaceImpact(fakePrisma(), { seasonId: SEASON, raceId: "r2", results: proposal });
    expect(Object.fromEntries(p.round.map((r) => [r.driverId, r.points]))).toEqual({ B: 70, A: 60 });
  });
});

describe("a champion decided by the league", () => {
  it("puts that driver first in the final table and says so", async () => {
    const table = await getDriverStandings(fakePrisma({ champion: "B" }), SEASON);
    expect(table.championOverride).toEqual({ driverId: "B", name: "Ben" });
    expect(table.standings.map((r) => [r.driverId, r.position, r.total])).toEqual([["B", 1, 160], ["A", 2, 165]]);
  });

  it("does not touch a mid-season view", async () => {
    const table = await getDriverStandings(fakePrisma({ champion: "B" }), SEASON, { upToRound: 1 });
    expect(table.championOverride).toBeNull();
    expect(table.standings[0].driverId).toBe("A");
  });
});
