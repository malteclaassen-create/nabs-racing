import { test } from "node:test";
import assert from "node:assert/strict";
import { nth, rankText, resultLine, resultHeadline, journeyLine, neighbourLine, roundsLine, bestLine, climbLine, contactLine, duelLines, sourceLine } from "./copy.mjs";

const base = (over = {}) => ({
  season: { complete: true, roundsRun: 10, ...over.season },
  championship: {
    position: 4,
    fieldSize: 19,
    ahead: { name: "Takoda", position: 3, gap: 36, races: 7, ahead: 4, behind: 3 },
    behind: { name: "Pizd", position: 5, gap: 1, races: 8, ahead: 5, behind: 3 },
    journey: [
      { round: 2, track: "Mugello", position: 8 },
      { round: 6, track: "Jeddah", position: 2 },
      { round: 10, track: "Turkey", position: 4 },
    ],
    peak: { round: 6, track: "Jeddah", position: 2 },
    roundsLed: 0,
    ...over.championship,
  },
  rounds: over.rounds || [],
});

test("ordinals", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(nth), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
});

test("a rank says the field it was taken in, and when it is shared", () => {
  assert.equal(rankText({ rank: 4, of: 19, shared: false }), "4th of 19");
  assert.equal(rankText({ rank: 2, of: 19, shared: true }), "joint 2nd of 19");
  assert.equal(rankText(null), null);
});

test("the result line names the field and the gap to the car ahead", () => {
  assert.equal(resultLine(base()), "P4 of the 19 drivers who raced. 36 points behind Takoda in P3.");
  assert.equal(resultLine(base({ season: { complete: false } })), "P4 of the 19 drivers who have raced so far. 36 points behind Takoda in P3.");
});

test("a champion is set against the runner-up, in the singular when it is one point", () => {
  const r = base({ championship: { position: 1, ahead: null } });
  assert.equal(resultLine(r), "Champion, 1 point ahead of Pizd.");
  assert.equal(resultHeadline(r), "Champion");
  assert.equal(resultHeadline(base({ season: { complete: false }, championship: { position: 1 } })), "Leading after round 10");
});

test("headlines for the rest of the table", () => {
  assert.equal(resultHeadline(base()), "4th in the championship");
  assert.equal(resultHeadline(base({ championship: { position: 2 } })), "Runner-up");
  assert.equal(resultHeadline(base({ season: { complete: false } })), "4th after round 10");
});

test("the journey: where it began, ended, and the best place in between", () => {
  assert.equal(journeyLine(base()), "P8 after R2 Mugello, P4 at the end. Best place: P2 after R6 Jeddah.");
  const flat = base({ championship: { journey: [{ round: 1, track: "A", position: 3 }, { round: 2, track: "B", position: 3 }], peak: { round: 1, track: "A", position: 3 } } });
  assert.equal(journeyLine(flat), "P3 after R1 A, P3 at the end.");
  assert.equal(journeyLine(base({ championship: { journey: [{ round: 1, position: 2 }] } })), null);
});

test("the neighbours in the table", () => {
  assert.equal(neighbourLine(base().championship.ahead), "Takoda finished P3, 36 points up. Ahead on track in 4 of the 7 races both finished.");
  assert.equal(neighbourLine(base().championship.behind, { ahead: false }), "Pizd finished P5, 1 point back. Ahead on track in 5 of the 8 races both finished.");
});

test("the rounds line counts the scoring rounds, retirements, misses and drops", () => {
  const rounds = [
    { round: 1, track: "Melbourne", status: "DNS", points: 0, dropped: true },
    { round: 2, track: "Mugello", status: "FINISHED", points: 30 },
    { round: 3, track: "Most", status: "DNF", points: 0 },
    { round: 4, track: "Bahrain", status: "FINISHED", points: 0, dropped: true },
  ];
  assert.equal(roundsLine(base({ rounds })), "Points in 1 of 4 rounds. The one DNF was R3 Most. Missed 1 round. Dropped under the rules: R1 Melbourne, R4 Bahrain.");
});

test("best round and climb", () => {
  assert.equal(bestLine({ grid: 7, position: 1, points: 35, sprint: false }), "Started P7, finished P1. 35 points.");
  assert.equal(bestLine({ grid: null, position: 2, points: 1, sprint: true }), "Finished P2 in the sprint. 1 point.");
  assert.equal(climbLine({ round: 2, track: "Mugello", grid: 14, position: 2, gained: 12 }), "R2 Mugello: P14 to P2, 12 places made up.");
});

test("contact summary", () => {
  assert.equal(contactLine({ cars: 14, races: 10, scenery: 6, clean: 3 }), "14 contacts with other cars in 10 races, 6 with the scenery. 3 of the 10 without touching another car.");
  assert.equal(contactLine({ cars: 1, races: 1, scenery: 0, clean: 0 }), "1 contact with other cars in 1 race, 0 with the scenery.");
});

test("a team-mate duel leaves out a score line there is nothing behind", () => {
  const lines = duelLines({ races: 7, ahead: 5, behind: 2, starts: 0, qualiAhead: 0, qualiBehind: 0, myPoints: 120, points: 90 });
  assert.deepEqual(lines.map((l) => l.key), ["races", "points"]);
  assert.equal(lines[0].note, "of 7 races both finished");
});

test("the source note says what the page was made from", () => {
  assert.equal(sourceLine({ rounds: [{ contacts: 1 }, { contacts: null }] }), "From the league's results for 2 rounds, and the race server's files for 1 of them. Contacts under 10 km/h are not counted.");
  assert.equal(sourceLine({ rounds: [{ contacts: null }] }), "From the league's results for 1 round.");
});
