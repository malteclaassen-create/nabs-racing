import { describe, it, expect } from "vitest";
import { getDriverStandings } from "./standingsService.js";
import { applyManualPoints, parseManualPointsEntry } from "../lib/manualPoints.js";

// ---------------------------------------------------------------------------
// Points the league sets by hand (lib/manualPoints.js): a bonus or deduction
// on top of what the rounds pay, or a season total typed in whole. Scored end
// to end through getDriverStandings on an in-memory season, because the point
// of the feature is what the TABLE ends up saying — totals, order, and the
// movement arrows that must not invent a move out of an override.
// ---------------------------------------------------------------------------

const SEASON = "s1";
const TEAM = { id: "t1", seasonId: SEASON, name: "Alpha", color: "#f00", tier: 1, logoUrl: null };
const DRIVERS = [
  { id: "A", seasonId: SEASON, name: "Ann", teamId: "t1", tier: 1, isActive: true },
  { id: "B", seasonId: SEASON, name: "Ben", teamId: "t1", tier: 1, isActive: true },
  { id: "C", seasonId: SEASON, name: "Cid", teamId: "t1", tier: 1, isActive: true },
];
const RACES = [
  { id: "r1", seasonId: SEASON, number: 1, track: "Monza", isSpecialEvent: false, isCompleted: true },
  { id: "r2", seasonId: SEASON, number: 2, track: "Spa", isSpecialEvent: false, isCompleted: true },
];
const fin = (raceId, driverId, position) => ({
  raceId, driverId, position, status: "FINISHED", points: null, penaltySeconds: 0,
  grid: null, teamId: null, subForTeamId: null, totalTimeMs: null,
});
// R1: A 35, B 30, C 25. R2: A 35, B 30, C 25 -> A 70, B 60, C 50.
const RESULTS = [
  fin("r1", "A", 1), fin("r1", "B", 2), fin("r1", "C", 3),
  fin("r2", "A", 1), fin("r2", "B", 2), fin("r2", "C", 3),
];

// `manual` = { driverId: { pointsAdjust, pointsOverride } }, exactly the shape
// the raw column read returns.
function fakePrisma(manual = {}, { finalStandings = null } = {}) {
  return {
    driver: {
      findMany: async ({ where, include }) =>
        DRIVERS.filter((d) => d.seasonId === where.seasonId).map((d) => (include?.team ? { ...d, team: TEAM } : { ...d })),
    },
    team: { findMany: async () => [TEAM] },
    race: {
      findMany: async ({ where }) =>
        RACES.filter((r) => r.seasonId === where.seasonId && (where.isSpecialEvent === undefined || r.isSpecialEvent === where.isSpecialEvent)),
      findUnique: async ({ where }) => RACES.find((r) => r.id === where.id) || null,
    },
    raceResult: {
      findMany: async ({ where }) =>
        where?.raceId?.in ? RESULTS.filter((r) => where.raceId.in.includes(r.raceId)) : RESULTS,
    },
    season: {
      findUnique: async ({ where }) => ({
        id: where.id, number: 1, name: "Season 1", dropWorst: 0, pointsTable: null,
        finalStandings: finalStandings ? JSON.stringify(finalStandings) : null, seriesId: null,
      }),
    },
    $queryRaw: async () => {
      throw new Error("fake prisma: no raw tables");
    },
    $queryRawUnsafe: async (sql) => {
      if (sql.includes('"pointsAdjust"')) {
        return Object.entries(manual).map(([id, v]) => ({
          id,
          pointsAdjust: v.pointsAdjust ?? null,
          pointsOverride: v.pointsOverride ?? null,
        }));
      }
      // Everything else (person links, the season's raw columns, hidden rows)
      // is absent here and every reader of it falls back.
      throw new Error(`fake prisma: ${sql.slice(0, 40)}`);
    },
  };
}

const totalsOf = (table) => Object.fromEntries(table.standings.map((r) => [r.driverId, r.total]));

