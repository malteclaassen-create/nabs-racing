import { describe, it, expect } from "vitest";
import { resolveConfig, shrink, ratePercentile } from "./driverRatingsService.js";

describe("resolveConfig", () => {
  it("falls back to defaults for omitted groups", () => {
    const cfg = resolveConfig({});
    expect(cfg.band).toEqual({ low: 58, high: 96 });
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

  it("accepts a band override", () => {
    const cfg = resolveConfig({ band: { low: 50, high: 99 } });
    expect(cfg.band).toEqual({ low: 50, high: 99 });
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

describe("ratePercentile", () => {
  // A mostly-clean field: eight drivers with zero penalties per start, two
  // that collect them. The reference distribution holds RAW rates.
  const field = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1.0];

  it("never ranks a clean small-sample driver below the clean regulars", () => {
    // The old shrink-then-rank recipe put a clean two-start driver at the very
    // bottom ("bottom 3% of the field") because shrinkage nudged their 0 above
    // everyone else's untouched 0. Ranked raw, they tie with the clean block
    // and land in the upper half.
    const p = ratePercentile(0, 2, field, false);
    expect(p).toBeGreaterThan(0.5);
  });

  it("still ranks a genuinely penalised driver low", () => {
    expect(ratePercentile(1.0, 8, field, false)).toBeLessThan(0.2);
  });

  it("pulls a small sample's ranking toward neutral, not past it", () => {
    // Full sample: the raw percentile stands as-is.
    const full = ratePercentile(0, 8, field, false);
    // Tiny sample: same record, ranking leans toward 0.5 but stays >= 0.5.
    const tiny = ratePercentile(0, 1, field, false);
    expect(tiny).toBeGreaterThanOrEqual(0.5);
    expect(tiny).toBeLessThan(full);
  });

  it("is neutral when the driver has no data for the signal", () => {
    expect(ratePercentile(null, 5, field, false)).toBe(0.5);
  });

  it("handles higher-is-better rates the same way", () => {
    // Podiums: most of the field has none; a small-sample driver without one
    // must not leapfrog the podium-less regulars to a fake "top X%".
    const podiums = [0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.6];
    const p = ratePercentile(0, 2, podiums, true);
    expect(p).toBeLessThan(0.5);
    expect(ratePercentile(0.6, 8, podiums, true)).toBeGreaterThan(0.8);
  });
});
