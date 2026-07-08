import { describe, it, expect } from "vitest";
import {
  applyDropScores,
  computeDriverDropRounds,
  buildConstructorRows,
  applyFinalStandings,
  buildStoredConstructorRows,
  applyTeamDrop,
} from "./standingsService.js";
import { parseFinalStandings } from "./seasonService.js";

// The full Season 7 calendar is 12 rounds; the best 9 count.
const CAL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Build a roundNumber -> points map from a 10-long R1..R10 list (R11/R12 unrun).
const upto10 = (arr) => Object.fromEntries(arr.map((p, i) => [i + 1, p]));

describe("applyDropScores (drop worst 3 of the full calendar)", () => {
  it("drops the 3 lowest rounds and sums the rest", () => {
    // Five rounds, no missing: drop 1,2,3 -> keep 40+50 = 90.
    const pts = { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50 };
    const { total, droppedRounds } = applyDropScores(pts, [1, 2, 3, 4, 5]);
    expect(total).toBe(90);
    expect(droppedRounds).toEqual([1, 2, 3]);
  });

  it("treats not-yet-run / missing rounds as droppable 0s", () => {
    // Two real rounds on a 12-round calendar: the 3 dropped are all 0s, so the
    // real scores both survive.
    const { total, droppedRounds } = applyDropScores({ 1: 35, 2: 30 }, CAL);
    expect(total).toBe(65);
    expect(droppedRounds).toHaveLength(3);
    expect(droppedRounds).not.toContain(1);
    expect(droppedRounds).not.toContain(2);
  });

  it("drops exactly 3 even when more rounds are 0 (one 0 survives)", () => {
    // Maltegoat: DNS,30,14,25,25,35,DNS,12,22,12 over R1..R10, R11/R12 unrun.
    // 4 zeros (R1, R7, R11, R12) but only 3 are dropped -> total 175.
    const pts = upto10([0, 30, 14, 25, 25, 35, 0, 12, 22, 12]);
    expect(applyDropScores(pts, CAL).total).toBe(175);
  });

  // Real Season-7 driver totals from the official sheet.
  it.each([
    ["Siggsta", [25, 18, 35, 35, 22, 12, 22, 25, 20, 18], 220],
    ["Mtimmis", [14, 8, 25, 30, 30, 6, 20, 30, 30, 30], 217],
    ["Takoda", [20, 25, 22, 22, 0, 22, 35, 18, 12, 35], 211], // R5 DSQ = 0
    ["Pizd", [16, 16, 6, 18, 14, 14, 18, 20, 25, 22], 163],
    ["13bot", [35, 35, 0, 0, 0, 0, 25, 22, 0, 10], 127], // DNS/0 rounds = 0
  ])("matches the official driver total for %s", (_name, scores, expected) => {
    expect(applyDropScores(upto10(scores), CAL).total).toBe(expected);
  });

  it("never drops more than there are rounds (short season)", () => {
    // 2-round calendar: drop count 3 >= rounds, so nothing is dropped.
    const { total, droppedRounds } = applyDropScores({ 1: 10, 2: 20 }, [1, 2]);
    expect(total).toBe(30);
    expect(droppedRounds).toEqual([]);
  });
});

