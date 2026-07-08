import { describe, it, expect } from "vitest";
import { resolveConfig, shrink, dominanceBoost } from "./driverRatingsService.js";

describe("resolveConfig", () => {
  it("falls back to defaults for omitted groups", () => {
    const cfg = resolveConfig({});
    expect(cfg.band).toEqual({ low: 58, high: 96 });
    expect(cfg.dominance).toEqual({ max: 6, fullAt: 0.6 });
    // rac now includes overtakes and is normalised to sum 1
    const sum = Object.values(cfg.rac).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(cfg.rac.overtakes).toBeGreaterThan(0);
  });

  it("normalises a supplied weight group proportionally", () => {
    const cfg = resolveConfig({ rtg: { rac: 2, pac: 2, aha: 0, exp: 0 } });
    expect(cfg.rtg.rac).toBeCloseTo(0.5, 5);
    expect(cfg.rtg.pac).toBeCloseTo(0.5, 5);
    expect(cfg.rtg.aha).toBe(0);
  });

  it("accepts band + dominance overrides", () => {
    const cfg = resolveConfig({ band: { low: 50, high: 99 }, dominance: { max: 10, fullAt: 0.5 } });
    expect(cfg.band).toEqual({ low: 50, high: 99 });
    expect(cfg.dominance).toEqual({ max: 10, fullAt: 0.5 });
  });
});

describe("shrink", () => {
  it("leaves a full-sample value untouched (>= 6)", () => {
    expect(shrink(0.9, 6, 0.5)).toBe(0.9);
    expect(shrink(0.9, 11, 0.5)).toBe(0.9);
  });

  it("pulls a small sample toward the field mean", () => {
    // n=1, K=3: (1*0.9 + 3*0.5)/4 = 0.6
    expect(shrink(0.9, 1, 0.5)).toBeCloseTo(0.6, 5);
  });

  it("returns the field mean when the value is null", () => {
    expect(shrink(null, 3, 0.42)).toBe(0.42);
  });
});

describe("dominanceBoost", () => {
  it("gives the full boost to a runaway leader", () => {
    // 7 of 11 wins -> winShare 0.636 >= fullAt 0.6 -> full max (6)
    expect(dominanceBoost(7, 11)).toBe(6);
  });

  it("scales with win share below the threshold", () => {
    // 3 of 12 -> 0.25 / 0.6 * 6 = 2.5 -> round 3
    expect(dominanceBoost(3, 12)).toBe(3);
  });

  it("is zero for no wins or no races", () => {
    expect(dominanceBoost(0, 12)).toBe(0);
    expect(dominanceBoost(2, 0)).toBe(0);
  });
});
