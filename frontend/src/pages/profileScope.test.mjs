import test from "node:test";
import assert from "node:assert/strict";
import { defaultProfileScope, pickedProfileScope, cardRowFor } from "./profileScope.mjs";

// The shape api.myLeagues() answers with: the login's own row first, one per
// series. This person's Discord link sits on their Friday row.
const LEAGUES = [
  { driverId: "d-fri", isActing: true, seriesSlug: "friday-cup", seriesName: "Friday Cup" },
  { driverId: "d-sun", isActing: false, seriesSlug: "sunday-championship", seriesName: "Sunday Championship" },
];

test("one league has nothing to scope — the editor stays on every league", () => {
  assert.equal(defaultProfileScope([{ driverId: "d-fri", isActing: true, seriesSlug: "friday-cup" }], "friday-cup"), "all");
  assert.equal(defaultProfileScope([], "friday-cup"), "all");
  assert.equal(defaultProfileScope(null, "friday-cup"), "all");
});

test("the viewed series decides, not the row the login sits on", () => {
  // The bug this exists for: viewing Sunday while the login is Friday's showed
  // the Friday card and sent "Edit driver card" to the Friday row.
  assert.equal(defaultProfileScope(LEAGUES, "sunday-championship"), "d-sun");
  assert.equal(defaultProfileScope(LEAGUES, "friday-cup"), "d-fri");
});

test("a league the person doesn't race in keeps the scope on every league", () => {
  assert.equal(defaultProfileScope(LEAGUES, "gt-masters"), "all");
  assert.equal(defaultProfileScope(LEAGUES, null), "all");
});

test("a pick by hand outranks the viewed series", () => {
  assert.equal(pickedProfileScope(LEAGUES, "sunday-championship", "d-fri"), "d-fri");
  assert.equal(pickedProfileScope(LEAGUES, "friday-cup", "all"), "all");
});

test("a pick that no longer exists falls back instead of scoping to nothing", () => {
  assert.equal(pickedProfileScope(LEAGUES, "sunday-championship", "d-gone"), "d-sun");
  assert.equal(pickedProfileScope(LEAGUES, "sunday-championship", null), "d-sun");
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
