import { describe, it, expect } from "vitest";
import { repairCumulativeSplits, hasCumulativeSplits } from "./cumulativeSplits.js";

const ns = (ms) => ms * 1e6;
const splits = (times, cuts = []) =>
  Object.fromEntries(
    times.map((t, i) => [String(i), { SplitIndex: i, SplitTime: ns(t), Cuts: cuts[i] || 0, IsDriversBest: false, IsBest: true }])
  );
const ms = (rec) => Object.values(rec || {}).sort((a, b) => a.SplitIndex - b.SplitIndex).map((r) => r.SplitTime / 1e6);

// Yas Marina practice, 21 October 2026, as the server manager sent it.
const car = ({ best, lap, ideal, current, last = best }) => ({
  BestLap: ns(best),
  LastLap: ns(last),
  BestLapSplits: splits(lap),
  BestSplits: splits(ideal),
  ...(current ? { CurrentLapSplits: splits(current) } : {}),
});
const yas = () => ({
  ConnectedDrivers: {
    Drivers: {
      ivan: { Cars: { f: car({ best: 99618, last: 99967, lap: [51144, 82558], ideal: [51061, 17060], current: [51211] }) } },
      malte: { Cars: { f: car({ best: 99745, last: 106389, lap: [51347, 82607], ideal: [51260, 17014], current: [51309, 17171] }) } },
      suforr: { Cars: { f: car({ best: 100010, last: 112938, lap: [51280, 82849], ideal: [51193, 17061], current: [51539, 95607] }) } },
    },
  },
  DisconnectedDrivers: {
    Drivers: {
      dude: { Cars: { f: car({ best: 99684, lap: [51227, 82571], ideal: [51184, 17105] }) } },
    },
  },
  BestSplits: [
    { SplitIndex: 1, SplitTime: ns(17014), Cuts: 0 },
    { SplitIndex: 0, SplitTime: ns(51061), Cuts: 0 },
  ],
});

describe("tracks that report two splits", () => {
  it("turns the best lap's running total into three sectors that add up to the lap", () => {
    const s = repairCumulativeSplits(yas());
    const ivan = s.ConnectedDrivers.Drivers.ivan.Cars.f;
    expect(ms(ivan.BestLapSplits)).toEqual([51144, 31414, 17060]);
    const dude = s.DisconnectedDrivers.Drivers.dude.Cars.f;
    expect(ms(dude.BestLapSplits)).toEqual([51227, 31344, 17113]);
  });

  it("puts the best last sector in S3 and the best lap's middle sector in S2", () => {
    const s = repairCumulativeSplits(yas());
    expect(ms(s.ConnectedDrivers.Drivers.ivan.Cars.f.BestSplits)).toEqual([51061, 31414, 17060]);
    expect(ms(s.ConnectedDrivers.Drivers.malte.Cars.f.BestSplits)).toEqual([51260, 31260, 17014]);
  });

  it("marks green on the best lap where it is the driver's best, and the session's bests purple", () => {
    const s = repairCumulativeSplits(yas());
    const ivan = s.ConnectedDrivers.Drivers.ivan.Cars.f;
    expect(Object.values(ivan.BestLapSplits).map((r) => r.IsDriversBest)).toEqual([false, true, true]);
    expect(ms(s.BestSplits)).toEqual([51061, 31260, 17014]);
    expect(Object.values(s.ConnectedDrivers.Drivers.malte.Cars.f.BestSplits).map((r) => r.IsBest)).toEqual([false, true, true]);
    expect(Object.values(ivan.BestSplits).map((r) => r.IsBest)).toEqual([true, false, false]);
  });

  it("reads the lap being driven: S1 alone, a running total mid-lap, a finished lap", () => {
    const s = repairCumulativeSplits(yas());
    expect(ms(s.ConnectedDrivers.Drivers.ivan.Cars.f.CurrentLapSplits)).toEqual([51211]);
    // 95.607 since the start of a slow lap: through the second line, S3 to come.
    expect(ms(s.ConnectedDrivers.Drivers.suforr.Cars.f.CurrentLapSplits)).toEqual([51539, 44068]);
    // 17.171 is the last sector of the lap that just ended (1:46.389).
    expect(ms(s.ConnectedDrivers.Drivers.malte.Cars.f.CurrentLapSplits)).toEqual([51309, 37909, 17171]);
  });

  it("leaves a track that reports three sectors exactly as it came", () => {
    const three = {
      ConnectedDrivers: { Drivers: { a: { Cars: { f: car({ best: 58982, lap: [29346, 14336, 15300], ideal: [29346, 14275, 15300] }) } } } },
      BestSplits: [{ SplitIndex: 0, SplitTime: ns(29346) }],
    };
    const before = JSON.stringify(three);
    expect(hasCumulativeSplits(three)).toBe(false);
    expect(JSON.stringify(repairCumulativeSplits(three))).toBe(before);
  });

  it("leaves a track with two real sectors alone: they add up to the lap", () => {
    const two = { ConnectedDrivers: { Drivers: { a: { Cars: { f: car({ best: 60000, lap: [25000, 35000], ideal: [25000, 35000] }) } } } } };
    const before = JSON.stringify(two);
    expect(JSON.stringify(repairCumulativeSplits(two))).toBe(before);
  });

  it("gives the same answer when run twice", () => {
    const once = JSON.stringify(repairCumulativeSplits(yas()));
    expect(JSON.stringify(repairCumulativeSplits(JSON.parse(once)))).toBe(once);
  });
});
