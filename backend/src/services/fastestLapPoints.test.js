import { describe, it, expect } from "vitest";
import {
  stampFastestLapBonus,
  fastestLapBonusOf,
  getDriverResultPoints,
  calculateT2ConstructorContributions,
} from "./pointsCalculator.js";
import { getDriverStandings, getT1ConstructorStandings, getT2ConstructorStandings } from "./standingsService.js";
import { previewRaceImpact } from "./previewService.js";

// ---------------------------------------------------------------------------
// The fastest-lap bonus (Season.fastestLapPoints): one extra point (or more)
// for the classified finisher who set the race's best lap, on top of the
// finishing points. Pure pricing first, then the season scored end to end
// through the same reads the services make.
// ---------------------------------------------------------------------------

const row = (raceId, driverId, position, bestLapMs, extra = {}) => ({
  raceId, driverId, position, status: "FINISHED", points: null, penaltySeconds: 0, grid: null,
  teamId: null, subForTeamId: null, totalTimeMs: null, bestLapMs, ...extra,
});

describe("stampFastestLapBonus", () => {
  it("stamps the holder of the best lap in each classification", () => {
    const rows = [row("r1", "A", 1, 91_000), row("r1", "B", 2, 90_000), row("r2", "A", 1, 88_000), row("r2", "B", 2, 89_000)];
    const out = stampFastestLapBonus(rows, 1);
    expect(out.map((r) => r.fastestLapBonus ?? 0)).toEqual([0, 1, 1, 0]);
  });

  it("is a no-op without a bonus, and leaves the rows unstamped when nobody has a lap", () => {
    const rows = [row("r1", "A", 1, 91_000)];
    expect(stampFastestLapBonus(rows, 0)).toBe(rows);
    expect(stampFastestLapBonus([row("r1", "A", 1, null)], 1)[0].fastestLapBonus).toBeUndefined();
  });

  it("lets an admin-recorded holder win over the lap times", () => {
    const rows = [row("r1", "A", 1, 91_000), row("r1", "B", 2, 90_000)];
    const out = stampFastestLapBonus(rows, 1, new Map([["r1", "A"]]));
    expect(out.find((r) => r.driverId === "A").fastestLapBonus).toBe(1);
    expect(out.find((r) => r.driverId === "B").fastestLapBonus).toBeUndefined();
  });

  it("ignores sentinel laps", () => {
    const out = stampFastestLapBonus([row("r1", "A", 1, 999_999_999), row("r1", "B", 2, 90_000)], 1);
    expect(out.find((r) => r.driverId === "B").fastestLapBonus).toBe(1);
  });
});

