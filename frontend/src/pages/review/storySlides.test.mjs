import { test } from "node:test";
import assert from "node:assert/strict";
import { storySlides, summaryGrid, podiumsOf, topResults, quizOptions, pickPhoto } from "./storySlides.mjs";

const review = (over = {}) => ({
  season: { label: "Season 7", complete: true, roundsRun: 10, totalRounds: 10 },
  driver: { name: "Maltegoat", team: { name: "Williams" } },
  stats: { starts: 8, finishes: 8, dnf: 0, wins: 1, podiums: 4, poles: 0, fastestLaps: 2, overtakes: 35, lapsLed: 21, avgFinish: 4.9, dotd: 0, ...over.stats },
  ranks: { podiums: { rank: 2, of: 73, shared: true }, overtakes: { rank: 2, of: 64 }, lapsLed: { rank: 4, of: 64 }, fastestLaps: { rank: 1, of: 73, shared: true }, wins: { rank: 5, of: 73, shared: true }, ...over.ranks },
  championship: {
    position: 4,
    fieldSize: 73,
    points: 175,
    ahead: { name: "Takoda", position: 3, gap: 36 },
    journey: [
      { round: 2, track: "Mugello", position: 8 },
      { round: 6, track: "Jeddah", position: 2 },
      { round: 10, track: "Turkey", position: 4 },
    ],
    peak: { round: 6, track: "Jeddah", position: 2 },
    ...over.championship,
  },
  rounds: over.rounds || [
    { round: 1, track: "Melbourne", status: "DNS" },
    { round: 2, track: "Mugello", status: "FINISHED", position: 2, sprint: { status: "FINISHED", position: 3 } },
    { round: 6, track: "Jeddah", status: "FINISHED", position: 1 },
    { round: 7, track: "Spa", status: "FINISHED", position: 9 },
  ],
  best: "best" in over ? over.best : { round: 6, track: "Jeddah", raceId: "j", sprint: false, position: 1, grid: 7, points: 35 },
  climb: "climb" in over ? over.climb : { round: 2, track: "Mugello", raceId: "m", sprint: false, grid: 14, position: 2, gained: 12 },
  teammates: over.teammates || [{ name: "Pizd", races: 8, ahead: 5, behind: 3, starts: 8, qualiAhead: 6, qualiBehind: 2, myPoints: 175, points: 163 }],
  contact: "contact" in over ? over.contact : { races: 6, cars: 8, scenery: 6, clean: 4 },
  honours: over.honours || [],
  awards: over.awards || [],
});

test("a full season runs intro to final, one moment per slide", () => {
  assert.deepEqual(storySlides(review()).map((s) => s.key), ["intro", "rounds", "quiz", "top", "best", "climb", "passes", "podiums", "led", "field", "journey", "team", "hits", "contact", "final"]);
});

test("slides whose moment the season does not have are left out", () => {
  const thin = review({ best: null, climb: null, contact: null, teammates: [], stats: { podiums: 0, overtakes: null, lapsLed: null, fastestLaps: 0, wins: 0 }, rounds: [{ round: 1, track: "A", status: "FINISHED", position: 9 }], championship: { journey: [] } });
  assert.deepEqual(storySlides(thin).map((s) => s.key), ["intro", "rounds", "final"]);
});

test("the climb is not told twice when it is the best result", () => {
  const same = review({ climb: { round: 6, track: "Jeddah", raceId: "j", sprint: false, grid: 7, position: 1, gained: 6 } });
  assert.ok(!storySlides(same).some((s) => s.key === "climb"));
});

test("podiums count sprints too, in round order", () => {
  const p = podiumsOf(review().rounds);
  assert.deepEqual(p.map((x) => [x.round, x.position, x.sprint]), [[2, 2, false], [2, 3, true], [6, 1, false]]);
  const slide = storySlides(review()).find((s) => s.key === "podiums");
  assert.equal(slide.value, 3);
  assert.equal(slide.line, "joint 2nd of 73 in the field.");
});

