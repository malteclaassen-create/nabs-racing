import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTalkingPoints, driverSeason, plainFact, titleMath, tonight } from "./streamNotes.js";

// A standings row with the given points per round (index 0 = round 1) and,
// optionally, finishing positions.
const row = (name, points, positions = []) => ({
  driverId: name.toLowerCase(),
  name,
  tier: 1,
  perRace: Object.fromEntries(
    points.map((p, i) => [i + 1, { points: p, status: "FINISHED", position: positions[i] ?? null, grid: null }])
  ),
});

const TABLE = [25, 18, 15, 12, 10];
const base = (standings, completed, rounds, extra = {}) =>
  titleMath({
    standings,
    raceNumbers: Array.from({ length: rounds }, (_, i) => i + 1),
    completedNumbers: Array.from({ length: completed }, (_, i) => i + 1),
    totalRounds: rounds,
    tableMax: TABLE[0],
    ...extra,
  });

test("who is still alive follows the points left, ties included", () => {
  // Two rounds to go, 50 pts on the table: 50 behind is alive (a tie), 51 is out.
  const m = base([row("Ann", [25, 25, 25]), row("Ben", [10, 10, 5]), row("Cid", [8, 8, 8])], 3, 5);
  assert.equal(m.potential, 50);
  assert.deepEqual(m.alive.map((r) => r.d.name), ["Ann", "Ben"]);
  assert.equal(m.decided, false);
});

test("a title nobody can reach any more is decided", () => {
  const m = base([row("Ann", [25, 25, 25]), row("Ben", [10, 10, 10])], 3, 4);
  assert.equal(m.decided, true);
  assert.equal(tonight(m, 4, { table: TABLE }), null);
});

test("the leader's clinching finish is priced against the rival's best night", () => {
  // Round 4 of 5 tonight. Ann 75, Ben 48. Ben's best: 48 + 25 tonight + 25 = 98
  // if Ann does not win; 48 + 18 + 25 = 91 if she does.
  const m = base([row("Ann", [25, 25, 25]), row("Ben", [18, 18, 12])], 3, 5);
  const n = tonight(m, 4, { table: TABLE });
  // Ann + P1 = 100 > 91: a win does it. Ann + P2 = 93 < 98: not enough.
  assert.equal(n.clinchPosition, 1);
  assert.equal(n.clinchPossible, true);
  assert.equal(n.earliest, 4);
  assert.equal(n.chaseLimit, 25);
  assert.deepEqual(n.atRisk.map((r) => r.d.name), ["Ben"]);
});

test("no clinch tonight when even the best case leaves the rival in reach", () => {
  const m = base([row("Ann", [25]), row("Ben", [18])], 1, 5);
  const n = tonight(m, 2, { table: TABLE });
  assert.equal(n.clinchPosition, null);
  assert.equal(n.clinchPossible, false);
  assert.deepEqual(n.atRisk, []);
  // Ann maxing every round with Ben on zero: 25 + 25k > 18 + 25 (4 - k) from k = 2.
  assert.equal(n.earliest, 3);
});

test("a sprint weekend pays twice and the clinch asks for both races", () => {
  const m = base([row("Ann", [25, 25]), row("Ben", [5, 5])], 2, 4, { sprintRounds: [3] });
  assert.equal(m.maxFor(3), 50);
  const n = tonight(m, 3, { table: TABLE });
  assert.equal(n.sprint, true);
  // Ann 50 + 2×P2 (36) = 86 against Ben 10 + 2×25 + 25 = 85: P2 in both is
  // enough, P3 in both (80) is not.
  assert.equal(n.clinchPosition, 2);
});

test("a dropped round is part of the maths", () => {
  // One drop: Ben's zero in round 1 goes, so he is closer than the raw totals say.
  const standings = [row("Ann", [25, 25]), row("Ben", [0, 18])];
  const m = base(standings, 2, 4, { dropWorst: 1 });
  // Ann's floor: best 3 of [25, 25, 0, 0] = 50. Ben's best: best 3 of [0, 18, 25, 25] = 68.
  assert.equal(m.leader.cur, 50);
  assert.equal(m.rows[1].best, 68);
  assert.equal(tonight(m, 3, { table: TABLE }).chaseLimit, null);
});