// The drop count is per-season (Season.dropWorst) and passed as the 3rd arg.
describe("applyDropScores with a custom per-season drop count", () => {
  it("dropN = 0 keeps every round", () => {
    const { total, droppedRounds } = applyDropScores({ 1: 10, 2: 0, 3: 30 }, [1, 2, 3], 0);
    expect(total).toBe(40);
    expect(droppedRounds).toEqual([]);
  });

  it("dropN = 1 drops only the single lowest round", () => {
    const { total, droppedRounds } = applyDropScores({ 1: 10, 2: 20, 3: 30 }, [1, 2, 3], 1);
    expect(total).toBe(50);
    expect(droppedRounds).toEqual([1]);
  });

  it("dropN = 5 on a 6-round calendar keeps only the best round", () => {
    const pts = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25, 6: 30 };
    const { total, droppedRounds } = applyDropScores(pts, [1, 2, 3, 4, 5, 6], 5);
    expect(total).toBe(30);
    expect(droppedRounds).toEqual([1, 2, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// Constructor drop rule: the drop is PER DRIVER, not per team. Each driver's
// dropN lowest rounds don't count for whichever team they drove for in those
// rounds; the teammate's points in the same round still score.
// ---------------------------------------------------------------------------

// Shorthand: a FINISHED result with explicit points (getDriverResultPoints
// uses the explicit value, so driver points == constructor contribution here).
const res = (driverId, points, extra = {}) => ({
  driverId,
  position: 1,
  status: "FINISHED",
  points,
  ...extra,
});

const T1_TEAMS = [
  { id: "tx", tier: 1 },
  { id: "ty", tier: 1 },
];
const T1_DRIVERS = [
  { id: "A", teamId: "tx" },
  { id: "B", teamId: "tx" },
  { id: "C", teamId: "ty" },
];

describe("computeDriverDropRounds", () => {
  it("finds each driver's own lowest rounds independently", () => {
    const resultsByRound = new Map([
      [1, [res("A", 5), res("B", 25)]],
      [2, [res("A", 20), res("B", 4)]],
      [3, [res("A", 30), res("B", 10)]],
    ]);
    const dropped = computeDriverDropRounds(resultsByRound, [1, 2, 3], 1);
    expect([...dropped.get("A")]).toEqual([1]); // A's worst is R1
    expect([...dropped.get("B")]).toEqual([2]); // B's worst is R2
  });
});

describe("buildConstructorRows (per-driver drop rule)", () => {
  it("removes each driver's dropped rounds from the team, keeping the teammate's share", () => {
    // A: 5/20/30 -> drops R1 (counts 50). B: 25/4/10 -> drops R2 (counts 35).
    const resultsByRound = new Map([
      [1, [res("A", 5), res("B", 25)]],
      [2, [res("A", 20), res("B", 4)]],
      [3, [res("A", 30), res("B", 10)]],
    ]);
    const [tx] = buildConstructorRows({
      tier: 1,
      teams: T1_TEAMS,
      drivers: T1_DRIVERS,
      raceNumbers: [1, 2, 3],
      resultsByRound,
      dropN: 1,
    });
    expect(tx.perRace).toEqual({ 1: 30, 2: 24, 3: 40 }); // full round hauls
    expect(tx.droppedPerRace).toEqual({ 1: 5, 2: 4 }); // A's R1, B's R2
    expect(tx.total).toBe(85); // 50 + 35 — NOT 70 (old team-level drop of R2)
  });

  it("a sub's dropped round is removed from the team they subbed for", () => {
    // Reserve S (no own team) drives every round as a sub: R1 for ty (10),
    // R2 for tx (2), R3 for ty (20). S's own worst round is R2 -> tx loses
    // those 2 points; S's rounds for ty both count.
    const drivers = [...T1_DRIVERS, { id: "S", teamId: null }];
    const resultsByRound = new Map([
      [1, [res("A", 20), res("S", 10, { subForTeamId: "ty" })]],
      [2, [res("A", 25), res("S", 2, { subForTeamId: "tx" })]],
      [3, [res("A", 15), res("C", 30), res("S", 20, { subForTeamId: "ty" })]],
    ]);
    const rows = buildConstructorRows({
      tier: 1,
      teams: T1_TEAMS,
      drivers,
      raceNumbers: [1, 2, 3],
      resultsByRound,
      dropN: 1,
    });
    const tx = rows.find((r) => r.team.id === "tx");
    const ty = rows.find((r) => r.team.id === "ty");
    expect(tx.droppedPerRace).toEqual({ 2: 2, 3: 15 }); // S's R2 sub + A's own worst (R3)
    expect(tx.total).toBe(45); // A keeps R1+R2
    expect(ty.perRace).toEqual({ 1: 10, 2: 0, 3: 50 });
    expect(ty.droppedPerRace).toEqual({}); // none of S's ty rounds is S's worst
    expect(ty.total).toBe(60); // S: 10+20, C: 30
  });

  it("rounds a driver didn't start count as their droppable 0s (unrun rounds too)", () => {
    // Two of five calendar rounds run; each driver's 3 drops are all 0-rounds,
    // so every real point survives.
    const resultsByRound = new Map([
      [1, [res("A", 20), res("B", 4)]],
      [2, [res("A", 25), res("B", 10)]],
    ]);
    const [tx] = buildConstructorRows({
      tier: 1,
      teams: T1_TEAMS,
      drivers: T1_DRIVERS,
      raceNumbers: [1, 2, 3, 4, 5],
      resultsByRound,
      dropN: 3,
    });
    expect(tx.droppedPerRace).toEqual({});
    expect(tx.total).toBe(59);
  });

  it("a fully dropped round zeroes the team's round, like the old strike-through", () => {
    // Both tx drivers have R1 as their personal worst -> the whole round drops.
    const resultsByRound = new Map([
      [1, [res("A", 2), res("B", 1)]],
      [2, [res("A", 20), res("B", 10)]],
      [3, [res("A", 30), res("B", 15)]],
    ]);
    const [tx] = buildConstructorRows({
      tier: 1,
      teams: T1_TEAMS,
      drivers: T1_DRIVERS,
      raceNumbers: [1, 2, 3],
      resultsByRound,
      dropN: 1,
    });
    expect(tx.perRace[1]).toBe(3);
    expect(tx.droppedPerRace[1]).toBe(3);
    expect(tx.total).toBe(75);
  });

  it("Tier 2: the dropped share is the driver's RE-RANKED points for that round", () => {
    // T2 field re-ranks around Tier-1 cars. D (t2a) finishes P2 behind a T1
    // car in both rounds -> re-ranked P1 = 35 each. E (t2b) P3 -> re-ranked
    // P2 = 30 each. With dropN 1 each driver drops one round; the team loses
    // the re-ranked 35/30, not the raw driver points.
    const teams = [
      { id: "t1x", tier: 1 },
      { id: "t2a", tier: 2 },
      { id: "t2b", tier: 2 },
    ];
    const drivers = [
      { id: "W", teamId: "t1x" },
      { id: "D", teamId: "t2a" },
      { id: "E", teamId: "t2b" },
    ];
    const rr = (driverId, position, points) => ({ driverId, position, status: "FINISHED", points });
    const resultsByRound = new Map([
      // Driver points: D 30, E 25 (raw P2/P3).
      [1, [rr("W", 1, 35), rr("D", 2, 30), rr("E", 3, 25)]],
      // R2: D and E swap on the road -> D raw P3 (25), E raw P2 (30).
      [2, [rr("W", 1, 35), rr("E", 2, 30), rr("D", 3, 25)]],
    ]);
    const rows = buildConstructorRows({
      tier: 2,
      teams,
      drivers,
      raceNumbers: [1, 2],
      resultsByRound,
      dropN: 1,
    });
    const t2a = rows.find((r) => r.team.id === "t2a");
    const t2b = rows.find((r) => r.team.id === "t2b");
    // Re-ranked: R1 D=35, E=30; R2 E=35, D=30.
    expect(t2a.perRace).toEqual({ 1: 35, 2: 30 });
    // D's personal worst (by driver points) is R2 -> t2a loses the re-ranked 30.
    expect(t2a.droppedPerRace).toEqual({ 2: 30 });
    expect(t2a.total).toBe(35);
    // E's personal worst is R1 -> t2b loses the re-ranked 30 from R1.
    expect(t2b.droppedPerRace).toEqual({ 1: 30 });
    expect(t2b.total).toBe(35);
  });
});

// ---------------------------------------------------------------------------
// Archived seasons: official final standings are stored verbatim on the season
// and override the computed totals & order. parseFinalStandings sanitises the
// stored JSON; applyFinalStandings applies it to already-built standings rows.
// ---------------------------------------------------------------------------

describe("parseFinalStandings", () => {
  it("parses a well-formed payload into id/points arrays", () => {
    const raw = JSON.stringify({
      drivers: [{ driverId: "a", points: 100 }, { driverId: "b", points: 80 }],
      teams: [{ teamId: "tx", points: 180 }],
    });
    expect(parseFinalStandings(raw)).toEqual({
      drivers: [{ id: "a", points: 100 }, { id: "b", points: 80 }],
      teams: [{ id: "tx", points: 180 }],
      teamPerRace: null,
    });
  });

  it("returns null for null/empty/garbage/invalid JSON", () => {
    expect(parseFinalStandings(null)).toBeNull();
    expect(parseFinalStandings("")).toBeNull();
    expect(parseFinalStandings("not json")).toBeNull();
    expect(parseFinalStandings("[]")).toBeNull(); // array, no drivers/teams
    expect(parseFinalStandings(JSON.stringify({ drivers: [], teams: [] }))).toBeNull();
  });

  it("drops entries missing an id or with bad points, keeps the good ones", () => {
    const raw = JSON.stringify({
      drivers: [
        { driverId: "a", points: 50 },
        { driverId: "b", points: -5 }, // negative -> dropped
        { points: 10 }, // no id -> dropped
        { driverId: "c", points: 7.5 }, // non-integer -> dropped
      ],
    });
    expect(parseFinalStandings(raw)).toEqual({ drivers: [{ id: "a", points: 50 }], teams: [], teamPerRace: null });
  });
});

describe("applyFinalStandings (official-totals overlay)", () => {
  const mkRows = () => [
    { driverId: "a", name: "Ann", total: 30, position: 1 },
    { driverId: "b", name: "Bob", total: 20, position: 2 },
    { driverId: "c", name: "Cid", total: 10, position: 3 },
  ];

  it("overrides totals and orders by the official array", () => {
    const rows = mkRows();
    // Official order puts Cid first, then Ann, then Bob, with new totals.
    applyFinalStandings(rows, [
      { id: "c", points: 214 },
      { id: "a", points: 180 },
      { id: "b", points: 90 },
    ], "driverId");
    expect(rows.map((r) => [r.driverId, r.total, r.position])).toEqual([
      ["c", 214, 1],
      ["a", 180, 2],
      ["b", 90, 3],
    ]);
  });

  it("keeps unlisted rows on their computed total, sorted after the listed ones", () => {
    const rows = mkRows();
    // Only Bob is official; Ann & Cid keep computed totals (30, 10) and sort
    // after Bob by total desc.
    applyFinalStandings(rows, [{ id: "b", points: 500 }], "driverId");
    expect(rows.map((r) => [r.driverId, r.total, r.position])).toEqual([
      ["b", 500, 1],
      ["a", 30, 2],
      ["c", 10, 3],
    ]);
  });

  it("is a no-op when finals are null or empty", () => {
    const rows = mkRows();
    const before = JSON.stringify(rows);
    applyFinalStandings(rows, null, "driverId");
    applyFinalStandings(rows, [], "driverId");
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("parseFinalStandings with teamPerRace", () => {
  it("keeps only finite per-race team points, keyed by team then round", () => {
    const raw = JSON.stringify({
      teams: [{ teamId: "tx", points: 100 }],
      teamPerRace: { tx: { 1: 21, 2: "38", 3: "DNS" } },
    });
    expect(parseFinalStandings(raw).teamPerRace).toEqual({ tx: { 1: 21, 2: 38 } });
  });
});

describe("buildStoredConstructorRows (official per-race team points, per-team drop)", () => {
  const teams = [
    { id: "tx", name: "TX", color: "#111", tier: 1, logoUrl: null },
    { id: "ty", name: "TY", color: "#222", tier: 1, logoUrl: null },
    { id: "tz", name: "TZ", color: "#333", tier: 2, logoUrl: null },
  ];
  const teamPerRace = {
    tx: { 1: 21, 2: 38, 3: 40, 4: 0 }, // worst 3 = 0,21,38 -> keep 40
    ty: { 1: 10, 2: 20, 3: 30, 4: 40 }, // worst 3 = 10,20,30 -> keep 40
    tz: { 1: 5, 2: 5, 3: 5, 4: 5 },
  };

  it("drops each team's own worst N rounds and returns only the tier's teams", () => {
    const rows = buildStoredConstructorRows({ tier: 1, teams, raceNumbers: [1, 2, 3, 4], teamPerRace, dropN: 3 });
    expect(rows.map((r) => r.teamId)).toEqual(["tx", "ty"]); // tz is tier 2
    const tx = rows.find((r) => r.teamId === "tx");
    expect(tx.perRace).toEqual({ 1: 21, 2: 38, 3: 40, 4: 0 }); // full haul shown
    expect(tx.droppedPerRace).toEqual({ 1: 21, 2: 38 }); // 0-round dropped silently
    expect(tx.total).toBe(40);
    expect(rows.find((r) => r.teamId === "ty").total).toBe(40);
  });
});

describe("applyTeamDrop", () => {
  const CAL12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  it("drops nothing mid-season while ghost 0-slots outnumber real ones", () => {
    // 2 real rounds run, 2 roster slots, 12-round calendar -> 24 slots, most 0.
    const contributions = [
      { round: 1, points: 30 }, { round: 1, points: 20 },
      { round: 2, points: 25 }, { round: 2, points: 18 },
    ];
    const r = applyTeamDrop({ contributions, rosterSlots: 2, roundNumbers: CAL12, dropN: 6 });
    expect(r.total).toBe(93); // nothing real dropped: the 6 lowest are all 0-slots
    expect(r.droppedPerRace).toEqual({});
  });

  it("drops the N lowest single-driver round scores over a full season", () => {
    // Every round has 2 slots; make R1 the two lowest (5 and 3).
    const contributions = [];
    for (const round of CAL12) {
      contributions.push({ round, points: round === 1 ? 5 : 20 });
      contributions.push({ round, points: round === 1 ? 3 : 15 });
    }
    const full = contributions.reduce((s, c) => s + c.points, 0);
    const r = applyTeamDrop({ contributions, rosterSlots: 2, roundNumbers: CAL12, dropN: 2 });
    expect(r.droppedPerRace).toEqual({ 1: 8 }); // both R1 slots dropped
    expect(r.total).toBe(full - 8);
  });

  it("counts a sub's contribution as a droppable slot for the host team", () => {
    // R1 has 3 contributions (2 regulars + 1 sub); the sub's 2 pts is the lowest.
    const contributions = [
      { round: 1, points: 25 }, { round: 1, points: 18 }, { round: 1, points: 2 },
      { round: 2, points: 25 }, { round: 2, points: 18 },
    ];
    const r = applyTeamDrop({ contributions, rosterSlots: 2, roundNumbers: [1, 2], dropN: 1 });
    // slots: 3 in R1 + 2 in R2 = 5 (no ghosts, both rounds full) -> drop the 2.
    expect(r.droppedPerRace).toEqual({ 1: 2 });
    expect(r.total).toBe(25 + 18 + 25 + 18);
  });

  it("drops nothing when dropN is 0", () => {
    const contributions = [{ round: 1, points: 30 }, { round: 1, points: 20 }];
    const r = applyTeamDrop({ contributions, rosterSlots: 2, roundNumbers: [1, 2], dropN: 0 });
    expect(r.total).toBe(50);
    expect(r.droppedPerRace).toEqual({});
  });
});
