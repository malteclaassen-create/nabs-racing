import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStory, summaryStats, voiceFor, hexColor, FALLBACK_PAINT } from "./wrappedStory.mjs";

// A finished season with something for every slide.
const full = () => ({
  season: { number: 7, name: "7", label: "Season 7", complete: true, roundsRun: 10, totalRounds: 10 },
  driver: { id: "d1", name: "Siggsta", number: 44, photoUrl: null, team: { id: "t1", name: "Rosso", color: "#E10600", tier: 1 } },
  championship: {
    position: 2,
    points: 163,
    fieldSize: 24,
    peak: { position: 1, round: 6, track: "monza" },
    journey: [
      { round: 1, position: 5, points: 18 },
      { round: 6, position: 1, points: 110 },
      { round: 10, position: 2, points: 163 },
    ],
    roundsLed: 1,
  },
  stats: { starts: 12, finishes: 11, wins: 2, podiums: 5, poles: 1, fastestLaps: 0, bestFinish: 1, positionsGained: 20, top10: 11 },
  best: { position: 1, track: "monza", round: 6, grid: 3, points: 25, sprint: false },
  climb: { position: 4, grid: 14, gained: 10, track: "spa", round: 3, sprint: false },
  wins: [
    { round: 6, track: "monza", sprint: false, raceId: "r6" },
    { round: 8, track: "imola", sprint: true, raceId: "r8s" },
  ],
  teammates: [{ driverId: "d2", name: "Pizd", races: 9, ahead: 6, behind: 3, qualiAhead: 5, qualiBehind: 4, myPoints: 163, points: 120 }],
  rival: { driverId: "d3", name: "Marek", position: 1, points: 170, gap: 7, races: 10, ahead: 4, behind: 6, team: { color: "#00A3E0" } },
  honours: [
    { key: "vice", title: "Runner-up", detail: "Second in the championship" },
    { key: "fastest-lap", title: "Fastest lap of the season", detail: "monza", ms: 81234 },
  ],
  type: { key: "winner", title: "The Winner", line: "2 wins from 12 starts." },
});

test("a full season gets every slide, in story order, ending on the summary", () => {
  const keys = buildStory(full()).map((s) => s.key);
  assert.deepEqual(keys, ["intro", "numbers", "best", "climb", "wins", "teammate", "rival", "journey", "final", "honours", "type", "summary"]);
});

test("the story talks to the driver only when the viewer is that driver", () => {
  const mine = buildStory(full(), { mine: true });
  const theirs = buildStory(full(), { mine: false });
  const lead = (story) => story.find((s) => s.key === "numbers").lead;
  assert.equal(lead(mine), "You lined up on the grid");
  assert.equal(lead(theirs), "Siggsta lined up on the grid");
  assert.equal(mine[0].title, "Your Season 7, wrapped.");
  assert.equal(theirs[0].title, "Siggsta's Season 7, wrapped.");
  assert.equal(mine.find((s) => s.key === "type").eyebrow, "Your racing type");
  assert.equal(theirs.find((s) => s.key === "type").eyebrow, "Siggsta's racing type");
  assert.deepEqual(voiceFor("Siggsta", true).S, "You");
});

test("slides without data are left out, the way the card page leaves out cards", () => {
  const d = full();
  d.best = null;
  d.climb = null;
  d.wins = [];
  d.stats.podiums = 0;
  d.teammates = [];
  d.rival = null;
  d.honours = [];
  d.type = null;
  d.championship.journey = [{ round: 1, position: 5, points: 18 }];
  const keys = buildStory(d).map((s) => s.key);
  assert.deepEqual(keys, ["intro", "numbers", "final", "summary"]);
});

test("the story always tells the ending: the final table, the champion crowned", () => {
  const d = full();
  d.championship.position = 1;
  const story = buildStory(d);
  assert.equal(story[0].eyebrow, "Season 7 Wrapped");
  assert.equal(story[0].sub, "10 rounds, every result: the whole season in a few taps.");
  const final = story.find((s) => s.key === "final");
  assert.equal(final.eyebrow, "The final table");
  assert.equal(final.title, "Champion.");
  assert.equal(story.find((s) => s.key === "numbers").pointsLine, "163 points in the end.");
  assert.match(story.find((s) => s.key === "journey").sub, /at the end\.$/);
  assert.ok(!JSON.stringify(story).includes("so far"));
});

