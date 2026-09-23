import { test } from "node:test";
import assert from "node:assert/strict";
import { initialRound, latestPastRace, recallRound, rememberRound } from "./sharedRound.js";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

const NOW = Date.parse("2026-07-05T12:00:00Z");
const races = [
  { id: "r10", date: "2026-06-19T18:00:00Z", isCompleted: true },
  { id: "r11", date: "2026-07-03T18:00:00Z", isCompleted: false },
  { id: "r12", date: "2026-07-10T18:00:00Z", isCompleted: false },
  { id: "se", date: null, isCompleted: false },
];

test("the latest race that has been run, or merely dated in the past", () => {
  assert.equal(latestPastRace(races, { now: NOW })?.id, "r11");
  assert.equal(latestPastRace(races, { now: NOW, completedOnly: true })?.id, "r10");
  assert.equal(latestPastRace(races, { now: Date.parse("2026-01-01") }), null);
  assert.equal(latestPastRace(null), null);
});

test("a remembered round wins, but only when the tab offers it", () => {
  assert.equal(initialRound({ ids: ["r10", "r11"], remembered: "r11", fallbackId: "r10" }), "r11");
  assert.equal(initialRound({ ids: ["r10"], remembered: "r11", fallbackId: "r10" }), "r10");
  assert.equal(initialRound({ ids: ["r10"], remembered: null, fallbackId: "gone" }), "");
  assert.equal(initialRound({ ids: [], remembered: "r11", fallbackId: "r10" }), "");
});

test("the memory is per season and ignores an empty pick", () => {
  const s = memoryStorage();
  rememberRound("s7", "r11", s);
  rememberRound("s7", "", s);
  rememberRound("s8", "x1", s);
  assert.equal(recallRound("s7", s), "r11");
  assert.equal(recallRound("s8", s), "x1");
  assert.equal(recallRound("s9", s), null);
  assert.equal(recallRound(null, s), null);
});

test("storage that throws is the same as none", () => {
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  rememberRound("s7", "r11", broken);
  assert.equal(recallRound("s7", broken), null);
});
