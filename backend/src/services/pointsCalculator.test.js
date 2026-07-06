import { describe, it, expect } from "vitest";
import {
  getPointsForPosition,
  getDriverResultPoints,
  calculateT1ConstructorPoints,
  calculateT2ConstructorPoints,
  classifyResults,
  applyPenalties,
} from "./pointsCalculator.js";

// Shared fixtures ------------------------------------------------------------
// Teams: two Tier-1, two Tier-2, one Reserve (tier 0).
const teams = [
  { id: "alpha", name: "Alpha", tier: 1 },
  { id: "bravo", name: "Bravo", tier: 1 },
  { id: "charlie", name: "Charlie", tier: 2 },
  { id: "delta", name: "Delta", tier: 2 },
  { id: "reserve", name: "Reserve", tier: 0 },
];

const drivers = [
  { id: "a1", teamId: "alpha", tier: 1 },
  { id: "a2", teamId: "alpha", tier: 1 },
  { id: "b1", teamId: "bravo", tier: 1 },
  { id: "b2", teamId: "bravo", tier: 1 },
  { id: "c1", teamId: "charlie", tier: 2 },
  { id: "c2", teamId: "charlie", tier: 2 },
  { id: "d1", teamId: "delta", tier: 2 },
  { id: "d2", teamId: "delta", tier: 2 },
  { id: "r1", teamId: "reserve", tier: 0 },
];

// Helper to build a finished result.
const fin = (driverId, position, extra = {}) => ({
  driverId,
  position,
  status: "FINISHED",
  points: null,
  subForTeamId: null,
  ...extra,
});

describe("getPointsForPosition", () => {
  it("maps the F1-2007 points table for P1..P18", () => {
    const table = [35, 30, 25, 22, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
    table.forEach((pts, i) => {
      expect(getPointsForPosition(i + 1)).toBe(pts);
    });
  });

  it("awards 0 for P19 and beyond", () => {
    expect(getPointsForPosition(19)).toBe(0);
    expect(getPointsForPosition(40)).toBe(0);
  });

  it("awards 0 for missing / invalid positions", () => {
    expect(getPointsForPosition(0)).toBe(0);
    expect(getPointsForPosition(null)).toBe(0);
    expect(getPointsForPosition(undefined)).toBe(0);
    expect(getPointsForPosition(-3)).toBe(0);
  });

  // A season can override the points table (Season.pointsTable).
  it("honours a custom per-season points table", () => {
    const custom = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]; // classic F1 top-10
    expect(getPointsForPosition(1, custom)).toBe(25);
    expect(getPointsForPosition(10, custom)).toBe(1);
    expect(getPointsForPosition(11, custom)).toBe(0); // past the table = 0
    expect(getDriverResultPoints(fin("a1", 2), custom)).toBe(18);
    // Explicit stored points still win over the table.
    expect(getDriverResultPoints(fin("a1", 2, { points: 99 }), custom)).toBe(99);
  });

  it("passes the custom table through the constructor calculators", () => {
    const custom = [10, 5];
    const results = [fin("a1", 1), fin("c1", 2), fin("d1", 3)];
    // T1: a1 wins -> alpha 10 (custom P1).
    expect(calculateT1ConstructorPoints(results, drivers, teams, custom)).toEqual({ alpha: 10 });
    // T2 re-rank: c1 is best T2 (P1 -> 10), d1 second (P2 -> 5).
    expect(calculateT2ConstructorPoints(results, drivers, teams, custom)).toEqual({ charlie: 10, delta: 5 });
  });
});

