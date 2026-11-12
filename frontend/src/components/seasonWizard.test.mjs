import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fieldStep,
  formForSource,
  groupBySeries,
  initialForm,
  nextSeasonNumber,
  otherChampionshipSeasons,
  parseTable,
  resolveSource,
  scoringFrom,
} from "./seasonWizard.mjs";

// Shaped like /api/admin/seasons rows: newest first, each with its series.
const season = (id, number, seriesId, seriesName, extra = {}) => ({
  id,
  number,
  name: `Season ${number}`,
  seriesId,
  seriesName,
  seriesKind: null,
  isActive: false,
  dropWorst: 3,
  pointsTable: null,
  teamDropWorst: null,
  teamDropMode: null,
  fastestLapPoints: 0,
  ...extra,
});

const DIV1 = [
  season("d1s8", 8, "div1", "Div 1", { isActive: true, pointsTable: "[25,18,15]", fastestLapPoints: 1 }),
  season("d1s7", 7, "div1", "Div 1"),
];
const SUNDAY = [season("gt2", 2, "gt", "Sunday GT", { isActive: true }), season("gt1", 1, "gt", "Sunday GT")];
const EVENT = [season("ev1", 1, "oval", "Oval Night", { seriesKind: "event", isActive: true })];
const ALL = [...DIV1, ...SUNDAY, ...EVENT];

// --- parseTable --------------------------------------------------------------

test("a points table string becomes an array", () => {
  assert.deepEqual(parseTable("[25,18,15]"), [25, 18, 15]);
});

test("an array points table stays as it is", () => {
  const t = [10, 8, 6];
  assert.equal(parseTable(t), t);
});

test("no points table means the league default", () => {
  assert.equal(parseTable(null), null);
  assert.equal(parseTable(undefined), null);
  assert.equal(parseTable(""), null);
});

test("a broken or non-list points table is treated as none", () => {
  assert.equal(parseTable("[25,18"), null);
  assert.equal(parseTable('{"p1":25}'), null);
  assert.equal(parseTable("42"), null);
});

// --- nextSeasonNumber / initialForm -----------------------------------------

test("the next season is one past the highest, whatever the order", () => {
  assert.equal(nextSeasonNumber(DIV1), 9);
  assert.equal(nextSeasonNumber([season("a", 3, "x", "X"), season("b", 11, "x", "X"), season("c", 5, "x", "X")]), 12);
});

test("an empty series starts at Season 1", () => {
  assert.equal(nextSeasonNumber([]), 1);
  assert.equal(nextSeasonNumber(null), 1);
});

test("the guide starts from the active season, numbered next", () => {
  assert.deepEqual(initialForm(DIV1), {
    fromId: "d1s8",
    number: "9",
    name: "Season 9",
    game: "",
    keepScoring: true,
  });
});

test("with no active season it starts from the newest", () => {
  const list = [season("d1s8", 8, "div1", "Div 1"), season("d1s7", 7, "div1", "Div 1")];
  assert.equal(initialForm(list).fromId, "d1s8");
});

test("a brand-new series starts from nothing as Season 1", () => {
  assert.deepEqual(initialForm([]), { fromId: "", number: "1", name: "Season 1", game: "", keepScoring: true });
});

// --- otherChampionshipSeasons / groupBySeries -------------------------------

test("the other championships' seasons are offered, not this series' own", () => {
  const ids = otherChampionshipSeasons(ALL, DIV1).map((s) => s.id);
  assert.deepEqual(ids, ["gt2", "gt1"]);
});

test("special events are never something to follow on from", () => {
  const ids = otherChampionshipSeasons(ALL, []).map((s) => s.id);
  assert.ok(!ids.includes("ev1"));
  assert.deepEqual(ids, ["d1s8", "d1s7", "gt2", "gt1"]);
});

test("a new division sees every championship season", () => {
  assert.equal(otherChampionshipSeasons(ALL, []).length, 4);
});

