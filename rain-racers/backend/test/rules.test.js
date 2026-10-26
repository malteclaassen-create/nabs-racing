import { describe, it, expect } from "vitest";
import { buildStandings } from "../src/lib/standings.js";
import { orderWithPenalties, tablesFor, poleDriverId } from "../src/lib/points.js";
import { driverSeasonStats, headToHead, teamAt, attendance } from "../src/lib/stats.js";
import { DEFAULTS } from "../src/lib/settings.js";

const S = { ...DEFAULTS, fastestLapPoints: 0 };
const teamA = { id: 1, name: "Thunder", color: "#f00" };
const teamB = { id: 2, name: "Cloud", color: "#00f" };
const ann = { id: 1, name: "Ann", team: teamA };
const bob = { id: 2, name: "Bob", team: teamA };
const cat = { id: 3, name: "Cat", team: teamB };

let rid = 0;
const res = (d, position, extra = {}) => ({
  id: ++rid,
  driverId: d.id,
  driver: d,
  teamId: d.team?.id ?? null,
  team: d.team,
  position,
  status: "FIN",
  session: "FEATURE",
  bestLapMs: 90000 + position,
  pointsAdjust: 0,
  laps: 10,
  ...extra,
});
const race = (id, round, results, extra = {}) => ({ id, round, name: `R${round}`, track: `T${round}`, pointsMultiplier: 1, results, qualifying: [], ...extra });

describe("points rules", () => {
  it("adds the sprint to the round with its own table", () => {
    const r1 = race(1, 1, [res(ann, 1), res(bob, 2), res(bob, 1, { session: "SPRINT" }), res(ann, 2, { session: "SPRINT" })], { hasSprint: true });
    const s = buildStandings([r1], S);
    expect(s.drivers.map((d) => [d.name, d.points])).toEqual([
      ["Ann", 32],
      ["Bob", 26],
    ]);
    expect(s.drivers[1].rounds[1]).toMatchObject({ points: 26, position: 2, sprint: { position: 1, points: 8 } });
  });

  it("uses a round's own table, then the season's, then the league's", () => {
    expect(tablesFor({ pointsTable: "[50,40]" }, { pointsTable: "[10,5]" }, S).FEATURE).toEqual([50, 40]);
    expect(tablesFor({}, { pointsTable: "[10,5]", sprintPointsTable: "[3,2,1]" }, S)).toEqual({ FEATURE: [10, 5], SPRINT: [3, 2, 1] });
    expect(tablesFor({}, null, S).FEATURE).toEqual(DEFAULTS.pointsTable);
  });

  it("drops each driver's worst rounds, a round not raced counting as 0", () => {
    const races = [race(1, 1, [res(ann, 1), res(bob, 2)]), race(2, 2, [res(bob, 1)]), race(3, 3, [res(ann, 2), res(bob, 3)])];
    const s = buildStandings(races, S, { season: { dropWorst: 1 } });
    const a = s.drivers.find((d) => d.name === "Ann");
    const b = s.drivers.find((d) => d.name === "Bob");
    expect(a.points).toBe(43); // 25 + 18, the missing round 2 dropped
    expect(b.points).toBe(43); // 18 + 25, the 15 of round 3 dropped
    expect(b.rounds[3].dropped).toBe(true);
    expect(a.rounds[1].dropped).toBeUndefined();
  });

  it("adds manual points and puts a champion named by hand on top", () => {
    const races = [race(1, 1, [res(ann, 1), res(bob, 2)])];
    const s = buildStandings(races, S, { season: { championId: 2, championNote: "Title by stewards' decision" }, manualPoints: [{ driverId: 2, points: 3, note: "Pole award" }] });
    expect(s.drivers[0]).toMatchObject({ name: "Bob", points: 21, champion: true, manual: 3, manualNotes: ["Pole award"], position: 1 });
    expect(s.drivers[1]).toMatchObject({ name: "Ann", position: 2 });
  });

  it("gives the cumulative points per round for the charts", () => {
    const races = [race(1, 1, [res(ann, 1), res(bob, 2)]), race(2, 2, [res(bob, 1), res(ann, 3)]), race(3, 3, [])];
    const { progression } = buildStandings(races, S);
    expect(progression.rounds.map((r) => r.round)).toEqual([1, 2]);
    expect(progression.drivers.find((d) => d.name === "Ann").values).toEqual([25, 40]);
    expect(progression.teams[0].values).toEqual([43, 83]);
  });
});

describe("penalties", () => {
  it("re-orders finishers by time plus penalty, leaving the rest", () => {
    const rows = [
      { id: 1, position: 1, status: "FIN", laps: 10, totalTimeMs: 1000, penaltyMs: 5000 },
      { id: 2, position: 2, status: "FIN", laps: 10, totalTimeMs: 3000, penaltyMs: 0 },
      { id: 3, position: 3, status: "FIN", laps: 9, totalTimeMs: 900, penaltyMs: 0 },
      { id: 4, position: 4, status: "DNF", laps: 5, totalTimeMs: 400, penaltyMs: 0 },
    ];
    expect(orderWithPenalties(rows).map((r) => r.id)).toEqual([2, 1, 3, 4]);
  });
});

describe("driver stats", () => {
  const races = [
    race(1, 1, [res(ann, 1, { grid: 3 }), res(bob, 2, { grid: 1 })], { qualifying: [{ driverId: 2, position: 1 }, { driverId: 1, position: 2 }] }),
    race(2, 2, [res(bob, 1, { grid: 2 }), res(ann, 2, { status: "DNF", grid: 1 })]),
  ];

  it("counts wins, poles, places gained and the form", () => {
    const { stats, form } = driverSeasonStats(1, races, S, null);
    expect(stats).toMatchObject({ starts: 2, wins: 1, podiums: 1, poles: 1, dnfs: 1, bestFinish: 1, placesGained: 2 });
    expect(form.map((f) => f.finish.position)).toEqual([1, 2]);
    expect(poleDriverId(races[0])).toBe(2);
  });

  it("compares two drivers", () => {
    const h = headToHead(1, 2, races, S, null);
    expect(h.race).toEqual({ a: 1, b: 1 });
    expect(h.quali).toEqual({ a: 0, b: 1 });
    expect(h.points).toEqual({ a: 25, b: 43 });
  });
});

describe("transfers and attendance", () => {
  it("finds the team at a round", () => {
    const entry = { teamId: 1 };
    const transfers = [
      { id: 1, fromRound: 3, teamId: 2 },
      { id: 2, fromRound: 5, teamId: null },
    ];
    expect([1, 3, 4, 5, 9].map((r) => teamAt({ entry, transfers }, r))).toEqual([1, 2, 2, null, null]);
  });

  it("lists who raced, who answered and who did not show", () => {
    const races = [race(1, 1, [res(ann, 1), res(bob, 2, { status: "DNS" })]), race(2, 2, [])];
    const a = attendance({
      races,
      entries: [{ driverId: 1, driver: { name: "Ann", userId: 10 } }, { driverId: 2, driver: { name: "Bob", userId: 11 } }],
      signups: [
        { raceId: 1, userId: 11, status: "in" },
        { raceId: 2, userId: 10, status: "maybe" },
        { raceId: 1, userId: 12, status: "out", user: { name: "Dee" } },
      ],
    });
    const by = Object.fromEntries(a.rows.map((r) => [r.name, r]));
    expect(by.Ann).toMatchObject({ raced: 1, answered: 1, noShows: 0 });
    expect(by.Bob).toMatchObject({ raced: 0, answered: 1, noShows: 1 });
    expect(by.Dee).toMatchObject({ raced: 0, answered: 1 });
  });
});