describe("getDriverResultPoints", () => {
  it("uses finishing position when no explicit points", () => {
    expect(getDriverResultPoints(fin("a1", 1))).toBe(35);
    expect(getDriverResultPoints(fin("a1", 10))).toBe(10);
  });

  it("prefers explicit historical points over position", () => {
    expect(getDriverResultPoints(fin("a1", 1, { points: 7 }))).toBe(7);
  });

  it("treats explicit 0 points as a real value, not a fallback", () => {
    expect(getDriverResultPoints(fin("a1", 1, { points: 0 }))).toBe(0);
  });

  it("scores 0 for DNS / DNF / DSQ regardless of position or points", () => {
    expect(getDriverResultPoints(fin("a1", 1, { status: "DNS" }))).toBe(0);
    expect(getDriverResultPoints(fin("a1", 1, { status: "DNF" }))).toBe(0);
    expect(getDriverResultPoints(fin("a1", 1, { status: "DSQ", points: 35 }))).toBe(0);
  });
});

// Helper to build a finished result with a total race time (ms).
const fint = (driverId, position, totalTimeMs, extra = {}) =>
  fin(driverId, position, { totalTimeMs, ...extra });

describe("classifyResults / applyPenalties (time penalties)", () => {
  it("is an exact no-op when no result has a penalty (historical rounds unchanged)", () => {
    const results = [
      fint("a1", 1, 100000),
      fint("b1", 2, 101000),
      fint("c1", 3, 103000),
      fint("d1", 4, 110000),
    ];
    const map = classifyResults(results);
    expect([...map.entries()]).toEqual([
      ["a1", 1],
      ["b1", 2],
      ["c1", 3],
      ["d1", 4],
    ]);
    // positions untouched
    expect(applyPenalties(results).map((r) => r.position)).toEqual([1, 2, 3, 4]);
  });

  it("is a no-op for legacy rounds with no stored total times, even with a penalty", () => {
    // No totalTimeMs anywhere -> we can't time-sort, so the stored order stands.
    const results = [fin("a1", 1, { penaltySeconds: 10 }), fin("b1", 2), fin("c1", 3)];
    expect(applyPenalties(results).map((r) => r.position)).toEqual([1, 2, 3]);
  });

  it("closes the gap left by a DNF: finishers behind it move up (league rule 2026-07-04)", () => {
    // P3 is a DNF — it holds NO slot, so the stored 1,2,4,5 classify as 1,2,3,4.
    const results = [
      fint("a1", 1, 100000),
      fint("b1", 2, 101000),
      fin("c1", 3, { status: "DNF" }),
      fint("d1", 4, 103000),
      fint("a2", 5, 104000),
    ];
    const applied = applyPenalties(results);
    expect(applied.find((r) => r.driverId === "d1").position).toBe(3);
    expect(applied.find((r) => r.driverId === "a2").position).toBe(4);
    // the DNF itself is untouched (unclassified, scores 0 anyway)
    expect(applied.find((r) => r.driverId === "c1").position).toBe(3);
    expect(getDriverResultPoints(applied.find((r) => r.driverId === "c1"))).toBe(0);
  });

  it("keeps explicit (official) points when a car only moved up through a DNF gap", () => {
    // Historical rows carry official points; closing a gap must not rewrite them.
    const results = [
      fin("a1", 1, { points: 35 }),
      fin("c1", 2, { status: "DNF", points: 0 }),
      fin("d1", 3, { points: 25 }),
    ];
    const applied = applyPenalties(results);
    const d1 = applied.find((r) => r.driverId === "d1");
    expect(d1.position).toBe(2); // classified P2 now
    expect(getDriverResultPoints(d1)).toBe(25); // official points preserved
  });

  it("re-derives points from the closed-up position when none are stored (fresh imports)", () => {
    const results = [
      fin("a1", 1, { status: "DNF" }),
      fin("b1", 2), // no explicit points -> derives from the new P1
    ];
    const applied = applyPenalties(results);
    const b1 = applied.find((r) => r.driverId === "b1");
    expect(b1.position).toBe(1);
    expect(getDriverResultPoints(b1)).toBe(35);
  });

  it("drops the penalised car behind every car now ahead on adjusted time", () => {
    // P1 +5s -> 105.0s, slots in behind b1(101s) and c1(103s) but ahead of d1(110s).
    const results = [
      fint("a1", 1, 100000, { penaltySeconds: 5 }),
      fint("b1", 2, 101000),
      fint("c1", 3, 103000),
      fint("d1", 4, 110000),
    ];
    const map = classifyResults(results);
    expect(map.get("b1")).toBe(1); // bumped up
    expect(map.get("c1")).toBe(2); // bumped up
    expect(map.get("a1")).toBe(3); // dropped two places by time
    expect(map.get("d1")).toBe(4); // still slower even after the bump -> unchanged
  });

  it("does not move a car whose penalty is smaller than the gap behind", () => {
    // a1 leads by 6s; a 5s penalty isn't enough to drop it behind b1.
    const results = [
      fint("a1", 1, 100000, { penaltySeconds: 5 }),
      fint("b1", 2, 106000),
      fint("c1", 3, 110000),
    ];
    const map = classifyResults(results);
    expect(map.get("a1")).toBe(1); // 105.0s still ahead of 106.0s
    expect(map.get("b1")).toBe(2);
    expect(map.get("c1")).toBe(3);
  });

  it("re-scores the penalised car and the bumped cars, others kept as-is", () => {
    const results = [
      fint("a1", 1, 100000, { penaltySeconds: 5 }), // -> P3 -> 25
      fint("b1", 2, 101000), // bumped -> P1 -> 35
      fint("c1", 3, 103000), // bumped -> P2 -> 30
      fint("d1", 4, 110000), // untouched -> P4 -> 22
    ];
    const applied = applyPenalties(results);
    expect(getDriverResultPoints(applied.find((r) => r.driverId === "a1"))).toBe(25);
    expect(getDriverResultPoints(applied.find((r) => r.driverId === "b1"))).toBe(35);
    expect(getDriverResultPoints(applied.find((r) => r.driverId === "c1"))).toBe(30);
    expect(getDriverResultPoints(applied.find((r) => r.driverId === "d1"))).toBe(22);
  });

  it("never lets a lapped / low-time car jump ahead when another car is penalised", () => {
    // Regression: a retiree who ran few laps has a tiny total time but is
    // classified LAST. Penalising the winner must drop them only among same-lap
    // cars — the low-time retiree must NOT be shuffled to the front.
    const results = [
      fint("a1", 1, 600000, { penaltySeconds: 5 }), // winner +5s -> 605.0s
      fint("b1", 2, 601000),
      fint("c1", 3, 603000),
      fint("lap", 4, 120000), // retired early: smallest total time, classified P4
    ];
    const map = classifyResults(results);
    expect(map.get("lap")).toBe(4); // stays last despite the smallest time
    expect(map.get("b1")).toBe(1); // bumped up
    expect(map.get("c1")).toBe(2); // bumped up
    expect(map.get("a1")).toBe(3); // only the penalised car moved
  });

  it("does not drop a penalised car across a lap boundary, however big the penalty", () => {
    // A huge penalty on the leader still can't push it behind the lapped car.
    const results = [
      fint("a1", 1, 600000, { penaltySeconds: 600 }), // +10 min
      fint("b1", 2, 601000),
      fint("lap", 3, 90000), // lapped, tiny time
    ];
    const map = classifyResults(results);
    expect(map.get("lap")).toBe(3); // never jumped
    expect(map.get("b1")).toBe(1);
    expect(map.get("a1")).toBe(2); // dropped behind b1 only
  });

  it("keeps non-finishers out of the redistributed slots", () => {
    const results = [
      fint("a1", 1, 100000, { penaltySeconds: 5 }), // -> 105.0s, drops behind c1
      fin("b1", 2, { status: "DNF" }), // excluded — holds no slot
      fint("c1", 3, 101000),
    ];
    const map = classifyResults(results);
    // finishers a1 & c1 classify contiguously (1,2); a1 +5s drops behind c1.
    expect(map.get("c1")).toBe(1);
    expect(map.get("a1")).toBe(2);
    expect(map.has("b1")).toBe(false);
  });
});

