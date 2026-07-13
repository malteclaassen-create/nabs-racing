import { describe, it, expect, beforeEach } from "vitest";
import { __testing } from "./liveTiming.js";

const { accumulateStints, stintsFor, reset } = __testing;

// Build a minimal EventType-200 snapshot for one driver, enough to exercise the
// stint accumulator (session type, laps, current tyre, pit count, in-pits flag).
function snap({ type = 1, guid = "g1", laps, tyre = "S", pits = 0, inPits = false, name = "Alice" }) {
  return {
    SessionInfo: { Type: type, Track: "monza", CurrentSessionIndex: 0, Name: "Session" },
    TrackInfo: { name: "NABS Monza" },
    ConnectedDrivers: {
      Drivers: {
        [guid]: {
          CarInfo: { DriverName: name, CarModel: "f", Tyres: tyre, IsSpectator: false },
          Cars: { f: { NumLaps: laps } },
          TotalNumLaps: laps,
          NumPits: pits,
          IsInPits: inPits,
        },
      },
    },
  };
}

describe("liveTiming stint accumulation", () => {
  beforeEach(() => reset());

  it("Practice: returning to the pits wipes the run so the next stint starts fresh", () => {
    accumulateStints(snap({ type: 1, laps: 1 })); // out, lap 1
    accumulateStints(snap({ type: 1, laps: 5 })); // still out, lap 5
    expect(stintsFor("g1")).toEqual([{ tyre: "S", laps: 5 }]);

    accumulateStints(snap({ type: 1, laps: 5, inPits: true })); // teleport back to pits
    expect(stintsFor("g1")).toEqual([]); // history wiped on the pit return

    accumulateStints(snap({ type: 1, laps: 5, inPits: true })); // sitting in pits: stays empty
    expect(stintsFor("g1")).toEqual([]);

    accumulateStints(snap({ type: 1, laps: 6 })); // heads out again — new stint anchors here
    accumulateStints(snap({ type: 1, laps: 8 }));
    expect(stintsFor("g1")).toEqual([{ tyre: "S", laps: 3 }]); // laps 6..8, not 6..8 + old run
  });

  it("Race: a pit stop opens the next stint and never resets", () => {
    accumulateStints(snap({ type: 3, laps: 1, tyre: "S" }));
    accumulateStints(snap({ type: 3, laps: 10, tyre: "S" }));
    // Pit stop: NumPits rises, in the pits, new compound fitted.
    accumulateStints(snap({ type: 3, laps: 10, tyre: "M", pits: 1, inPits: true }));
    accumulateStints(snap({ type: 3, laps: 18, tyre: "M", pits: 1 }));
    const stints = stintsFor("g1");
    expect(stints.length).toBe(2); // both stints kept
    expect(stints[0].tyre).toBe("S");
    expect(stints[1].tyre).toBe("M");
  });

  it("Sitting in the pits at session start opens no stint until the driver heads out", () => {
    accumulateStints(snap({ type: 1, laps: 0, inPits: true }));
    expect(stintsFor("g1")).toEqual([]); // no spurious reset, no phantom stint
    accumulateStints(snap({ type: 1, laps: 1, inPits: false }));
    accumulateStints(snap({ type: 1, laps: 3, inPits: false }));
    expect(stintsFor("g1")).toEqual([{ tyre: "S", laps: 3 }]);
  });

  it("Qualifying resets on pit return just like practice (any non-race session)", () => {
    accumulateStints(snap({ type: 2, laps: 1, tyre: "S" }));
    accumulateStints(snap({ type: 2, laps: 4, tyre: "S" }));
    expect(stintsFor("g1")).toEqual([{ tyre: "S", laps: 4 }]); // laps 1..4
    accumulateStints(snap({ type: 2, laps: 4, tyre: "S", inPits: true }));
    expect(stintsFor("g1")).toEqual([]);
  });
});
