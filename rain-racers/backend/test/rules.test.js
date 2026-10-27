import { describe, it, expect } from "vitest";
import { buildStandings } from "../src/lib/standings.js";
import { orderWithPenalties, tableFor, poleDriverId, racePoints } from "../src/lib/points.js";
import { driverSeasonStats, headToHead, teamAt, attendance } from "../src/lib/stats.js";
import { DEFAULTS as LEAGUE } from "../src/lib/settings.js";

const DEFAULTS = { ...LEAGUE, pointsTable: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] };
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
  session: "R1",
  bestLapMs: 90000 + position,
  pointsAdjust: 0,
  laps: 10,
  ...extra,
});
const race = (id, round, results, extra = {}) => ({ id, round, name: `R${round}`, track: `T${round}`, pointsMultiplier: 1, results, qualifying: [], ...extra });

describe("points rules", () => {
  it("adds every race of a round, each with its own table", () => {
    // a sprint (race 1) and a feature race (race 2)
    const season = { raceTables: JSON.stringify({ 2: [[8, 7, 6, 5, 4, 3, 2, 1], null] }) };
    const r1 = race(1, 1, [res(bob, 1), res(ann, 2), res(ann, 1, { session: "R2" }), res(bob, 2, { session: "R2" })], { raceCount: 2 });
    const s = buildStandings([r1], S, { season });
    expect(s.drivers.map((d) => [d.name, d.points])).toEqual([
      ["Ann", 32],
      ["Bob", 26],
    ]);
    expect(s.drivers[1].rounds[1]).toMatchObject({ points: 26, races: [{ position: 1, points: 8 }, { position: 2, points: 18 }] });
    expect(s.rounds[0].raceCount).toBe(2);
  });

  it("uses a round's own table, then the season's for that many races, then the season's, then the league's", () => {
    const season = { pointsTable: "[10,5]", raceTables: JSON.stringify({ 2: [35, 29], 3: [null, null, [9, 8]] }) };
    expect(tableFor({ pointsTable: "[50,40]", raceCount: 2 }, season, S, 1)).toEqual([50, 40]);
    expect(tableFor({ raceCount: 2 }, season, S, 2)).toEqual([35, 29]);
    expect(tableFor({ raceCount: 3 }, season, S, 3)).toEqual([9, 8]);
    expect(tableFor({ raceCount: 3 }, season, S, 1)).toEqual([10, 5]);
    expect(tableFor({}, season, S)).toEqual([10, 5]);
    expect(tableFor({}, null, S)).toEqual(DEFAULTS.pointsTable);
  });

  it("scores back to front: the last classified driver gets 1", () => {
    const r1 = race(1, 1, [res(ann, 1), res(bob, 2), res(cat, 3), res({ id: 4, name: "Dee" }, 4, { status: "DNF" })]);
    const s = buildStandings([r1], S, { season: { pointsMode: "REVERSE" } });
    expect(s.drivers.map((d) => [d.name, d.points])).toEqual([
      ["Ann", 3],
      ["Bob", 2],
      ["Cat", 1],
      ["Dee", 0],
    ]);
  });

  it("pays qualifying points once the round is raced", () => {
    const season = { qualiPointsTable: "[10,8]" };
    const quali = [{ driverId: 2, position: 1 }, { driverId: 1, position: 2 }];
    const r1 = race(1, 1, [res(ann, 1), res(bob, 2)], { qualifying: quali });
    expect(racePoints(race(2, 2, [], { qualifying: quali }), season, S).quali.size).toBe(0);
    const s = buildStandings([r1], S, { season });
    expect(s.drivers.map((d) => [d.name, d.points])).toEqual([
      ["Ann", 33],
      ["Bob", 28],
    ]);
    expect(s.drivers[1].rounds[1]).toMatchObject({ qualiPoints: 10, points: 28 });
    expect(s.teams[0].points).toBe(61);
    // a driver who only qualified still scores the qualifying points
    const onlyQuali = buildStandings([race(2, 1, [res(ann, 1)], { qualifying: [{ driverId: 3, driver: cat, position: 1 }] })], S, { season });
    expect(onlyQuali.drivers.find((d) => d.name === "Cat")).toMatchObject({ points: 10 });
  });

  it("keeps a mystery track hidden until the round is raced", () => {
    const s = buildStandings([race(1, 1, [res(ann, 1)], { mysteryTrack: true }), race(2, 2, [], { mysteryTrack: true })], S);
    expect(s.rounds.map((r) => r.track)).toEqual(["T1", null]);
  });

  it("drops each driver's worst raced rounds once the season nears its end", () => {
    const races = [race(1, 1, [res(ann, 1), res(bob, 2)]), race(2, 2, [res(bob, 1)]), race(3, 3, [res(ann, 2), res(bob, 3)])];
    const s = buildStandings(races, S, { season: { dropWorst: 1 } });
    const a = s.drivers.find((d) => d.name === "Ann");
    const b = s.drivers.find((d) => d.name === "Bob");
    expect(a.points).toBe(25); // 25 + 18, the 18 of round 3 dropped (round 2 not raced, so not droppable)
    expect(b.points).toBe(43); // 18 + 25, the 15 of round 3 dropped
    expect(b.rounds[3].dropped).toBe(true);
    expect(a.rounds[3].dropped).toBe(true);
    // a driver who raced no more rounds than may be dropped keeps them all
    const one = buildStandings([race(1, 1, [res(ann, 1), res(bob, 2)]), race(2, 2, [res(bob, 1)])], S, { season: { dropWorst: 1 } });
    expect(one.drivers.find((d) => d.name === "Ann").points).toBe(25);
    // early in the season nothing is dropped yet: 2 of 4 rounds raced, 1 to drop
    const early = buildStandings([...races.slice(0, 2), race(4, 4, []), race(5, 5, [])], S, { season: { dropWorst: 1 } });
    expect(early.drivers.find((d) => d.name === "Bob").points).toBe(43);
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
    expect(form.map((f) => f.races[0].position)).toEqual([1, 2]);
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