describe("calculateT1ConstructorPoints", () => {
  it("sums real race points of both Tier-1 drivers, no re-ranking", () => {
    const results = [
      fin("a1", 1), // alpha 35
      fin("b1", 2), // bravo 30
      fin("a2", 3), // alpha 25
      fin("b2", 4), // bravo 22
    ];
    const pts = calculateT1ConstructorPoints(results, drivers, teams);
    expect(pts).toEqual({ alpha: 60, bravo: 52 });
  });

  it("credits a reserve subbing for a Tier-1 team to that team", () => {
    const results = [
      fin("a1", 1), // alpha 35
      fin("r1", 2, { subForTeamId: "alpha" }), // reserve -> alpha 30
    ];
    const pts = calculateT1ConstructorPoints(results, drivers, teams);
    expect(pts).toEqual({ alpha: 65 });
  });

  it("ignores Tier-2 teams entirely", () => {
    const results = [fin("a1", 1), fin("c1", 2)];
    const pts = calculateT1ConstructorPoints(results, drivers, teams);
    expect(pts).toEqual({ alpha: 35 });
  });
});

describe("calculateT2ConstructorPoints (re-ranking)", () => {
  it("re-ranks the Tier-2 field, ignoring the absolute finishing positions", () => {
    // Tier-1 cars take the top spots; Tier-2 cars finish 3rd & 5th overall but
    // are re-ranked to P1 (35) and P2 (30) within the Tier-2 field.
    const results = [
      fin("a1", 1),
      fin("b1", 2),
      fin("c1", 3), // charlie -> T2 rank 1 -> 35
      fin("a2", 4),
      fin("d1", 5), // delta   -> T2 rank 2 -> 30
    ];
    const pts = calculateT2ConstructorPoints(results, drivers, teams);
    expect(pts).toEqual({ charlie: 35, delta: 30 });
  });

  it("removes Tier-1 drivers and team-less reserves from the field (no slot held)", () => {
    // Order: c1(3rd overall), r1 team-less(4th), d1(5th).
    // The team-less reserve must NOT occupy a T2 slot, so d1 becomes T2 rank 2.
    const results = [
      fin("a1", 1),
      fin("b1", 2),
      fin("c1", 3), // T2 rank 1 -> 35
      fin("r1", 4), // team-less reserve -> removed
      fin("d1", 5), // T2 rank 2 -> 30  (NOT pushed to rank 3)
    ];
    const pts = calculateT2ConstructorPoints(results, drivers, teams);
    expect(pts).toEqual({ charlie: 35, delta: 30 });
  });

  it("credits a reserve subbing for a Tier-2 team to that team", () => {
    const results = [
      fin("c1", 1), // charlie -> rank 1 -> 35
      fin("r1", 2, { subForTeamId: "delta" }), // reserve -> delta rank 2 -> 30
    ];
    const pts = calculateT2ConstructorPoints(results, drivers, teams);
    expect(pts).toEqual({ charlie: 35, delta: 30 });
  });

  it("removes a Tier-2 DNF/DSQ from the field (no slot held), bumping cars up", () => {
    // c1 is ahead on the road but DNFs -> removed entirely; d1 bumps up to
    // T2 rank 1 -> 35 (it must NOT stay at rank 2).
    const results = [
      fin("c1", 1, { status: "DNF" }), // removed
      fin("d1", 2), // T2 rank 1 -> 35
    ];
    const pts = calculateT2ConstructorPoints(results, drivers, teams);
    expect(pts).toEqual({ delta: 35 });
  });

  it("sums both Tier-2 drivers of the same team", () => {
    const results = [
      fin("c1", 1), // rank 1 -> 35
      fin("c2", 2), // rank 2 -> 30
    ];
    const pts = calculateT2ConstructorPoints(results, drivers, teams);
    expect(pts).toEqual({ charlie: 65 });
  });

  it("excludes DNS and position-less results from the ranking", () => {
    const results = [
      fin("c1", 1), // rank 1 -> 35
      fin("c2", null, { status: "DNS" }), // excluded
      fin("d1", 2), // rank 2 -> 30
    ];
    const pts = calculateT2ConstructorPoints(results, drivers, teams);
    expect(pts).toEqual({ charlie: 35, delta: 30 });
  });
});