test("nothing loaded yet means nothing offered", () => {
  assert.deepEqual(otherChampionshipSeasons(null, DIV1), []);
  assert.deepEqual(otherChampionshipSeasons(undefined, undefined), []);
});

test("the picker groups the seasons by series, in the order they came", () => {
  const groups = groupBySeries(otherChampionshipSeasons(ALL, []));
  assert.deepEqual(
    groups.map((g) => [g.name, g.seasons.map((s) => s.id)]),
    [
      ["Div 1", ["d1s8", "d1s7"]],
      ["Sunday GT", ["gt2", "gt1"]],
    ]
  );
});

test("a season whose series has no name still gets a group", () => {
  const groups = groupBySeries([season("x1", 1, null, null)]);
  assert.deepEqual(groups, [{ seriesId: null, name: "Other series", seasons: [groups[0].seasons[0]] }]);
});

test("no seasons, no groups", () => {
  assert.deepEqual(groupBySeries([]), []);
  assert.deepEqual(groupBySeries(null), []);
});

// --- resolveSource -----------------------------------------------------------

test("a season of this series is a normal rollover", () => {
  const r = resolveSource(DIV1, SUNDAY, "d1s8");
  assert.equal(r.source.id, "d1s8");
  assert.equal(r.crossSeries, false);
  assert.equal(r.sourceName, "Season 8");
});

test("another series' season is named with its series", () => {
  // Div 2 has no seasons yet and starts next to Div 1's Season 8.
  const r = resolveSource([], otherChampionshipSeasons(ALL, []), "d1s8");
  assert.equal(r.source.id, "d1s8");
  assert.equal(r.crossSeries, true);
  assert.equal(r.sourceName, "Div 1 Season 8");
});

test("a fresh start has no source", () => {
  assert.deepEqual(resolveSource(DIV1, SUNDAY, ""), { source: null, crossSeries: false, sourceName: "" });
  assert.deepEqual(resolveSource(DIV1, SUNDAY, null), { source: null, crossSeries: false, sourceName: "" });
});

test("a source that is not loaded (yet, or any more) is no source", () => {
  // The guide remembers the source across reloads; until the other series'
  // seasons arrive, or after that season was deleted, it must not guess.
  assert.deepEqual(resolveSource([], [], "d1s8"), { source: null, crossSeries: false, sourceName: "" });
});

test("this series' own season wins if both lists somehow hold it", () => {
  assert.equal(resolveSource(DIV1, DIV1, "d1s7").crossSeries, false);
});

test("a series without a name reads as another series", () => {
  assert.equal(resolveSource([], [season("x1", 4, null, null)], "x1").sourceName, "Other series Season 4");
});

// --- formForSource -----------------------------------------------------------

test("a new division takes the number and name of the season it starts next to", () => {
  const form = initialForm([]);
  const next = formForSource(form, "d1s8", [], otherChampionshipSeasons(ALL, []));
  assert.deepEqual(next, { ...form, fromId: "d1s8", number: "8", name: "Season 8" });
});

test("a series with seasons of its own keeps its own numbering", () => {
  const form = initialForm(SUNDAY);
  const next = formForSource(form, "d1s8", SUNDAY, otherChampionshipSeasons(ALL, SUNDAY));
  assert.equal(next.fromId, "d1s8");
  assert.equal(next.number, "3");
  assert.equal(next.name, "Season 3");
});

test("picking one of this series' seasons only changes the source", () => {
  const form = { ...initialForm(DIV1), name: "The 2008 season", game: "F1 2008" };
  assert.deepEqual(formForSource(form, "d1s7", DIV1, SUNDAY), { ...form, fromId: "d1s7" });
});

test("going back to a fresh start keeps what was typed", () => {
  const form = { ...initialForm([]), fromId: "d1s8", number: "8", name: "Season 8" };
  assert.deepEqual(formForSource(form, "", [], DIV1), { ...form, fromId: "" });
});