test("the field slide picks the best ranked figures, leaving out those with a slide of their own", () => {
  const f = storySlides(review()).find((s) => s.key === "field");
  assert.deepEqual(f.figures.map((x) => x.k), ["fastestLaps", "wins"]);
  assert.equal(f.figures[0].rankText, "joint 1st of 73");
});

test("the rounds slide counts starts against the rounds run", () => {
  const r = storySlides(review()).find((s) => s.key === "rounds");
  assert.equal(r.value, 8);
  assert.equal(r.unit, "of 4 rounds");
  assert.equal(r.line, "8 finished, 1 missed.");
});

test("the summary grid never has a hole", () => {
  const g = summaryGrid(review({ stats: { poles: 0, fastestLaps: 0 } }));
  assert.equal(g.length, 6);
  assert.deepEqual(g.map((c) => c.k), ["wins", "podiums", "best", "mate", "finishes", "ot"]);
});

test("the team-mate slide says who is ahead on points", () => {
  const t = storySlides(review()).find((s) => s.key === "team");
  assert.equal(t.line, "You finished 12 points ahead.");
});

test("a running season says so", () => {
  const s = storySlides(review({ championship: {} }));
  const run = storySlides({ ...review(), season: { label: "Season 8", complete: false, roundsRun: 9, totalRounds: 12 } });
  assert.equal(run[0].eyebrow, "Season review · Season 8 so far");
  assert.equal(run[0].line, "Williams · 9 of 12 rounds run");
  assert.ok(s.length > 0);
});

test("the top results rank best place first, sprints included", () => {
  const t = topResults(review().rounds);
  assert.deepEqual(t.map((x) => [x.round, x.position, x.sprint]), [[6, 1, false], [2, 2, false], [2, 3, true], [7, 9, false]]);
});

test("training, tyres and track limits join when the season has them, a quickest lap does not", () => {
  const r = { ...review(), training: { laps: 900, weeks: 10, rank: { rank: 1, of: 40 } }, boards: { training: { of: 40, rows: [] } }, tyres: [{ tyre: "M", laps: 90, share: 60 }], limits: { cuts: 12, penalties: 3, races: 6 } };
  r.stats = { ...r.stats, bestLap: { bestLapMs: 92000, track: "Monza", number: 4 } };
  assert.deepEqual(storySlides(r).map((s) => s.key), ["intro", "rounds", "training", "quiz", "top", "best", "climb", "passes", "podiums", "led", "field", "tyres", "journey", "team", "hits", "contact", "limits", "final"]);
});

test("the best-race question has the answer among other circuits finished on, and needs two of them", () => {
  const q = quizOptions(review());
  assert.equal(q.length, 3);
  assert.ok(q.includes("Jeddah"));
  assert.deepEqual([...q].sort(), ["Jeddah", "Mugello", "Spa"]);
  assert.equal(quizOptions(review({ rounds: [{ round: 6, track: "Jeddah", status: "FINISHED", position: 1 }, { round: 7, track: "Spa", status: "FINISHED", position: 9 }] })), null);
});

test("a photo is only picked with the driver's own team in it, and only once", () => {
  const photos = [
    { url: "a", round: 1, kind: "solo", teams: ["ferrari"], focus: "ferrari", pair: null, quality: "hero" },
    { url: "b", round: 1, kind: "solo", teams: ["renault"], focus: "renault", pair: null, quality: "ok" },
    { url: "c", round: 2, kind: "crash", teams: ["renault", "audi"], focus: null, pair: null, quality: "hero" },
    { url: "d", round: 3, kind: "battle", teams: ["renault"], focus: null, pair: "renault", quality: "hero" },
  ];
  const r = { driver: { team: { id: "renault" } }, photos, rounds: [{ round: 1, track: "Hockenheim" }] };
  const used = new Set();
  assert.equal(pickPhoto(r, used, { rounds: [1] }).url, "b");
  assert.equal(pickPhoto(r, used, { rounds: [1] }), null);
  assert.equal(pickPhoto(r, used, { kinds: ["crash"] }).url, "c");
  assert.equal(pickPhoto(r, used, { pair: true }).url, "d");
  assert.equal(pickPhoto({ ...r, driver: { team: { id: "williams" } } }, new Set(), {}), null);
});
