import { describe, it, expect } from "vitest";
import { getDriverStandings } from "./standingsService.js";

// ---------------------------------------------------------------------------
// asOfRound: the driver table as the standings page showed it the night a
// round's result went in. The news desk's race report reads it, so "X leads
// by Y" is what the table said that night. The point of it is the drop rule:
// with rounds still to run, those count as 0 and take the drops, so no REAL
// result is dropped yet — unlike upToRound, which ends the season at that
// round and drops the worst real results at once.
// ---------------------------------------------------------------------------

const SEASON = "s1";
const TEAM = { id: "t1", seasonId: SEASON, name: "Alpha", color: "#f00", tier: 1, logoUrl: null };
const DRIVERS = [
  { id: "A", seasonId: SEASON, name: "Ann", teamId: "t1", tier: 1, isActive: true },
  { id: "B", seasonId: SEASON, name: "Ben", teamId: "t1", tier: 1, isActive: true },
];
// Four rounds, three run.
const RACES = [1, 2, 3, 4].map((n) => ({
  id: `r${n}`, seasonId: SEASON, number: n, track: `T${n}`, isSpecialEvent: false, isCompleted: n <= 3,
}));
const fin = (raceId, driverId, position) => ({
  raceId, driverId, position, status: "FINISHED", points: null, penaltySeconds: 0,
  grid: null, teamId: null, subForTeamId: null, totalTimeMs: null,
});
// R1: A 35, B 30. R2: B 35, A 30. R3: A 35, B 30.
const RESULTS = [
  fin("r1", "A", 1), fin("r1", "B", 2),
  fin("r2", "B", 1), fin("r2", "A", 2),
  fin("r3", "A", 1), fin("r3", "B", 2),
];

function fakePrisma({ dropWorst = 1 } = {}) {
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
        id: where.id, number: 1, name: "Season 1", dropWorst, pointsTable: null, finalStandings: null, seriesId: null,
      }),
    },
    $queryRaw: async () => {
      throw new Error("fake prisma: no raw tables");
    },
    $queryRawUnsafe: async (sql) => {
      throw new Error(`fake prisma: ${sql.slice(0, 40)}`);
    },
  };
}

const totalsOf = (table) => Object.fromEntries(table.standings.map((r) => [r.driverId, r.total]));

describe("driver standings as of a round", () => {
  it("reads like the page did that night: later rounds take the drops, every real result counts", async () => {
    const table = await getDriverStandings(fakePrisma(), SEASON, { asOfRound: 2 });
    expect(totalsOf(table)).toEqual({ A: 65, B: 65 });
    // Unlike upToRound, which ends the season at round 2 and drops a real result.
    const cut = await getDriverStandings(fakePrisma(), SEASON, { upToRound: 2 });
    expect(totalsOf(cut)).toEqual({ A: 35, B: 35 });
  });

  it("leaves out the results after the round, and only those", async () => {
    const table = await getDriverStandings(fakePrisma(), SEASON, { asOfRound: 2 });
    const a = table.standings.find((r) => r.driverId === "A");
    expect(a.perRace[3]?.points ?? 0).toBe(0);
    expect(a.perRace[2].points).toBe(30);
  });

  it("as of the latest round run is the season's own table", async () => {
    const asOf = await getDriverStandings(fakePrisma(), SEASON, { asOfRound: 3 });
    const page = await getDriverStandings(fakePrisma(), SEASON);
    expect(totalsOf(asOf)).toEqual(totalsOf(page));
    expect(totalsOf(page)).toEqual({ A: 100, B: 95 });
  });
});