// ---------------------------------------------------------------------------
// New regression cases for the DSQ/DNF re-ranking fix.
// Field: one Tier-1 team `t1`, four Tier-2 teams A/B/C/D, one team-less reserve.
// ---------------------------------------------------------------------------
const t2teams = [
  { id: "t1", name: "T1", tier: 1 },
  { id: "A", name: "A", tier: 2 },
  { id: "B", name: "B", tier: 2 },
  { id: "C", name: "C", tier: 2 },
  { id: "D", name: "D", tier: 2 },
  { id: "res", name: "Reserve", tier: 0 },
];

const t2drivers = [
  { id: "t1d", teamId: "t1", tier: 1 },
  { id: "ad", teamId: "A", tier: 2 },
  { id: "bd", teamId: "B", tier: 2 },
  { id: "cd", teamId: "C", tier: 2 },
  { id: "dd", teamId: "D", tier: 2 },
  { id: "resd", teamId: "res", tier: 0 },
];

describe("calculateT2ConstructorPoints (DSQ/DNF removal fix)", () => {
  // Case A: a non-finishing Tier-2 car must not hold a slot — the cars behind
  // it bump up. Run once for DSQ and once for DNF (identical expectation).
  it.each(["DSQ", "DNF"])(
    "bumps Tier-2 cars up when a P3 car is %s (no slot held)",
    (status) => {
      const results = [
        fin("t1d", 1), // Tier-1 -> removed
        fin("ad", 2), // A -> T2 rank 1 -> 35
        fin("bd", 3, { status }), // B non-finisher -> removed
        fin("cd", 4), // C -> T2 rank 2 -> 30
        fin("dd", 5), // D -> T2 rank 3 -> 25
      ];
      const pts = calculateT2ConstructorPoints(results, t2drivers, t2teams);
      expect(pts).toEqual({ A: 35, C: 30, D: 25 });
      expect(pts.B).toBeUndefined();
    },
  );

  // Case B: a team-less reserve (effective tier 0) also does not occupy a slot.
  it("removes a team-less reserve so Tier-2 cars keep their bumped-up ranks", () => {
    const results = [
      fin("t1d", 1), // Tier-1 -> removed
      fin("ad", 2), // A -> T2 rank 1 -> 35
      fin("resd", 3), // team-less reserve -> removed
      fin("cd", 4), // C -> T2 rank 2 -> 30
      fin("dd", 5), // D -> T2 rank 3 -> 25
    ];
    const pts = calculateT2ConstructorPoints(results, t2drivers, t2teams);
    expect(pts).toEqual({ A: 35, C: 30, D: 25 });
  });
});

// Case C (league rule since 2026-07-04): a DSQ/DNF holds no classified slot
// ANYWHERE — the scoring pipeline runs applyPenalties first, which closes the
// gap, so the car behind inherits the position in the driver AND Tier-1
// standings too. The DSQ itself always scores 0.
describe("DSQ/DNF releases its slot in driver and Tier-1 standings", () => {
  it("scores a DSQ driver 0 regardless of its stored position", () => {
    expect(getDriverResultPoints({ status: "DSQ", position: 3 })).toBe(0);
    expect(getDriverResultPoints({ status: "FINISHED", position: 3 })).toBe(25);
  });

  it("promotes the Tier-1 P2 car to P1 points when the P1 car is DSQ", () => {
    const results = applyPenalties([
      fin("a1", 1, { status: "DSQ" }), // alpha DSQ -> 0, holds no slot
      fin("b1", 2), // bravo inherits P1 -> 35
    ]);
    const pts = calculateT1ConstructorPoints(results, drivers, teams);
    expect(pts).toEqual({ alpha: 0, bravo: 35 });
  });
});