test("a podium finish gets the podium scene, anything lower the grid", () => {
  const top = buildStory(full()).find((s) => s.key === "final");
  assert.equal(top.scene.kind, "podium");
  assert.equal(top.title, "Runner-up.");
  const d = full();
  d.championship.position = 9;
  const low = buildStory(d).find((s) => s.key === "final");
  assert.equal(low.scene.kind, "grid");
  assert.equal(low.scene.position, 9);
  assert.equal(low.title, null);
});

test("no wins but podiums still gets the trophy slide, about podiums", () => {
  const d = full();
  d.wins = [];
  d.stats.podiums = 3;
  d.best = { position: 2, track: "spa", round: 2, grid: 5, points: 18 };
  const s = buildStory(d).find((x) => x.key === "wins");
  assert.equal(s.eyebrow, "Podiums");
  assert.equal(s.title, "Up on the box 3 times.");
  assert.equal(s.scene.tones.length, 3);
  assert.equal(s.scene.tones[0], "silver");
});

test("a rival who is also the team-mate gets one slide, not two", () => {
  const d = full();
  d.rival = { ...d.rival, driverId: "d2", name: "Pizd" };
  const keys = buildStory(d).map((s) => s.key);
  assert.ok(keys.includes("teammate"));
  assert.ok(!keys.includes("rival"));
});

test("the rival line says who is ahead by how much", () => {
  const ahead = buildStory(full()).find((s) => s.key === "rival");
  assert.equal(ahead.detail, "P1, 7 points ahead");
  assert.equal(ahead.title, "The one to beat next season.");
  const d = full();
  d.rival.gap = -1;
  assert.equal(buildStory(d).find((s) => s.key === "rival").detail, "P1, 1 point behind");
});

test("the summary card shows six numbers, points first and starts always", () => {
  const stats = summaryStats(full());
  assert.equal(stats.length, 6);
  assert.equal(stats[0].key, "points");
  assert.equal(stats[stats.length - 1].key, "starts");
  // A quiet season fills up with what it does have, never with zeros.
  const quiet = summaryStats({ championship: { points: 3 }, stats: { starts: 4, finishes: 4, wins: 0, podiums: 0, poles: 0, bestFinish: 9, top10: 1 } });
  assert.deepEqual(
    quiet.map((s) => s.key),
    ["points", "best", "top10", "finishes", "starts"]
  );
  assert.ok(quiet.every((s) => s.key === "points" || s.value > 0));
});

test("no team means the fallback paint, and an empty Wrapped means no story", () => {
  const d = full();
  d.driver.team = null;
  assert.equal(buildStory(d)[0].scene.paint, FALLBACK_PAINT);
  assert.deepEqual(buildStory({ empty: true, driver: { name: "X" }, season: {} }), []);
  assert.deepEqual(buildStory(null), []);
});

test("track names go through the formatter the page hands in", () => {
  const story = buildStory(full(), { fmtTrack: (t) => t.toUpperCase() });
  assert.equal(story.find((s) => s.key === "best").place, "MONZA · Round 6");
  assert.deepEqual(story.find((s) => s.key === "wins").list, ["MONZA · Round 6", "IMOLA · Round 8 · Sprint"]);
});

test("team colours come out as six-digit hex, anything else as the fallback", () => {
  assert.equal(hexColor("#e10600"), "#E10600");
  assert.equal(hexColor("#f80"), "#FF8800");
  assert.equal(hexColor("rgb(1,2,3)"), null);
  assert.equal(hexColor(null), null);
  const d = full();
  d.driver.team.color = "red";
  assert.equal(buildStory(d)[0].scene.paint, FALLBACK_PAINT);
});

test("a level team-mate battle is settled by the grids, then the points", () => {
  const d = full();
  d.teammates[0] = { ...d.teammates[0], ahead: 3, behind: 3, qualiAhead: 3, qualiBehind: 3, myPoints: 220, points: 126 };
  assert.equal(buildStory(d).find((s) => s.key === "teammate").title, "Siggsta had the upper hand.");
  d.teammates[0] = { ...d.teammates[0], myPoints: 100, points: 100 };
  assert.equal(buildStory(d).find((s) => s.key === "teammate").title, "Dead even.");
});

test("podiums whose best was a third are all bronze", () => {
  const d = full();
  d.wins = [];
  d.stats.podiums = 2;
  d.best = { position: 3, track: "imola", round: 9, grid: 4, points: 25 };
  assert.deepEqual(buildStory(d).find((s) => s.key === "wins").scene.tones, ["bronze", "bronze"]);
});
