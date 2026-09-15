import { describe, it, expect } from "vitest";
import { getDriverStandings, getT1ConstructorStandings, getT2ConstructorStandings } from "./standingsService.js";
import { previewRaceImpact } from "./previewService.js";

// ---------------------------------------------------------------------------
// A sprint+feature weekend scored end to end, through the same reads the
// services make against the real database, on an in-memory season.
//
// The sprint classification is a hidden child row of its event (isSpecialEvent,
// no round number, parentRaceId set — lib/sprintRaces.js). Everything that
// counts rounds must keep not seeing it; everything that scores must find it
// through the parent link and add it to the weekend's round. A training
// session sits in the season too, to prove the link is what lets a sprint in
// and not the flag being ignored.
// ---------------------------------------------------------------------------

const SEASON = "s1";

const TEAMS = [
  { id: "t1", seasonId: SEASON, name: "Alpha", color: "#f00", tier: 1, logoUrl: null },
  { id: "t2a", seasonId: SEASON, name: "Beta", color: "#0f0", tier: 2, logoUrl: null },
  { id: "t2b", seasonId: SEASON, name: "Gamma", color: "#00f", tier: 2, logoUrl: null },
];
const DRIVERS = [
  { id: "A", seasonId: SEASON, name: "Ann", teamId: "t1", tier: 1, isActive: true },
  { id: "B", seasonId: SEASON, name: "Ben", teamId: "t1", tier: 1, isActive: true },
  { id: "X", seasonId: SEASON, name: "Xen", teamId: "t2a", tier: 2, isActive: true },
  { id: "Y", seasonId: SEASON, name: "Yve", teamId: "t2b", tier: 2, isActive: true },
];
// r1: plain round. r2: sprint weekend — r2 the feature, r2s its sprint child.
// tr: a training session (flagged like the child, but with no parent).
const RACES = [
  { id: "r1", seasonId: SEASON, number: 1, track: "Monza", isSpecialEvent: false, isCompleted: true, parentRaceId: null, raceFormat: "SINGLE" },
  { id: "r2", seasonId: SEASON, number: 2, track: "Spa", isSpecialEvent: false, isCompleted: true, parentRaceId: null, raceFormat: "SPRINT_FEATURE" },
  { id: "r2s", seasonId: SEASON, number: null, track: "Spa", isSpecialEvent: true, isCompleted: true, parentRaceId: "r2", raceFormat: "SINGLE" },
  { id: "tr", seasonId: SEASON, number: null, track: "Imola", isSpecialEvent: true, isCompleted: true, parentRaceId: null, raceFormat: "SINGLE" },
];
const fin = (raceId, driverId, position, status = "FINISHED") => ({
  raceId, driverId, position, status, points: null, penaltySeconds: 0, grid: null, teamId: null, subForTeamId: null, totalTimeMs: null,
});
const RESULTS = [
  // Round 1: A 35, X 30, Y 25, B 22.
  fin("r1", "A", 1), fin("r1", "X", 2), fin("r1", "Y", 3), fin("r1", "B", 4),
  // Round 2 feature: X 35, A 30, Y 25, B 22.
  fin("r2", "X", 1), fin("r2", "A", 2), fin("r2", "Y", 3), fin("r2", "B", 4),
  // Round 2 sprint: Y 35, X 30, B 25, A DNF.
  fin("r2s", "Y", 1), fin("r2s", "X", 2), fin("r2s", "B", 3), fin("r2s", "A", null, "DNF"),
  // The training: would hand A 35 more if it leaked in.
  fin("tr", "A", 1),
];

