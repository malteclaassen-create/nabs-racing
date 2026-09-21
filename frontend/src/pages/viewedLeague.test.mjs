import test from "node:test";
import assert from "node:assert/strict";
import { leagueRowFor, pickedLeague, cardRowFor } from "./viewedLeague.mjs";

// The shape api.myLeagues() answers with: the login's own row first, one per
// series. This person's Discord link sits on their Friday row.
const LEAGUES = [
  { driverId: "d-fri", isActing: true, seriesSlug: "friday-cup", seriesName: "Friday Cup" },
  { driverId: "d-sun", isActing: false, seriesSlug: "sunday-championship", seriesName: "Sunday Championship" },
];

test("one league needs no choosing — the backend's own row is already right", () => {
  assert.equal(leagueRowFor([{ driverId: "d-fri", isActing: true, seriesSlug: "friday-cup" }], "friday-cup"), null);
  assert.equal(leagueRowFor([], "friday-cup"), null);
  assert.equal(leagueRowFor(null, "friday-cup"), null);
});

test("the viewed series decides, not the row the login sits on", () => {
  // The bug this exists for: viewing Sunday while the login is Friday's used
  // to show the Friday rating next to the Sunday card.
  assert.equal(leagueRowFor(LEAGUES, "sunday-championship").driverId, "d-sun");
  assert.equal(leagueRowFor(LEAGUES, "friday-cup").driverId, "d-fri");
});

test("a league the person doesn't race in falls back to their own row", () => {
  assert.equal(leagueRowFor(LEAGUES, "gt-masters").driverId, "d-fri");
  assert.equal(leagueRowFor(LEAGUES, null).driverId, "d-fri");
  // No acting flag anywhere: the first row still answers rather than nothing.
  const noActing = LEAGUES.map((l) => ({ ...l, isActing: false }));
  assert.equal(leagueRowFor(noActing, "gt-masters").driverId, "d-fri");
});

test("a pick by hand outranks the viewed series", () => {
  assert.equal(pickedLeague(LEAGUES, "sunday-championship", "d-fri").driverId, "d-fri");
  assert.equal(pickedLeague(LEAGUES, "friday-cup", "d-sun").driverId, "d-sun");
});

test("with no pick at all, the viewed series decides — the profile editor's case", () => {
  // The profile editor has no picker of its own on "Applies to: Every league";
  // it just asks which league is on screen. Browsing Sunday must not show the
  // Friday card, which is the bug this answers.
  assert.equal(pickedLeague(LEAGUES, "sunday-championship", null).driverId, "d-sun");
  assert.equal(pickedLeague(LEAGUES, "friday-cup", null).driverId, "d-fri");
  // One league: nothing to choose, and the caller falls back to its own row.
  assert.equal(pickedLeague([LEAGUES[0]], "friday-cup", null), null);
});

test("a pick that no longer exists falls back instead of blanking the panel", () => {
  assert.equal(pickedLeague(LEAGUES, "sunday-championship", "d-gone").driverId, "d-sun");
  assert.equal(pickedLeague(LEAGUES, "sunday-championship", null).driverId, "d-sun");
});

// api.myCardSeasons(): every season of every league, the acting league first.
const SEASONS = [
  { driverId: "c-fri-8", seasonNumber: 8, seriesSlug: "friday-cup" },
  { driverId: "c-fri-7", seasonNumber: 7, seriesSlug: "friday-cup" },
  { driverId: "c-sun-6", seasonNumber: 6, seriesSlug: "sunday-championship" },
  { driverId: "c-sun-5", seasonNumber: 5, seriesSlug: "sunday-championship" },
];

test("the card editor opens on the viewed league's newest season", () => {
  assert.equal(cardRowFor(SEASONS, "sunday-championship", "c-fri-8"), "c-sun-6");
  assert.equal(cardRowFor(SEASONS, "friday-cup", "c-fri-8"), "c-fri-8");
});

test("no row in the viewed series (or no chips yet) keeps the acting row", () => {
  assert.equal(cardRowFor(SEASONS, "gt-masters", "c-fri-8"), "c-fri-8");
  assert.equal(cardRowFor([], "sunday-championship", "c-fri-8"), "c-fri-8");
  assert.equal(cardRowFor(null, null, "c-fri-8"), "c-fri-8");
});
