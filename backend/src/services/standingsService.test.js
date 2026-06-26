import { describe, it, expect } from "vitest";
import { applyDropScores } from "./standingsService.js";

// The full Season 7 calendar is 12 rounds; the best 9 count.
const CAL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Build a roundNumber -> points map from a 10-long R1..R10 list (R11/R12 unrun).
const upto10 = (arr) => Object.fromEntries(arr.map((p, i) => [i + 1, p]));

describe("applyDropScores (drop worst 3 of the full calendar)", () => {
  it("drops the 3 lowest rounds and sums the rest", () => {
    // Five rounds, no missing: drop 1,2,3 -> keep 40+50 = 90.
    const pts = { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50 };
    const { total, droppedRounds } = applyDropScores(pts, [1, 2, 3, 4, 5]);
    expect(total).toBe(90);
    expect(droppedRounds).toEqual([1, 2, 3]);
  });

  it("treats not-yet-run / missing rounds as droppable 0s", () => {
    // Two real rounds on a 12-round calendar: the 3 dropped are all 0s, so the
    // real scores both survive.
    const { total, droppedRounds } = applyDropScores({ 1: 35, 2: 30 }, CAL);
    expect(total).toBe(65);
    expect(droppedRounds).toHaveLength(3);
    expect(droppedRounds).not.toContain(1);
    expect(droppedRounds).not.toContain(2);
  });

  it("drops exactly 3 even when more rounds are 0 (one 0 survives)", () => {
    // Maltegoat: DNS,30,14,25,25,35,DNS,12,22,12 over R1..R10, R11/R12 unrun.
    // 4 zeros (R1, R7, R11, R12) but only 3 are dropped -> total 175.
    const pts = upto10([0, 30, 14, 25, 25, 35, 0, 12, 22, 12]);
    expect(applyDropScores(pts, CAL).total).toBe(175);
  });

  // Real Season-7 driver totals from the official sheet.
  it.each([
    ["Siggsta", [25, 18, 35, 35, 22, 12, 22, 25, 20, 18], 220],
    ["Mtimmis", [14, 8, 25, 30, 30, 6, 20, 30, 30, 30], 217],
    ["Takoda", [20, 25, 22, 22, 0, 22, 35, 18, 12, 35], 211], // R5 DSQ = 0
    ["Pizd", [16, 16, 6, 18, 14, 14, 18, 20, 25, 22], 163],
    ["13bot", [35, 35, 0, 0, 0, 0, 25, 22, 0, 10], 127], // DNS/0 rounds = 0
  ])("matches the official driver total for %s", (_name, scores, expected) => {
    expect(applyDropScores(upto10(scores), CAL).total).toBe(expected);
  });

  // Real Season-7 constructor totals from the official sheet.
  it.each([
    ["Porsche", [49, 43, 25, 30, 65, 36, 45, 52, 30, 40], 390],
    ["Honda", [18, 4, 0, 0, 30, 0, 26, 40, 14, 16], 148],
    ["Lotus", [6, 30, 42, 35, 20, 37, 60, 25, 14, 30], 293],
    ["Redbull", [5, 14, 47, 11, 12, 24, 22, 36, 30, 57], 253],
    ["BMW", [25, 22, 25, 12, 35, 20, 9, 39, 37, 0], 224],
  ])("matches the official constructor total for %s", (_name, scores, expected) => {
    expect(applyDropScores(upto10(scores), CAL).total).toBe(expected);
  });

  it("never drops more than there are rounds (short season)", () => {
    // 2-round calendar: drop count 3 >= rounds, so nothing is dropped.
    const { total, droppedRounds } = applyDropScores({ 1: 10, 2: 20 }, [1, 2]);
    expect(total).toBe(30);
    expect(droppedRounds).toEqual([]);
  });
});
