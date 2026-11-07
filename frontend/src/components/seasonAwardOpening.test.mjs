import { test } from "node:test";
import assert from "node:assert/strict";
import { openingAwardSeason } from "./seasonAwardOpening.mjs";

const list = [{ seasonNumber: 8 }, { seasonNumber: 6 }, { seasonNumber: 3 }];

test("opens on the awards of the season being viewed", () => {
  assert.equal(openingAwardSeason(list, 6), 6);
  assert.equal(openingAwardSeason(list, 8), 8);
});

test("a season without awards opens on the latest awards before it", () => {
  assert.equal(openingAwardSeason(list, 7), 6);
  assert.equal(openingAwardSeason(list, 9), 8);
});

test("before the first awards there is nothing to show; with no season known, the newest", () => {
  assert.equal(openingAwardSeason(list, 2), null);
  assert.equal(openingAwardSeason(list, null), 8);
});

test("no awards at all gives nothing", () => {
  assert.equal(openingAwardSeason([], 8), null);
  assert.equal(openingAwardSeason(undefined, 8), null);
});