function fakePrisma({ dropWorst = 0, results = RESULTS } = {}) {
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
        if (where?.raceId?.in) return results.filter((r) => where.raceId.in.includes(r.raceId)).map(rowOf);
        if (where?.race?.seasonId) {
          const ids = new Set(RACES.filter((r) => r.seasonId === where.race.seasonId).map((r) => r.id));
          return results.filter((r) => ids.has(r.raceId)).map(rowOf);
        }
        return results.map(rowOf);
      },
    },
    season: {
      findUnique: async ({ where }) => ({ id: where.id, number: 1, name: "Season 1", dropWorst, pointsTable: null, finalStandings: null, seriesId: null }),
    },
    // The tables the person links and the raw season columns live in do not
    // exist here; every reader of them catches and falls back.
    $queryRaw: async () => {
      throw new Error("fake prisma: no raw tables");
    },
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('"parentRaceId" IS NOT NULL')) {
        return RACES.filter((r) => r.parentRaceId && args.includes(r.id)).map((r) => ({ id: r.id, parentRaceId: r.parentRaceId }));
      }
      if (sql.includes('"parentRaceId" IN')) {
        return RACES.filter((r) => args.includes(r.parentRaceId)).map((r) => ({ id: r.id, parentRaceId: r.parentRaceId }));
      }
      if (sql.includes('"raceFormat"')) {
        return RACES.filter((r) => args.includes(r.id)).map((r) => ({
          id: r.id, qualiMinutes: null, raceLaps: null, raceFormat: r.raceFormat, sprintLaps: null,
        }));
      }
      throw new Error(`fake prisma: ${sql.slice(0, 60)}`);
    },
  };
}

describe("driver standings on a sprint weekend", () => {
  it("adds the sprint to its round, ignores the training, and marks the weekend", async () => {
    const table = await getDriverStandings(fakePrisma(), SEASON);
    expect(table.raceNumbers).toEqual([1, 2]); // the child and the training are not rounds
    expect(table.sprintRounds).toEqual([2]);
    const totals = Object.fromEntries(table.standings.map((r) => [r.driverId, r.total]));
    // A 35 + 30 + 0 (sprint DNF; the training's 35 never counts)
    // B 22 + 22 + 25, X 30 + 35 + 30, Y 25 + 25 + 35
    expect(totals).toEqual({ A: 65, B: 69, X: 95, Y: 85 });
    expect(table.standings.map((r) => r.driverId)).toEqual(["X", "Y", "B", "A"]);
  });

  it("keeps the feature's finish in the cell and carries the sprint's share beside it", async () => {
    const table = await getDriverStandings(fakePrisma(), SEASON);
    const row = (id) => table.standings.find((r) => r.driverId === id);
    expect(row("Y").perRace[2]).toEqual({
      points: 60, status: "FINISHED", position: 3, grid: null,
      sprint: { points: 35, status: "FINISHED", position: 1 },
    });
    expect(row("A").perRace[2]).toEqual({
      points: 30, status: "FINISHED", position: 2, grid: null,
      sprint: { points: 0, status: "DNF", position: null },
    });
    expect(row("A").perRace[1]).toEqual({ points: 35, status: "FINISHED", position: 1, grid: null });
  });

  it("the drop rule drops a whole weekend or keeps it, never one half", async () => {
    // Drop one round each. Y: R1 25 vs R2 60 -> R1 goes; total 60.
    // B: R1 22 vs R2 47 -> R1 goes; total 47. Nobody's sprint is dropped alone.
    const table = await getDriverStandings(fakePrisma({ dropWorst: 1 }), SEASON);
    const row = (id) => table.standings.find((r) => r.driverId === id);
    expect(row("Y").droppedRounds).toEqual([1]);
    expect(row("Y").total).toBe(60);
    expect(row("B").droppedRounds).toEqual([1]);
    expect(row("B").total).toBe(47);
  });

  it("a sprint result alone (no feature result) still scores under its round", async () => {
    const results = RESULTS.filter((r) => !(r.raceId === "r2" && r.driverId === "B"));
    const table = await getDriverStandings(fakePrisma({ results }), SEASON);
    const b = table.standings.find((r) => r.driverId === "B");
    expect(b.total).toBe(47); // 22 + sprint 25
    expect(b.perRace[2]).toEqual({
      points: 25, status: null, position: null, grid: null,
      sprint: { points: 25, status: "FINISHED", position: 3 },
    });
  });
});