test("picking does not change the form it was given", () => {
  const form = initialForm([]);
  const copy = { ...form };
  formForSource(form, "d1s8", [], DIV1);
  assert.deepEqual(form, copy);
});

// --- scoringFrom -------------------------------------------------------------

test("the new season takes the points table and dropped rounds", () => {
  assert.deepEqual(scoringFrom(DIV1[0]), { dropWorst: 3, pointsTable: [25, 18, 15], fastestLapPoints: 1 });
});

test("a second division gets the first division's points the same way", () => {
  const { source } = resolveSource([], otherChampionshipSeasons(ALL, []), "d1s8");
  assert.deepEqual(scoringFrom(source, true), scoringFrom(DIV1[0], true));
});

test("the team drop rule comes along when the source has one", () => {
  const s = season("x", 1, "x", "X", { teamDropWorst: 2, teamDropMode: "rounds" });
  assert.deepEqual(scoringFrom(s), { dropWorst: 3, pointsTable: null, teamDropWorst: 2, teamDropMode: "rounds" });
});

test("a team drop of 0 is a rule too, and comes along", () => {
  const s = season("x", 1, "x", "X", { teamDropWorst: 0 });
  assert.equal(scoringFrom(s).teamDropWorst, 0);
});

test("a source using the defaults sends just the defaults", () => {
  assert.deepEqual(scoringFrom(DIV1[1]), { dropWorst: 3, pointsTable: null });
});

test("every round counting is kept as 0, not dropped", () => {
  assert.equal(scoringFrom(season("x", 1, "x", "X", { dropWorst: 0 })).dropWorst, 0);
});

test("unticking the box or having no source sends no scoring", () => {
  assert.deepEqual(scoringFrom(DIV1[0], false), {});
  assert.deepEqual(scoringFrom(null), {});
  assert.deepEqual(scoringFrom(undefined, true), {});
});

// --- fieldStep ---------------------------------------------------------------

test("from another series, only its teams are offered", () => {
  assert.equal(fieldStep({ teams: 0, drivers: 0, source: DIV1[0], crossSeries: true }), "teams-from-other");
});

test("from this series, teams and drivers can both be copied", () => {
  assert.equal(fieldStep({ teams: 0, drivers: 0, source: DIV1[1], crossSeries: false }), "copy-from-source");
});

test("with no source the teams go in by hand", () => {
  assert.equal(fieldStep({ teams: 0, drivers: 0, source: null }), "teams-by-hand");
  assert.equal(fieldStep({}), "teams-by-hand");
  assert.equal(fieldStep(), "teams-by-hand");
});

test("once a second division's teams are in, its drivers go in by hand", () => {
  // Never "drivers from Div 1": they are Div 1's people.
  assert.equal(fieldStep({ teams: 11, drivers: 0, source: DIV1[0], crossSeries: true }), "drivers-by-hand");
});

test("once a rollover's teams are in, the old season's drivers can follow", () => {
  assert.equal(fieldStep({ teams: 11, drivers: 0, source: DIV1[1], crossSeries: false }), "drivers-from-source");
});

test("teams in and no source: drivers by hand", () => {
  assert.equal(fieldStep({ teams: 11, drivers: 0, source: null }), "drivers-by-hand");
});

test("teams and drivers in: just a check, from wherever they came", () => {
  assert.equal(fieldStep({ teams: 11, drivers: 22, source: DIV1[0], crossSeries: true }), "check");
  assert.equal(fieldStep({ teams: 11, drivers: 22, source: DIV1[1] }), "check");
  assert.equal(fieldStep({ teams: 11, drivers: 22 }), "check");
});

test("drivers without teams still need the teams first", () => {
  // Drivers can sit in a season with no teams only by hand-made accident; the
  // guide still asks for teams.
  assert.equal(fieldStep({ teams: 0, drivers: 5, source: DIV1[0], crossSeries: true }), "teams-from-other");
  assert.equal(fieldStep({ teams: 0, drivers: 5 }), "teams-by-hand");
});
