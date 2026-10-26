import { test } from "node:test";
import assert from "node:assert/strict";
import { commentAge, looksLikeGifLink, gifBox } from "./newsComments.mjs";

test("commentAge reads like a chat for recent comments and gives the date for old ones", () => {
  const now = new Date("2026-10-26T22:00:00Z").getTime();
  assert.equal(commentAge("2026-10-26T21:59:30Z", now), "just now");
  assert.equal(commentAge("2026-10-26T21:55:00Z", now), "5m");
  assert.equal(commentAge("2026-10-26T19:00:00Z", now), "3h");
  assert.equal(commentAge("2026-10-24T22:00:00Z", now), "2d");
  assert.match(commentAge("2026-09-01T12:00:00Z", now), /^1 Sep$/);
  assert.match(commentAge("2025-09-01T12:00:00Z", now), /^1 Sep 2025$/);
  assert.equal(commentAge("nonsense", now), "");
});

test("looksLikeGifLink spots Tenor and GIPHY links and nothing else", () => {
  assert.ok(looksLikeGifLink("https://tenor.com/view/f1-gif-25339191"));
  assert.ok(looksLikeGifLink(" https://tenor.com/de/view/max-gif-1 "));
  assert.ok(looksLikeGifLink("https://tenor.com/bJ1aB.gif"));
  assert.ok(looksLikeGifLink("https://media1.tenor.com/m/abc/f1.gif"));
  assert.ok(looksLikeGifLink("https://giphy.com/gifs/formula1-l0HlBO7eyXzSZkJri"));
  assert.ok(looksLikeGifLink("https://media.giphy.com/media/abc/giphy.gif"));
  assert.ok(!looksLikeGifLink("https://example.com/x.gif"));
  assert.ok(!looksLikeGifLink("look https://tenor.com/view/f1-gif-1"));
  assert.ok(!looksLikeGifLink("great race"));
});

test("gifBox keeps the GIF's shape inside the box", () => {
  assert.deepEqual(gifBox({ width: 498, height: 280 }), { width: 320, height: 180 });
  assert.deepEqual(gifBox({ width: 200, height: 400 }), { width: 120, height: 240 });
  assert.deepEqual(gifBox({ width: 100, height: 50 }), { width: 100, height: 50 });
  assert.deepEqual(gifBox({}), { width: 320, height: 192 });
});