describe("pricing a stamped result", () => {
  it("adds the bonus to derived points for a classified finisher", () => {
    expect(getDriverResultPoints({ ...row("r1", "A", 3, 90_000), fastestLapBonus: 1 })).toBe(26);
    expect(fastestLapBonusOf({ ...row("r1", "A", 3, 90_000), fastestLapBonus: 2 })).toBe(2);
  });

  it("pays nothing to a car that set the lap but did not finish", () => {
    const dnf = { ...row("r1", "A", null, 90_000), status: "DNF", fastestLapBonus: 1 };
    expect(getDriverResultPoints(dnf)).toBe(0);
    expect(fastestLapBonusOf(dnf)).toBe(0);
  });

  it("never adds to explicit (official) points", () => {
    const official = { ...row("r1", "A", 3, 90_000), points: 25, fastestLapBonus: 1 };
    expect(getDriverResultPoints(official)).toBe(25);
  });

  it("rides on top of the Tier-2 re-rank", () => {
    const teams = [{ id: "t1", tier: 1 }, { id: "t2", tier: 2 }];
    const drivers = [{ id: "A", teamId: "t1" }, { id: "B", teamId: "t2" }];
    const rows = [row("r1", "A", 1, 91_000), { ...row("r1", "B", 2, 90_000), fastestLapBonus: 1 }];
    const c = calculateT2ConstructorContributions(rows, drivers, teams);
    expect(c).toEqual([{ driverId: "B", teamId: "t2", points: 36 }]); // re-ranked P1 (35) + 1
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
  { id: "C", seasonId: SEASON, name: "Cal", teamId: "t2", tier: 2, isActive: true },
];
const RACES = [
  { id: "r1", seasonId: SEASON, number: 1, track: "Monza", isSpecialEvent: false, isCompleted: true, parentRaceId: null, raceFormat: "SINGLE" },
  { id: "r2", seasonId: SEASON, number: 2, track: "Spa", isSpecialEvent: false, isCompleted: true, parentRaceId: null, raceFormat: "SPRINT_FEATURE" },
  { id: "r2s", seasonId: SEASON, number: null, track: "Spa", isSpecialEvent: true, isCompleted: true, parentRaceId: "r2", raceFormat: "SINGLE" },
];
const RESULTS = [
  // Round 1: A wins, B second, C retired — but C set the round's best lap, so
  // the bonus is C's and C is not classified: nobody collects it.
  row("r1", "A", 1, 91_000), row("r1", "B", 2, 90_000), { ...row("r1", "C", null, 89_000), status: "DNF" },
  // Round 2 feature: B wins with the lap, A second, C third.
  row("r2", "B", 1, 88_000), row("r2", "A", 2, 88_500), row("r2", "C", 3, 89_000),
  // Round 2 sprint: A wins, C second with the lap, B third.
  row("r2s", "A", 1, 87_500), row("r2s", "C", 2, 87_000), row("r2s", "B", 3, 88_000),
];

function fakePrisma({ fastestLapPoints = 1, manualFl = [] } = {}) {
  const teamById = new Map(TEAMS.map((t) => [t.id, t]));
  const rowOf = (r) => ({ ...r });
  return {
    driver: {
      findMany: async ({ where, include }) =>
        DRIVERS.filter((d) => d.seasonId === where.seasonId).map((d) =>
          include?.team ? { ...d, team: teamById.get(d.teamId) } : { ...d }
        ),
    },
    team: { findMany: async ({ where }) => TEAMS.filter((t) => t.seasonId === where.seasonId).map(rowOf) },
    race: {
      findMany: async ({ where }) =>
        RACES.filter(
          (r) => r.seasonId === where.seasonId && (where.isSpecialEvent === undefined || r.isSpecialEvent === where.isSpecialEvent)
        )
          .sort((a, b) => (a.number ?? 999) - (b.number ?? 999))
          .map(rowOf),
      findUnique: async ({ where }) => RACES.find((r) => r.id === where.id) || null,
    },
    raceResult: {
      findMany: async ({ where }) => {
        if (where?.raceId?.in) return RESULTS.filter((r) => where.raceId.in.includes(r.raceId)).map(rowOf);
        if (where?.race?.seasonId) return RESULTS.map(rowOf);
        return RESULTS.map(rowOf);
      },
    },
    season: {
      findUnique: async ({ where }) => ({ id: where.id, number: 1, name: "Season 1", dropWorst: 0, pointsTable: null, finalStandings: null, seriesId: null }),
    },
    $queryRaw: async () => { throw new Error("fake prisma: no raw tables"); },
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('"fastestLapPoints"')) return [{ teamDropWorst: null, teamDropMode: null, fastestLapPoints }];
      if (sql.includes('"fastestLap" = 1')) return manualFl.filter((m) => args.includes(m.raceId));
      if (sql.includes('"parentRaceId" IS NOT NULL')) {
        return RACES.filter((r) => r.parentRaceId && args.includes(r.id)).map((r) => ({ id: r.id, parentRaceId: r.parentRaceId }));
      }
      if (sql.includes('"parentRaceId" IN')) {
        return RACES.filter((r) => args.includes(r.parentRaceId)).map((r) => ({ id: r.id, parentRaceId: r.parentRaceId }));
      }
      if (sql.includes('"raceFormat"')) {
        return RACES.filter((r) => args.includes(r.id)).map((r) => ({ id: r.id, qualiMinutes: null, raceLaps: null, raceFormat: r.raceFormat, sprintLaps: null }));
      }
      throw new Error(`fake prisma: ${sql.slice(0, 60)}`);
    },
  };
}

describe("driver standings with a fastest-lap bonus", () => {
  it("pays the bonus per classification, to classified finishers only", async () => {
    const table = await getDriverStandings(fakePrisma(), SEASON);
    expect(table.fastestLapPoints).toBe(1);
    const rows = Object.fromEntries(table.standings.map((r) => [r.driverId, r]));
    // A: 35 + (30 + 35) = 100, never the fastest.
    // B: 30 (C's lap, unpaid, is not passed down) + (35 + 1) + 25 = 91.
    // C: 0 (DNF, the round's best lap pays nothing) + 25 + (30 + 1) = 56.
    expect(rows.A.total).toBe(100);
    expect(rows.B.total).toBe(91);
    expect(rows.C.total).toBe(56);
    expect(rows.B.perRace[1]).toEqual({ points: 30, status: "FINISHED", position: 2, grid: null });
    expect(rows.B.perRace[2]).toEqual({
      points: 61, status: "FINISHED", position: 1, grid: null, fastestLap: 1,
      sprint: { points: 25, status: "FINISHED", position: 3 },
    });
    expect(rows.A.perRace[1]).toEqual({ points: 35, status: "FINISHED", position: 1, grid: null });
    expect(rows.C.perRace[1]).toEqual({ points: 0, status: "DNF", position: null, grid: null });
    // The sprint's own bonus is named on the sprint half of the cell.
    expect(rows.C.perRace[2]).toEqual({
      points: 56, status: "FINISHED", position: 3, grid: null,
      sprint: { points: 31, status: "FINISHED", position: 2, fastestLap: 1 },
    });
  });

  it("a season without the bonus scores exactly as before", async () => {
    const table = await getDriverStandings(fakePrisma({ fastestLapPoints: 0 }), SEASON);
    expect(table.fastestLapPoints).toBe(0);
    const totals = Object.fromEntries(table.standings.map((r) => [r.driverId, r.total]));
    expect(totals).toEqual({ A: 100, B: 90, C: 55 });
    expect(table.standings.find((r) => r.driverId === "B").perRace[2].fastestLap).toBeUndefined();
  });

  it("an admin-recorded holder decides the round over its lap times", async () => {
    const table = await getDriverStandings(fakePrisma({ manualFl: [{ raceId: "r1", driverId: "A" }] }), SEASON);
    const rows = Object.fromEntries(table.standings.map((r) => [r.driverId, r]));
    expect(rows.A.perRace[1].points).toBe(36);
    expect(rows.B.perRace[1].points).toBe(30);
  });
});

describe("constructor standings with a fastest-lap bonus", () => {
  it("Tier 1 adds the driver's bonus to the team's round", async () => {
    const t1 = await getT1ConstructorStandings(fakePrisma(), SEASON);
    expect(t1.standings.find((r) => r.teamId === "t1").perRace).toEqual({ 1: 35, 2: 65 });
  });

  it("Tier 2 pays it on top of the re-rank", async () => {
    const t2 = await getT2ConstructorStandings(fakePrisma(), SEASON);
    // R1: B re-ranked P1 35 (C, DNF, holds no slot and its lap pays nobody).
    // R2 feature: B 35 + 1, C 30; sprint: C 35 + 1, B 30 → 132.
    expect(t2.standings.find((r) => r.teamId === "t2").perRace).toEqual({ 1: 35, 2: 132 });
  });
});

describe("admin preview with a fastest-lap bonus", () => {
  it("prices the proposal's own best lap and keeps the stored rounds' bonus", async () => {
    // A new round 3: C wins, A second with the lap, B third.
    const proposal = [
      { driverId: "C", position: 1, status: "FINISHED", penaltySeconds: 0, bestLapMs: 90_000 },
      { driverId: "A", position: 2, status: "FINISHED", penaltySeconds: 0, bestLapMs: 89_000 },
      { driverId: "B", position: 3, status: "FINISHED", penaltySeconds: 0, bestLapMs: 91_000 },
    ];
    const p = await previewRaceImpact(fakePrisma(), { seasonId: SEASON, number: 3, results: proposal });
    const round = Object.fromEntries(p.round.map((r) => [r.driverId, r]));
    expect(round.A.points).toBe(31);
    expect(round.A.fastestLap).toBe(1);
    expect(round.C.points).toBe(35);
    expect(round.C.fastestLap).toBe(0);
    const totals = Object.fromEntries(p.drivers.map((r) => [r.driverId, r.total]));
    expect(totals).toEqual({ A: 131, B: 116, C: 91 });
  });
});