test("a driver's season counts sprint wins and the last three rounds", () => {
  const d = row("Ann", [25, 0, 18, 25], [1, null, 2, 1]);
  d.perRace[2].status = "DNF";
  d.perRace[4].sprint = { points: 10, status: "FINISHED", position: 1 };
  d.perRace[1].grid = 1;
  const s = driverSeason(d, [1, 2, 3, 4]);
  assert.equal(s.wins, 3);
  assert.equal(s.podiums, 4);
  assert.equal(s.poles, 1);
  assert.equal(s.best, 1);
  assert.equal(s.pointsStreak, 2);
  assert.deepEqual(s.form, ["DNF", "P2", "P1"]);
  // A finish stored without a position (points-only archive rows).
  d.perRace[3].position = null;
  assert.deepEqual(driverSeason(d, [1, 2, 3, 4]).form, ["DNF", "Fin", "P1"]);
});

test("the talking points tell the title, the track and the season", () => {
  const standings = [row("Ann", [25, 25], [1, 1]), row("Ben", [18, 18], [2, 2])].map((d, i) => ({ ...d, position: i + 1 }));
  const m = base(standings, 2, 4);
  const races = [1, 2, 3, 4].map((n) => ({
    id: `r${n}`,
    number: n,
    track: ["Monza", "Spa", "Imola", "Suzuka"][n - 1],
    isCompleted: n <= 2,
    type: "CHAMPIONSHIP",
    winner: n <= 2 ? { driverId: "ann", name: "Ann" } : null,
  }));
  const history = {
    track: "Imola",
    editions: [{ seasonNumber: 6, raceNumber: 4, winner: { driverId: "old-ben", name: "Ben" }, poleman: { driverId: "old-ben", name: "Ben" } }],
    stats: { fastestLap: { name: "Cid", ms: 75123, seasonNumber: 6 } },
    customFacts: [{ label: "Longest straight", value: "1.2 km" }],
  };
  const facts = buildTalkingPoints({
    standings,
    races,
    math: m,
    night: tonight(m, 3, { table: TABLE }),
    race: races[2],
    history,
  });
  const text = Object.fromEntries(facts.map((f) => [f.key, plainFact(f.text)]));
  assert.equal(text.round, "Round 3 of 4: 1 round to go after this one.");
  assert.equal(text.lead, "Ann leads the championship by 14 pts over Ben.");
  assert.equal(text.alive, "It is a two-horse race: only Ann and Ben can still win the title.");
  // Ann 75 with a win against Ben's best of 36 + 18 + 25 = 79: not on her own.
  assert.equal(text.clinch, "Ann can wrap up the title tonight, but only if the chasers have a bad night.");
  assert.equal(text.limit, "To stay in it, a chaser must be no more than 25 pts behind Ann after tonight.");
  assert.equal(text.visits, "This is the 2nd time the league races at Imola.");
  assert.equal(text.last, "Last time here (Season 6, round 4): Ben won, from pole.");
  assert.equal(text.lap, "The fastest race lap here is 1:15.123 by Cid (Season 6).");
  assert.equal(text.winners, "Ben is the only driver in this season's field who has won here before.");
  assert.equal(text["custom-0"], "Longest straight: 1.2 km");
  assert.equal(text.seasonwinners, "Ann has won every round so far.");
  assert.equal(text.lastwin, "Last round, Ann won at Spa.");
  assert.equal(text["nowin-ben"], "Ben is P2 in the championship without a win yet (best finish this season: P2).");
  assert.equal(text.mostwins, "Ann has the most wins this season: 2.");
  // Two wins in two rounds is "every round", not also a winning streak.
  assert.equal(text.streak, undefined);
  // Every key is its own, so the page can use them as React keys.
  assert.equal(new Set(facts.map((f) => f.key)).size, facts.length);
  assert.ok(facts.find((f) => f.key === "lead").text.includes("**Ann**"));
});