describe("constructor standings on a sprint weekend", () => {
  it("Tier 2 is re-ranked in each race on its own, then summed into the round", async () => {
    const table = await getT2ConstructorStandings(fakePrisma(), SEASON);
    expect(table.sprintRounds).toEqual([2]);
    const row = (id) => table.standings.find((r) => r.teamId === id);
    // R1: X P2, Y P3 -> X 35, Y 30. Feature: X 35, Y 30. Sprint: Y 35, X 30.
    expect(row("t2a").perRace).toEqual({ 1: 35, 2: 65 });
    expect(row("t2b").perRace).toEqual({ 1: 30, 2: 65 });
    expect(row("t2a").total).toBe(100);
    expect(row("t2b").total).toBe(95);
  });

  it("Tier 1 adds both drivers' points from both races", async () => {
    const table = await getT1ConstructorStandings(fakePrisma(), SEASON);
    const t1 = table.standings.find((r) => r.teamId === "t1");
    expect(t1.perRace).toEqual({ 1: 57, 2: 77 }); // 35+22; (30+0) + (22+25)
    expect(t1.total).toBe(134);
  });
});

describe("admin preview of a sprint weekend", () => {
  // A new sprint result: A P1, X P2, Y P3, B P4.
  const proposal = [
    { driverId: "A", position: 1, status: "FINISHED", penaltySeconds: 0 },
    { driverId: "X", position: 2, status: "FINISHED", penaltySeconds: 0 },
    { driverId: "Y", position: 3, status: "FINISHED", penaltySeconds: 0 },
    { driverId: "B", position: 4, status: "FINISHED", penaltySeconds: 0 },
  ];
  const totals = (rows) => Object.fromEntries(rows.map((r) => [r.driverId, r.total]));

  it("session SPRINT against the event replaces the sprint and keeps the feature", async () => {
    const p = await previewRaceImpact(fakePrisma(), { seasonId: SEASON, raceId: "r2", results: proposal, session: "SPRINT" });
    expect(p.targetNumber).toBe(2);
    expect(p.session).toBe("SPRINT");
    // A 35 + 30 + 35, X 30 + 35 + 30, Y 25 + 25 + 25, B 22 + 22 + 22.
    expect(totals(p.drivers)).toEqual({ A: 100, X: 95, Y: 75, B: 66 });
    // A was P4 on 65 and would lead: three places up.
    expect(p.drivers.find((r) => r.driverId === "A").delta).toBe(3);
  });

  it("the sprint child's own id says the same thing without a session", async () => {
    const p = await previewRaceImpact(fakePrisma(), { seasonId: SEASON, raceId: "r2s", results: proposal });
    expect(p.targetNumber).toBe(2);
    expect(p.session).toBe("SPRINT");
    expect(totals(p.drivers)).toEqual({ A: 100, X: 95, Y: 75, B: 66 });
  });

  it("a feature proposal keeps the stored sprint in the table", async () => {
    const p = await previewRaceImpact(fakePrisma(), { seasonId: SEASON, raceId: "r2", results: proposal });
    expect(p.session).toBe("RACE");
    // A 35 + 35 + 0, X 30 + 30 + 30, Y 25 + 25 + 35, B 22 + 22 + 25.
    expect(totals(p.drivers)).toEqual({ A: 70, X: 90, Y: 85, B: 69 });
  });

  it("the Tier-2 haul of the proposal is re-ranked within the proposal alone", async () => {
    const p = await previewRaceImpact(fakePrisma(), { seasonId: SEASON, raceId: "r2", results: proposal, session: "SPRINT" });
    // Proposal: X P2, Y P3 -> re-ranked X 35 (t2a), Y 30 (t2b).
    expect(p.roundTeams.t2.map((t) => [t.teamId, t.points])).toEqual([["t2a", 35], ["t2b", 30]]);
    // Season Tier 2 with the proposal: t2a R1 35 + (feature 35 + sprint 35) = 105,
    // t2b R1 30 + (feature 30 + sprint 30) = 90.
    expect(Object.fromEntries(p.t2.map((t) => [t.teamId, t.total]))).toEqual({ t2a: 105, t2b: 90 });
  });
});
