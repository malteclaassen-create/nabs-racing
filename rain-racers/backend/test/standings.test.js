import { describe, it, expect } from "vitest";
import { pointsFor, fastestLapResultId } from "../src/lib/points.js";
import { buildStandings } from "../src/lib/standings.js";
import { DEFAULTS as LEAGUE } from "../src/lib/settings.js";

// A plain table to count with (the league's own default is longer).
const DEFAULTS = { ...LEAGUE, pointsTable: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], fastestLapPoints: 1, fastestLapTopN: 10 };

const teamA = { id: 1, name: "Thunder", color: "#ff0000" };
const teamB = { id: 2, name: "Cloudburst", color: null };
const driver = (id, name, team) => ({ id, name, number: null, country: null, team });
const ann = driver(1, "Ann", teamA);
const bob = driver(2, "Bob", teamA);
const cat = driver(3, "Cat", teamB);

let rid = 0;
const res = (d, position, extra = {}) => ({
  id: ++rid,
  driverId: d.id,
  driver: d,
  teamId: d.team?.id ?? null,
  team: d.team,
  position,
  status: "FIN",
  bestLapMs: 100000 + position,
  pointsAdjust: 0,
  ...extra,
});

describe("points", () => {
  it("scores the table, the fastest lap and adjustments", () => {
    const r = res(ann, 1);
    expect(pointsFor(r, DEFAULTS.pointsTable, DEFAULTS)).toBe(25);
    expect(pointsFor(r, DEFAULTS.pointsTable, DEFAULTS, 2)).toBe(50);
    expect(pointsFor(r, DEFAULTS.pointsTable, DEFAULTS, 1, true)).toBe(26);
    expect(pointsFor({ ...r, pointsAdjust: -5 }, DEFAULTS.pointsTable, DEFAULTS)).toBe(20);
    expect(pointsFor({ ...r, position: 11 }, DEFAULTS.pointsTable, DEFAULTS, 1, true)).toBe(0); // outside the top 10: no fastest-lap point
  });

  it("gives a DNF nothing unless DNFs score", () => {
    const r = res(ann, 3, { status: "DNF" });
    expect(pointsFor(r, DEFAULTS.pointsTable, DEFAULTS)).toBe(0);
    expect(pointsFor(r, DEFAULTS.pointsTable, { ...DEFAULTS, dnfScores: true })).toBe(15);
    expect(pointsFor(r, DEFAULTS.pointsTable, DEFAULTS, 1, true)).toBe(0);
  });

  it("finds the fastest lap, skipping DNS and DSQ", () => {
    const a = res(ann, 1, { bestLapMs: 90000, status: "DSQ" });
    const b = res(bob, 2, { bestLapMs: 91000 });
    const c = res(cat, 3, { bestLapMs: 92000 });
    expect(fastestLapResultId([a, b, c])).toBe(b.id);
  });
});

describe("buildStandings", () => {
  const races = [
    { id: 10, round: 1, name: "R1", track: "spa", pointsMultiplier: 1, results: [res(ann, 1), res(bob, 2), res(cat, 3)] },
    { id: 11, round: 2, name: "R2", track: "monza", pointsMultiplier: 1, results: [res(bob, 1), res(ann, 2), res(cat, 3)] },
    { id: 12, round: 3, name: "R3", track: "imola", pointsMultiplier: 1, results: [] },
  ];

  it("adds up drivers and teams, with countback on a tie", () => {
    const s = buildStandings(races, { ...DEFAULTS, fastestLapPoints: 0 });
    expect(s.drivers.map((d) => [d.name, d.points, d.wins])).toEqual([
      ["Ann", 43, 1],
      ["Bob", 43, 1],
      ["Cat", 30, 0],
    ]);
    expect(s.teams.map((t) => [t.name, t.points])).toEqual([
      ["Thunder", 86],
      ["Cloudburst", 30],
    ]);
    expect(s.rounds.map((r) => r.done)).toEqual([true, true, false]);
    expect(s.drivers[0].rounds[10]).toMatchObject({ points: 25, races: [{ position: 1, points: 25 }] });
  });

  it("breaks the tie on second places when wins are level", () => {
    const more = [...races, { id: 13, round: 4, name: "R4", track: "x", pointsMultiplier: 1, results: [res(cat, 1), res(bob, 2), res(ann, 3, { pointsAdjust: 3 })] }];
    // Ann and Bob both on 61 points with one win each; Bob has two second places
    const s = buildStandings(more, { ...DEFAULTS, fastestLapPoints: 0 });
    expect(s.drivers.map((d) => d.name).slice(0, 2)).toEqual(["Bob", "Ann"]);
  });
});
