import { describe, it, expect } from "vitest";
import {
  getPointsForPosition,
  getDriverResultPoints,
  calculateT1ConstructorPoints,
  calculateT2ConstructorPoints,
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

  it("keeps a Tier-2 DNF/DSQ in the order (holds its slot) but scores it 0", () => {
    // c1 finishes ahead but DNFs -> holds rank 1 (scores 0); d1 is rank 2 -> 30.
    const results = [
      fin("c1", 1, { status: "DNF" }), // holds slot 1, scores 0
      fin("d1", 2), // rank 2 -> 30
    ];
    const pts = calculateT2ConstructorPoints(results, drivers, teams);
    expect(pts).toEqual({ delta: 30 });
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