describe("manual points in the driver standings", () => {
  it("leaves a season nobody touched exactly as it was", async () => {
    const table = await getDriverStandings(fakePrisma(), SEASON);
    expect(totalsOf(table)).toEqual({ A: 70, B: 60, C: 50 });
    expect(table.manualPoints).toBe(false);
    expect(table.standings.every((r) => r.pointsAdjust === 0 && r.pointsOverride === null)).toBe(true);
  });

  it("adds a bonus to the computed total and re-ranks on it", async () => {
    const table = await getDriverStandings(fakePrisma({ C: { pointsAdjust: 25 } }), SEASON);
    expect(totalsOf(table)).toEqual({ A: 70, B: 60, C: 75 });
    expect(table.standings.map((r) => r.driverId)).toEqual(["C", "A", "B"]);
    expect(table.manualPoints).toBe(true);
    expect(table.standings.find((r) => r.driverId === "C").pointsAdjust).toBe(25);
  });

  it("takes a deduction off, and never below zero", async () => {
    const table = await getDriverStandings(fakePrisma({ A: { pointsAdjust: -10 }, C: { pointsAdjust: -999 } }), SEASON);
    expect(totalsOf(table)).toEqual({ A: 60, B: 60, C: 0 });
  });

  it("a hand-set total wins over the computed points and over the bonus", async () => {
    const table = await getDriverStandings(
      fakePrisma({ B: { pointsAdjust: 5, pointsOverride: 141 } }),
      SEASON
    );
    expect(totalsOf(table)).toEqual({ A: 70, B: 141, C: 50 });
    expect(table.standings.map((r) => r.driverId)).toEqual(["B", "A", "C"]);
    const b = table.standings.find((r) => r.driverId === "B");
    expect(b.pointsOverride).toBe(141);
    // The rounds keep paying what they paid — only the total was overruled.
    expect(b.perRace[1].points).toBe(30);
  });

  it("does not invent a movement arrow out of a hand-set total", async () => {
    // B leads only because of the override. That is just as true before the
    // last round, so the table shows no move.
    const table = await getDriverStandings(fakePrisma({ B: { pointsOverride: 200 } }), SEASON);
    const b = table.standings.find((r) => r.driverId === "B");
    expect(b.position).toBe(1);
    expect(b.prevPosition).toBe(1);
  });

  it("wins over an archived season's official final sheet", async () => {
    // The sheet says A 70, B 60, C 50 — and the league then adds C's bonus by
    // hand. An edit made today is never swallowed by the stored sheet.
    const sheet = { drivers: [{ driverId: "A", points: 70 }, { driverId: "B", points: 60 }, { driverId: "C", points: 50 }] };
    const table = await getDriverStandings(fakePrisma({ C: { pointsAdjust: 25 } }, { finalStandings: sheet }), SEASON);
    expect(totalsOf(table)).toEqual({ A: 70, B: 60, C: 75 });
    expect(table.standings.map((r) => r.driverId)).toEqual(["C", "A", "B"]);
    expect(table.officialTotals).toBe(true);
  });

  it("leaves the official sheet's own order alone when nothing was set by hand", async () => {
    // The sheet puts B first on equal points — its array order is the table.
    const sheet = { drivers: [{ driverId: "B", points: 70 }, { driverId: "A", points: 70 }, { driverId: "C", points: 50 }] };
    const table = await getDriverStandings(fakePrisma({}, { finalStandings: sheet }), SEASON);
    expect(table.standings.map((r) => r.driverId)).toEqual(["B", "A", "C"]);
  });

  it("stays out of a frozen mid-season view, like the official final sheet", async () => {
    const table = await getDriverStandings(fakePrisma({ C: { pointsOverride: 500 } }), SEASON, { upToRound: 1 });
    expect(totalsOf(table)).toEqual({ A: 35, B: 30, C: 25 });
    expect(table.manualPoints).toBe(false);
  });
});

describe("manual points: the values themselves", () => {
  it("an override replaces, an adjustment rides along, nothing set changes nothing", () => {
    expect(applyManualPoints(70, null)).toBe(70);
    expect(applyManualPoints(70, { adjust: 0, override: null })).toBe(70);
    expect(applyManualPoints(70, { adjust: 6, override: null })).toBe(76);
    expect(applyManualPoints(70, { adjust: 6, override: 0 })).toBe(0);
    expect(applyManualPoints(5, { adjust: -20, override: null })).toBe(0);
  });

  it("reads blanks as cleared and refuses what is not a whole number in range", () => {
    expect(parseManualPointsEntry({ adjust: "", override: null })).toEqual({ ok: true, value: { adjust: 0, override: null } });
    expect(parseManualPointsEntry({ adjust: -3, override: 141 })).toEqual({ ok: true, value: { adjust: -3, override: 141 } });
    expect(parseManualPointsEntry({ adjust: 1.5 }).error).toBeTruthy();
    expect(parseManualPointsEntry({ adjust: 5000 }).error).toBeTruthy();
    expect(parseManualPointsEntry({ override: -1 }).error).toBeTruthy();
  });
});
