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
  assert.equal(resultHeadline(base({ season: { complete: false }, championship: { position: 1 } })), "Leading by 1 point");
});

test("headlines say what the place is worth, not the place again", () => {
  assert.equal(resultHeadline(base()), "36 points off P3");
  assert.equal(resultHeadline(base({ championship: { ahead: { name: "X", position: 3, gap: 0 } } })), "Level on points with P3");
  assert.equal(resultHeadline(base({ championship: { ahead: null } })), "4th in the championship");
});

test("the journey: where it began, ended, and the best place in between", () => {
  assert.equal(journeyLine(base()), "P8 after R2 Mugello, P4 at the end. Best place: P2 after R6 Jeddah.");
  assert.equal(journeyLine(base({ season: { complete: false } })), "P8 after R2 Mugello, P4 after R10 Turkey. Best place: P2 after R6 Jeddah.");
  const flat = base({ championship: { journey: [{ round: 1, track: "A", position: 3 }, { round: 2, track: "B", position: 3 }], peak: { round: 1, track: "A", position: 3 } } });
  assert.equal(journeyLine(flat), "P3 after R1 A, P3 at the end.");
  assert.equal(journeyLine(base({ championship: { journey: [{ round: 1, position: 2 }] } })), null);
});

test("the neighbours in the table: the reviewed driver is the one named as ahead", () => {
  assert.equal(neighbourLine(base().championship.ahead, "Maltegoat"), "Against Takoda, P3: Maltegoat finished ahead in 4 of the 7 races both finished.");
  assert.equal(neighbourLine({ ...base().championship.behind, races: 0 }, "Maltegoat"), null);
});

test("the rounds line counts the scoring rounds, retirements, misses and drops", () => {
  const rounds = [
    { round: 1, track: "Melbourne", status: "DNS", points: 0, dropped: true },
    { round: 2, track: "Mugello", status: "FINISHED", points: 30 },
    { round: 3, track: "Most", status: "DNF", points: 0 },
    { round: 4, track: "Bahrain", status: "FINISHED", points: 0, dropped: true },
  ];
  assert.equal(roundsLine(base({ rounds })), "Out of R3 Most (DNF). Did not start R1 Melbourne. Dropped under the rules: R1 Melbourne and R4 Bahrain.");
  assert.equal(roundsLine(base({ rounds: [{ round: 1, track: "A", status: "FINISHED", points: 3 }] })), "Started and finished all 1 round.");
});

test("best round and climb", () => {
  assert.equal(bestLine({ grid: 7, position: 1, points: 35, sprint: false }), "Started P7, finished P1.");
  assert.equal(bestLine({ grid: null, position: 2, points: 1, sprint: true }), "Finished P2 in the sprint.");
  assert.equal(climbLine({ round: 2, track: "Mugello", grid: 14, position: 2, gained: 12 }), "R2 Mugello: P14 to P2, 12 places made up.");
});

test("the contact line says where the contact came", () => {
  const rounds = [
    { round: 5, track: "Monza", contacts: 4 },
    { round: 8, track: "Spa", contacts: 1 },
    { round: 10, track: "Turkey", contacts: 3 },
    { round: 9, track: "Imola", contacts: 0 },
  ];
  assert.equal(contactLine({ cars: 8, rounds: 4 }, rounds), "The contact with other cars came in R5 Monza (4), R10 Turkey (3) and R8 Spa (1).");
  assert.equal(contactLine({ cars: 9, rounds: 5 }, [...rounds, { round: 11, track: "Abu Dhabi", contacts: 1 }]), "The most in one round: 4, in R5 Monza. Contact in 4 of the 5 rounds on file.");
  assert.equal(contactLine({ cars: 0, rounds: 6 }, rounds), "No contact with another car in 6 rounds on file.");
});

test("a team-mate duel leaves out a score line there is nothing behind", () => {
  const lines = duelLines({ races: 7, ahead: 5, behind: 2, starts: 0, qualiAhead: 0, qualiBehind: 0, myPoints: 120, points: 90 });
  assert.deepEqual(lines.map((l) => l.key), ["races", "points"]);
  assert.equal(lines[0].note, "ahead, 7 races both finished");
});

test("the source note says what the page was made from", () => {
  assert.equal(
    sourceLine({ rounds: [{ contacts: 1 }, { contacts: null }] }),
    "From the league's results for 2 rounds, and the race server's files for 1 of them. Contact with a car under 10 km/h and with the scenery under 15 km/h is not counted."
  );
  assert.equal(sourceLine({ rounds: [{ contacts: null }] }), "From the league's results for 1 round.");
});
