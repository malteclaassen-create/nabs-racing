import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { __testing } from "./liveTiming.js";
import { clearTrack, addUploadedLaps, setBoardScopes, __clearCache as __clearImportCache } from "../lib/liveBestLaps.js";

const { accumulateStints, stintsFor, ingest, telemetry, getBoard, raceSecond, reset, mapKey } = __testing;

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

  it("Race: a stop onto the SAME compound still counts as a stop", () => {
    // The repair pass that removes ghost splits (the upstream flipping between
    // "M" and "Medium") used to swallow these, so a hard-to-hard stop showed as
    // one long stint on the live board and three stops after the import.
    accumulateStints(snap({ type: 3, laps: 1, tyre: "H" }));
    accumulateStints(snap({ type: 3, laps: 10, tyre: "H" }));
    accumulateStints(snap({ type: 3, laps: 10, tyre: "H", pits: 1, inPits: true }));
    accumulateStints(snap({ type: 3, laps: 20, tyre: "H", pits: 1 }));
    const stints = stintsFor("g1");
    expect(stints.length).toBe(2);
    expect(stints.every((s) => s.tyre === "H")).toBe(true);
  });

  it("a same-compound split with no pit stop behind it is still merged away", () => {
    // The flip artefact this repair exists for: the compound name changes
    // shape, the pit counter never moves.
    accumulateStints(snap({ type: 3, laps: 1, tyre: "M" }));
    accumulateStints(snap({ type: 3, laps: 5, tyre: "Medium" }));
    accumulateStints(snap({ type: 3, laps: 9, tyre: "M" }));
    expect(stintsFor("g1")).toEqual([{ tyre: "M", laps: 9 }]);
  });

  it("Race start: the stale quali compound settling is a relabel, not a ghost stint", () => {
    // The first snapshot of a race names the compound left over from quali;
    // the correction lands while the field is still on the opening lap. This
    // painted a one-lap supersoft stint nobody ever raced (2026-08-21).
    accumulateStints(snap({ type: 3, laps: 1, tyre: "SS" }));
    accumulateStints(snap({ type: 3, laps: 1, tyre: "M" }));
    accumulateStints(snap({ type: 3, laps: 18, tyre: "M" }));
    expect(stintsFor("g1")).toEqual([{ tyre: "M", laps: 18 }]);
  });

  it("Race start: the correction still relabels when it only lands on lap 2", () => {
    accumulateStints(snap({ type: 3, laps: 1, tyre: "SS" }));
    accumulateStints(snap({ type: 3, laps: 2, tyre: "SS" }));
    accumulateStints(snap({ type: 3, laps: 2, tyre: "M" }));
    accumulateStints(snap({ type: 3, laps: 18, tyre: "M" }));
    expect(stintsFor("g1")).toEqual([{ tyre: "M", laps: 18 }]);
  });

  it("Race start: a genuine opening-lap stop is NOT swallowed by the settle rule", () => {
    // Pit counter and compound change arrive together: that is a real stop,
    // however early — both stints stay.
    accumulateStints(snap({ type: 3, laps: 1, tyre: "SS" }));
    accumulateStints(snap({ type: 3, laps: 2, tyre: "M", pits: 1, inPits: true }));
    accumulateStints(snap({ type: 3, laps: 18, tyre: "M", pits: 1 }));
    const stints = stintsFor("g1");
    expect(stints.length).toBe(2);
    expect(stints[0].tyre).toBe("SS");
    expect(stints[1].tyre).toBe("M");
  });

  it("Race: pit counter lagging the compound change is ONE stop, not a doubled stint", () => {
    // The stop's new compound shows a snapshot before NumPits rises (the
    // counter lags; pitRecorder documents the same). This opened two stints —
    // the doubled M-M discs on the strategy graphic (2026-08-21).
    accumulateStints(snap({ type: 3, laps: 1, tyre: "S" }));
    accumulateStints(snap({ type: 3, laps: 10, tyre: "S" }));
    accumulateStints(snap({ type: 3, laps: 10, tyre: "M" })); // compound first…
    accumulateStints(snap({ type: 3, laps: 11, tyre: "M", pits: 1 })); // …counter catches up
    accumulateStints(snap({ type: 3, laps: 18, tyre: "M", pits: 1 }));
    expect(stintsFor("g1")).toEqual([
      { tyre: "S", laps: 10 },
      { tyre: "M", laps: 9 },
    ]);
  });

  it("Race: the stop's new compound landing a snapshot late relabels the pit stint", () => {
    // The mirror order: NumPits rises while the feed still names the old
    // rubber, the new compound arrives next snapshot. Relabel, don't split.
    accumulateStints(snap({ type: 3, laps: 1, tyre: "S" }));
    accumulateStints(snap({ type: 3, laps: 10, tyre: "S" }));
    accumulateStints(snap({ type: 3, laps: 10, tyre: "S", pits: 1, inPits: true })); // counter first…
    accumulateStints(snap({ type: 3, laps: 10, tyre: "M", pits: 1 })); // …compound catches up
    accumulateStints(snap({ type: 3, laps: 18, tyre: "M", pits: 1 }));
    expect(stintsFor("g1")).toEqual([
      { tyre: "S", laps: 10 },
      { tyre: "M", laps: 9 },
    ]);
  });

  it("Race: a compound change deep into a stint still splits (counter never rises)", () => {
    // The settle rule must not relabel a stint someone actually raced: the
    // change comes at lap 9 of a lap-1 stint, so it breaks the stint even
    // though the counter never confirms (the importer sorts out the truth).
    accumulateStints(snap({ type: 3, laps: 1, tyre: "S" }));
    accumulateStints(snap({ type: 3, laps: 9, tyre: "S" }));
    accumulateStints(snap({ type: 3, laps: 9, tyre: "M" }));
    accumulateStints(snap({ type: 3, laps: 12, tyre: "M" }));
    const stints = stintsFor("g1");
    expect(stints.length).toBe(2);
    expect(stints[0]).toEqual({ tyre: "S", laps: 9 });
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

// A full ET200 snapshot with several drivers, for the board-level tests
// (leavers held during a race, result frozen past the session change).
function fullSnap({ type = 3, name = "Race", laps: raceLaps = 0, drivers }) {
  const Drivers = {};
  for (const [guid, d] of Object.entries(drivers)) {
    Drivers[guid] = {
      CarInfo: {
        DriverName: d.name,
        CarModel: d.model ?? "f",
        CarSkin: d.skin ?? "",
        Tyres: "S",
        CarID: d.carId ?? 1,
        IsSpectator: false,
      },
      Cars: {
        [d.model ?? "f"]: {
          NumLaps: d.laps ?? 1,
          // The upstream's own stamp for the moment this driver last crossed
          // the line — what a race gap is measured from.
          LastLapCompletedTime: d.crossedAt ? new Date(d.crossedAt).toISOString() : undefined,
        },
      },
      TotalNumLaps: d.laps ?? 1,
      RacePosition: d.pos ?? null,
      NormalisedSplinePos: d.spline ?? 0,
      NumPits: 0,
      IsInPits: d.inPits ?? false,
    };
  }
  return {
    SessionInfo: { Type: type, Track: "monza", CurrentSessionIndex: 0, Name: name, Laps: raceLaps },
    TrackInfo: { name: "NABS Monza" },
    ConnectedDrivers: { Drivers },
    DisconnectedDrivers: { Drivers: {} },
  };
}

const T0 = Date.UTC(2026, 7, 9, 18, 0, 0);

describe("liveTiming race gap", () => {
  beforeEach(() => reset());

  it("measures the gap from the two cars' crossings of the same lap", () => {
    ingest(fullSnap({ laps: 30, drivers: {
      g1: { name: "Alice", laps: 10, pos: 1, carId: 1, crossedAt: T0 },
      g2: { name: "Bob", laps: 10, pos: 2, carId: 2, crossedAt: T0 + 4250 },
    } }));
    const board = getBoard();
    const [alice, bob] = board.entries;
    expect(alice.gapToLeaderMs).toBe(0);
    expect(alice.lapsDown).toBe(0);
    expect(bob.gapToLeaderMs).toBe(4250);
    expect(bob.intervalMs).toBe(4250); // the car ahead IS the leader here
    expect(board.session.leaderName).toBe("Alice");
    expect(board.session.lapsLeft).toBe(20);
  });

  it("a car a lap down reports laps, not seconds", () => {
    ingest(fullSnap({ laps: 30, drivers: {
      g1: { name: "Alice", laps: 12, pos: 1, carId: 1, crossedAt: T0 + 120_000, spline: 0.4 },
      g2: { name: "Bob", laps: 10, pos: 2, carId: 2, crossedAt: T0, spline: 0.5 },
    } }));
    const bob = getBoard().entries[1];
    expect(bob.lapsDown).toBe(2);
    expect(bob.gapToLeaderMs).toBe(null);
  });

  it("the seconds before the car behind reaches the line are not a lap down", () => {
    // Both complete lap 11, three seconds apart…
    ingest(fullSnap({ laps: 30, drivers: {
      g1: { name: "Alice", laps: 11, pos: 1, carId: 1, crossedAt: T0 - 90_000, spline: 0.5 },
      g2: { name: "Bob", laps: 11, pos: 2, carId: 2, crossedAt: T0 - 87_000, spline: 0.45 },
    } }));
    // …then the leader starts lap 13 while the chaser is still finishing 12,
    // further round it than the leader is round his. One lap apart on the
    // counter, not a lap down.
    ingest(fullSnap({ laps: 30, drivers: {
      g1: { name: "Alice", laps: 12, pos: 1, carId: 1, crossedAt: T0, spline: 0.02 },
      g2: { name: "Bob", laps: 11, pos: 2, carId: 2, crossedAt: T0 - 87_000, spline: 0.97 },
    } }));
    const bob = getBoard().entries[1];
    expect(bob.lapsDown).toBe(0);
    expect(bob.gapToLeaderMs).toBe(3000); // their lap-11 crossings, 3s apart
  });

  it("says nothing rather than guessing before it has seen both cars cross", () => {
    // A viewer arriving mid-race, or the relay restarting: no crossing history
    // yet. A blank gap fills itself in within a lap; a made-up one would not.
    ingest(fullSnap({ laps: 30, drivers: {
      g1: { name: "Alice", laps: 12, pos: 1, carId: 1, crossedAt: T0, spline: 0.5 },
      g2: { name: "Bob", laps: 11, pos: 2, carId: 2, crossedAt: T0 - 3000, spline: 0.6 },
    } }));
    expect(getBoard().entries[1].gapToLeaderMs).toBe(null);
  });

  it("a race restarted in place does not inherit the previous running's gaps", () => {
    // An admin restarting the session keeps Track|Index|Name identical, so
    // nothing else clears the crossing history — and the lap numbers repeat.
    for (let n = 1; n <= 6; n++) {
      ingest(fullSnap({ laps: 30, drivers: {
        g1: { name: "Alice", laps: n, pos: 1, carId: 1, crossedAt: T0 + n * 90_000 },
        g2: { name: "Bob", laps: n, pos: 2, carId: 2, crossedAt: T0 + n * 90_000 + 4250 },
      } }));
    }
    expect(getBoard().entries[1].gapToLeaderMs).toBe(4250);

    // Same session key, counters back to zero, and this time they are close.
    const later = T0 + 3_600_000;
    for (let n = 1; n <= 3; n++) {
      ingest(fullSnap({ laps: 30, drivers: {
        g1: { name: "Alice", laps: n, pos: 1, carId: 1, crossedAt: later + n * 90_000 },
        g2: { name: "Bob", laps: n, pos: 2, carId: 2, crossedAt: later + n * 90_000 + 400 },
      } }));
    }
    expect(getBoard().entries[1].gapToLeaderMs).toBe(400);
  });

  it("a car credited with more laps than the leader reports nothing, not zero", () => {
    // The leader has left and holds P1 on a frozen position while the race went
    // on without them. "0.000" would read as certain; it is the opposite.
    ingest(fullSnap({ laps: 30, drivers: {
      g1: { name: "Alice", laps: 28, pos: 1, carId: 1, crossedAt: T0 },
      g2: { name: "Bob", laps: 28, pos: 2, carId: 2, crossedAt: T0 + 1000 },
    } }));
    ingest(fullSnap({ laps: 30, drivers: {
      g1: { name: "Alice", laps: 28, pos: 1, carId: 1, crossedAt: T0 },
      g2: { name: "Bob", laps: 30, pos: 2, carId: 2, crossedAt: T0 + 180_000 },
    } }));
    const bob = getBoard().entries[1];
    expect(bob.lapsDown).toBe(0);
    expect(bob.gapToLeaderMs).toBe(null);
  });

  it("practice and qualifying keep the best-lap gap and no race gap", () => {
    ingest(fullSnap({ type: 2, name: "Qualifying", drivers: {
      g1: { name: "Alice", laps: 3, crossedAt: T0 },
      g2: { name: "Bob", laps: 3, crossedAt: T0 + 9000 },
    } }));
    const board = getBoard();
    expect(board.entries.every((e) => e.gapToLeaderMs === null)).toBe(true);
    expect(board.session.leaderName).toBe(null);
    expect(board.session.lapsLeft).toBe(null);
  });
});

describe("liveTiming safety car", () => {
  beforeEach(() => reset());

  it("is recognised by its skin, kept out of the order and reported as out", () => {
    ingest(fullSnap({ laps: 30, drivers: {
      sc: { name: "Adam Galaxi", laps: 11, pos: 1, carId: 9, skin: "!NABS_Safety_Car", model: "lotus_exige_240" },
      g1: { name: "Alice", laps: 10, pos: 2, carId: 1, crossedAt: T0 },
      g2: { name: "Bob", laps: 10, pos: 3, carId: 2, crossedAt: T0 + 2000 },
    } }));
    const board = getBoard();
    expect(board.session.safetyCar).toBe(true);
    // Leading the field on the road, last in the classification.
    expect(board.entries.map((e) => e.name)).toEqual(["Alice", "Bob", "Adam Galaxi"]);
    expect(board.session.leaderName).toBe("Alice");
    // …and the gap is to the real leader, not to the pace car.
    expect(board.entries[1].gapToLeaderMs).toBe(2000);
    expect(board.entries[2].isSafetyCar).toBe(true);
  });

  it("recognises the pace car of every season the league has archived", () => {
    // Checked against all 47 events in results-archive: these four models cover
    // every pace-car and broadcast-car entry and no racing entry. The skins
    // changed almost every season, which is why the model matters.
    const cases = [
      { skin: "!NABS_Safety_Car", model: "lotus_exige_240" }, // s5/s6
      { skin: "NABS_Racing_Safety_Car", model: "mercedes_sls" }, // s5
      { skin: "kunos_zp_121", model: "mercedes_sls_gt3" }, // s7 — skin says nothing
      { skin: "NABS Broadcast", model: "mercedes_sls_gt3" }, // s7 — not racing either
      { skin: "sc", model: "drf_audi_rs5_dtm_2019" }, // s8
    ];
    for (const c of cases) {
      reset();
      ingest(fullSnap({ drivers: {
        sc: { name: "Pace", laps: 5, pos: 1, carId: 9, skin: c.skin, model: c.model },
        g1: { name: "Alice", laps: 5, pos: 2, carId: 1 },
        g2: { name: "Bob", laps: 5, pos: 3, carId: 2 },
      } }));
      const board = getBoard();
      expect(board.entries.find((e) => e.name === "Pace").isSafetyCar, `${c.model}/${c.skin}`).toBe(true);
      expect(board.session.leaderName).toBe("Alice");
      expect(board.session.driverCount).toBe(2); // the pace car is not a competitor
    }
  });

  it("leaves a multi-make grid alone (season 7 ran twelve different cars)", () => {
    // The tempting general rule — "the model nobody else is on isn't racing" —
    // would flag most of a 2007-spec grid, where every team is a distinct model
    // with two drivers. Only the skin and the known pace cars may decide.
    const drivers = {};
    const makes = ["cim_2007_mclaren", "cim_2007_ferrari", "cim_2007_williams", "cim_2007_toyota"];
    makes.forEach((m, i) => {
      drivers[`a${i}`] = { name: `A${i}`, laps: 5, pos: i * 2 + 1, carId: i * 2, model: m, skin: `${i}-car` };
      drivers[`b${i}`] = { name: `B${i}`, laps: 5, pos: i * 2 + 2, carId: i * 2 + 1, model: m, skin: `${i}-car2` };
    });
    ingest(fullSnap({ drivers }));
    const board = getBoard();
    expect(board.entries.every((e) => e.isSafetyCar === false)).toBe(true);
    expect(board.session.driverCount).toBe(8);
  });

  it("is recognised by its car model when the skin says nothing", () => {
    ingest(fullSnap({ drivers: {
      sc: { name: "Someone", laps: 5, pos: 1, carId: 9, skin: "", model: "mercedes_sls" },
      g1: { name: "Alice", laps: 5, pos: 2, carId: 1 },
      g2: { name: "Bob", laps: 5, pos: 3, carId: 2 },
    } }));
    expect(getBoard().entries.map((e) => e.name)).toEqual(["Alice", "Bob", "Someone"]);
  });

  it("stays out of it when half the field looks like a pace car", () => {
    // Not a league round — a mixed session, or a skin naming accident. Being
    // wrong here would cost real drivers their places, so nothing is reclassified.
    ingest(fullSnap({ drivers: {
      g1: { name: "Alice", laps: 5, pos: 1, carId: 1, skin: "safety_thing" },
      g2: { name: "Bob", laps: 5, pos: 2, carId: 2, skin: "safety_thing" },
      g3: { name: "Cara", laps: 5, pos: 3, carId: 3 },
    } }));
    const board = getBoard();
    expect(board.entries.map((e) => e.name)).toEqual(["Alice", "Bob", "Cara"]);
    expect(board.entries.every((e) => e.isSafetyCar === false)).toBe(true);
    expect(board.session.safetyCar).toBe(false);
  });

  it("a safety car sitting in its garage is not 'out'", () => {
    const snap = fullSnap({ drivers: {
      sc: { name: "Adam Galaxi", laps: 0, pos: 3, carId: 9, skin: "NABS_Racing_Safety_Car" },
      g1: { name: "Alice", laps: 5, pos: 1, carId: 1 },
      g2: { name: "Bob", laps: 5, pos: 2, carId: 2 },
    } });
    snap.ConnectedDrivers.Drivers.sc.IsInPits = true;
    ingest(snap);
    const board = getBoard();
    expect(board.session.safetyCar).toBe(false);
    expect(board.entries.find((e) => e.name === "Adam Galaxi").isSafetyCar).toBe(true);
  });
});

describe("liveTiming race board", () => {
  beforeEach(() => reset());

  it("a driver the upstream forgot mid-race stays on the board with their last state", () => {
    ingest(fullSnap({ drivers: { g1: { name: "Alice", laps: 10, pos: 1 }, g2: { name: "Bob", laps: 10, pos: 2 } } }));
    // Next snapshot of the SAME race: Bob has left the server and the upstream
    // no longer lists him anywhere.
    ingest(fullSnap({ drivers: { g1: { name: "Alice", laps: 12, pos: 1 } } }));
    const board = getBoard();
    expect(board.entries.map((e) => e.name).sort()).toEqual(["Alice", "Bob"]);
    const bob = board.entries.find((e) => e.name === "Bob");
    expect(bob.onTrack).toBe(false);
    expect(bob.racePosition).toBe(2); // held finishing position
  });

  it("the finished race stays frozen on the board after the session changes", () => {
    ingest(fullSnap({ drivers: { g1: { name: "Alice", laps: 20, pos: 1 }, g2: { name: "Bob", laps: 20, pos: 2 } } }));
    // Server cycles on to practice; only Alice is still around.
    ingest(fullSnap({ type: 1, name: "Practice", drivers: { g1: { name: "Alice", laps: 0 } } }));
    const board = getBoard();
    expect(board.session.type).toBe("Race");
    expect(board.session.finished).toBe(true);
    expect(board.session.remainingMs).toBe(0);
    expect(board.entries.map((e) => e.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("a mid-race quitter drops to the bottom once lapped, not held mid-field", () => {
    ingest(fullSnap({ drivers: {
      g1: { name: "Alice", laps: 3, pos: 1, carId: 1 },
      g2: { name: "Bob", laps: 3, pos: 2, carId: 2 },
      g3: { name: "Cara", laps: 3, pos: 3, carId: 3 },
    } }));
    // Bob rage-quits on lap 3; the others race on, the sim re-issues P2.
    ingest(fullSnap({ drivers: {
      g1: { name: "Alice", laps: 10, pos: 1, carId: 1 },
      g3: { name: "Cara", laps: 9, pos: 2, carId: 3 },
    } }));
    const board = getBoard();
    expect(board.entries.map((e) => e.name)).toEqual(["Alice", "Cara", "Bob"]);
    expect(board.entries[2].position).toBe(3); // classified last, renumbered
  });

  it("a driver who left on full distance keeps their held position", () => {
    ingest(fullSnap({ drivers: {
      g1: { name: "Alice", laps: 20, pos: 1, carId: 1 },
      g2: { name: "Bob", laps: 20, pos: 2, carId: 2 },
      g3: { name: "Cara", laps: 19, pos: 3, carId: 3 },
    } }));
    // Bob closes the game right after the flag; upstream forgets him while the
    // others cruise. Same session, same lap counts.
    ingest(fullSnap({ drivers: {
      g1: { name: "Alice", laps: 20, pos: 1, carId: 1 },
      g3: { name: "Cara", laps: 19, pos: 2, carId: 3 },
    } }));
    const board = getBoard();
    expect(board.entries.map((e) => e.name)).toEqual(["Alice", "Bob", "Cara"]);
  });

  it("a NEW race releases the hold immediately", () => {
    ingest(fullSnap({ name: "Race 1", drivers: { g1: { name: "Alice", laps: 20, pos: 1 } } }));
    ingest(fullSnap({ type: 1, name: "Practice", drivers: {} })); // freeze
    expect(getBoard().session.finished).toBe(true);
    ingest(fullSnap({ name: "Race 2", drivers: { g2: { name: "Bob", laps: 1, pos: 1 } } }));
    const board = getBoard();
    expect(board.session.finished).toBeUndefined();
    expect(board.entries.map((e) => e.name)).toEqual(["Bob"]);
  });

  it("a new qualifying releases the hold immediately too", () => {
    ingest(fullSnap({ name: "Race 1", drivers: { g1: { name: "Alice", laps: 20, pos: 1 } } }));
    ingest(fullSnap({ type: 1, name: "Practice", drivers: {} })); // freeze
    expect(getBoard().session.finished).toBe(true);
    ingest(fullSnap({ type: 2, name: "Qualify", drivers: { g2: { name: "Bob", laps: 1 } } }));
    const board = getBoard();
    expect(board.session.finished).toBeUndefined();
    expect(board.session.type).toBe("Qualifying");
  });

  it("a practice with somebody out on track releases the hold after the cool-down window, a garaged field does not", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-20T18:00:00Z"));
      ingest(fullSnap({ name: "Race 1", drivers: { g1: { name: "Alice", laps: 20, pos: 1 } } }));
      // Everyone parked in the garage after the flag: the result holds.
      ingest(fullSnap({ type: 1, name: "Practice", drivers: { g1: { name: "Alice", laps: 0, inPits: true } } }));
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(getBoard().session.finished).toBe(true);
      // Somebody heads out for real: three minutes later the practice shows.
      ingest(fullSnap({ type: 1, name: "Practice", drivers: { g1: { name: "Alice", laps: 0, inPits: false } } }));
      expect(getBoard().session.finished).toBe(true);
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(getBoard().session.finished).toBe(true);
      vi.advanceTimersByTime(61 * 1000);
      const board = getBoard();
      expect(board.session.finished).toBeUndefined();
      expect(board.session.type).toBe("Practice");
    } finally {
      vi.useRealTimers();
    }
  });
});

// How far into the session we are, asked WHILE the session is running. The
// in-game report button is the caller: a report fired mid-race had a wall clock
// and nothing else until the round's result file was imported hours later, and
// a wall clock is the one thing a replay timeline cannot be dragged to.
describe("liveTiming live session second", () => {
  beforeEach(() => reset());

  // The session's own elapsed reading, which is what the anchor is built from.
  const racing = (elapsed, type = 3) => ({
    ...fullSnap({ type, drivers: { g1: { name: "Alice", laps: 3, pos: 1 } } }),
    SessionInfo: {
      Type: type,
      Track: "monza",
      CurrentSessionIndex: 0,
      Name: type === 3 ? "Race" : "Practice",
      Laps: 0,
      ElapsedMilliseconds: elapsed,
    },
  });

  it("answers with how long the race on air has been running", () => {
    ingest(racing(10 * 60 * 1000)); // ten minutes in
    expect(raceSecond()).toBeGreaterThanOrEqual(600);
    expect(raceSecond()).toBeLessThan(605);
  });

  it("says nothing when the session on air is not a race", () => {
    ingest(racing(10 * 60 * 1000, 1)); // practice
    expect(raceSecond()).toBe(null);
  });

  it("says nothing before the session has an anchor", () => {
    ingest(racing(0)); // the first snapshot of a session reports zero elapsed
    expect(raceSecond()).toBe(null);
  });

  it("says nothing with no session at all", () => {
    expect(raceSecond()).toBe(null);
  });

  // A race whose anchor is hours old is not a long race, it is a leftover — and
  // a report stamped with it would send a steward to a frame that does not exist.
  it("says nothing about a session that has been running implausibly long", () => {
    ingest(racing(9 * 60 * 60 * 1000));
    expect(raceSecond()).toBe(null);
  });
});

// Sector colours on the qualifying/practice board. The trap the live board fell
// into: the session's top-level BestSplits arrives as an ARRAY in whatever order
// the records were written (S3, S1, S2 is a real payload), so reading it by
// position compared sector 1's time against sector 3's and nothing ever matched.
describe("liveTiming sector colours", () => {
  beforeEach(() => reset());

  const ms = (n) => n * 1e6;
  // A car's splits: object keyed "0"/"1"/"2", the shape the upstream sends.
  const lapSplits = (times, driversBest = [false, false, false]) =>
    Object.fromEntries(
      times.map((t, i) => [
        String(i),
        { SplitIndex: i, SplitTime: ms(t), Cuts: 0, IsDriversBest: driversBest[i], IsBest: false },
      ])
    );

  const driverRecord = (d) => ({
    CarInfo: { DriverName: d.name, CarModel: "f", Tyres: "SS", CarID: d.carId ?? 1, IsSpectator: false },
    Cars: {
      f: {
        NumLaps: 10,
        BestLap: ms(d.best),
        BestLapSplits: lapSplits(d.lap, d.driversBest),
        BestSplits: lapSplits(d.ideal ?? d.lap),
        // The lap in progress: only the splits already crossed are present.
        ...(d.current ? { CurrentLapSplits: lapSplits(d.current) } : {}),
      },
    },
    TotalNumLaps: 10,
  });

  function quali({ bestSplits, drivers, stored = {} }) {
    const Drivers = Object.fromEntries(
      Object.entries(drivers).map(([guid, d]) => [guid, driverRecord(d)])
    );
    const Stored = Object.fromEntries(
      Object.entries(stored).map(([guid, d]) => [guid, driverRecord(d)])
    );
    return {
      SessionInfo: { Type: 2, Track: "monza", CurrentSessionIndex: 0, Name: "Qualifying" },
      TrackInfo: { name: "NABS Monza" },
      ConnectedDrivers: { Drivers },
      DisconnectedDrivers: { Drivers: Stored },
      BestSplits: bestSplits,
    };
  }

  it("marks the session's fastest sector purple even though BestSplits arrives out of order", () => {
    ingest(
      quali({
        // Exactly the upstream's ordering: S3 first, then S1, then S2.
        bestSplits: [
          { SplitIndex: 2, SplitTime: ms(15300), Cuts: 0 },
          { SplitIndex: 0, SplitTime: ms(29346), Cuts: 0 },
          { SplitIndex: 1, SplitTime: ms(14275), Cuts: 0 },
        ],
        drivers: {
          g1: { name: "Timmis", carId: 1, best: 58982, lap: [29346, 14336, 15300] },
          g2: { name: "Rashford", carId: 2, best: 59027, lap: [29372, 14338, 15317] },
        },
      })
    );
    const [timmis, rashford] = getBoard().entries;
    // S1 and S3 of the pole lap ARE the session's best; S2 is not (14.275 was
    // set on another lap), so it stays green/amber like the source timing page.
    expect(timmis.sectors.map((s) => s.best)).toEqual([true, false, true]);
    expect(rashford.sectors.map((s) => s.best)).toEqual([false, false, false]);
  });

  it("keeps the driver's own best sector green", () => {
    ingest(
      quali({
        bestSplits: [{ SplitIndex: 0, SplitTime: ms(29346), Cuts: 0 }],
        drivers: {
          g1: { name: "Pizd", carId: 1, best: 59176, lap: [29489, 14346, 15341], driversBest: [false, true, false] },
        },
      })
    );
    const [pizd] = getBoard().entries;
    expect(pizd.sectors.map((s) => s.best)).toEqual([false, false, false]);
    expect(pizd.sectors.map((s) => s.driversBest)).toEqual([false, true, false]);
  });

  it("builds the lap in progress up split by split, for cars actually out there", () => {
    ingest(
      quali({
        bestSplits: [{ SplitIndex: 0, SplitTime: ms(29346), Cuts: 0 }],
        drivers: {
          // Mid-lap: S1 and S2 crossed, S3 still being driven. S1 happens to be
          // the session's best, so it goes purple while the lap is still running.
          g1: { name: "Timmis", carId: 1, best: 58982, lap: [29346, 14336, 15300], current: [29346, 14401] },
          // Sitting in the garage between runs — no lap in progress.
          g2: { name: "Pizd", carId: 2, best: 59176, lap: [29489, 14346, 15341] },
        },
      })
    );
    const [timmis, pizd] = getBoard().entries;
    expect(timmis.currentSectors.map((s) => s?.ms ?? null)).toEqual([29346, 14401, null]);
    expect(timmis.currentSectors[0].best).toBe(true);
    expect(pizd.currentSectors).toEqual([null, null, null]);
  });

  it("a stored driver's leftover splits are not served as a lap in progress", () => {
    // The upstream keeps CurrentLapSplits on a car that has left the server;
    // they belong to a lap that ended whenever they quit, so the board says
    // nothing rather than showing a stale lap building forever.
    ingest(
      quali({
        bestSplits: [],
        drivers: {},
        stored: {
          g9: { name: "Ghost", carId: 9, best: 60000, lap: [30000, 15000, 15000], current: [30000, 15000] },
        },
      })
    );
    const [ghost] = getBoard().entries;
    expect(ghost.name).toBe("Ghost");
    expect(ghost.currentSectors).toEqual([null, null, null]);
  });

  it("sums the ideal lap from the driver's best sectors whatever order they come in", () => {
    ingest(
      quali({
        bestSplits: [],
        drivers: {
          g1: { name: "Timmis", carId: 1, best: 58982, lap: [29346, 14336, 15300], ideal: [29346, 14275, 15300] },
        },
      })
    );
    expect(getBoard().entries[0].potentialMs).toBe(29346 + 14275 + 15300);
  });
});

// A lap that has ENDED, and a lap nobody is timing yet. Two states the board
// used to show as if they were a lap in progress.
describe("liveTiming: the lap in progress, and out laps", () => {
  beforeEach(() => reset());

  const ms = (n) => n * 1e6;
  const splits = (times) =>
    Object.fromEntries(
      times.map((t, i) => [String(i), { SplitIndex: i, SplitTime: ms(t), Cuts: 0 }])
    );

  // One connected driver, with everything the pit and out-lap logic reads.
  const snapshot = ({ current, inPits = false, laps = 10, spline = 0.5 }) => ({
    SessionInfo: { Type: 1, Track: "most", CurrentSessionIndex: 0, Name: "Practice" },
    TrackInfo: { name: "NABS Most" },
    ConnectedDrivers: {
      Drivers: {
        g1: {
          CarInfo: { DriverName: "Zohair", CarModel: "f", CarID: 1, Tyres: "SS", IsSpectator: false },
          Cars: {
            f: {
              NumLaps: laps,
              BestLap: ms(68396),
              ...(current ? { CurrentLapSplits: splits(current) } : {}),
            },
          },
          TotalNumLaps: laps,
          NormalisedSplinePos: spline,
          IsInPits: inPits,
          NumPits: 0,
        },
      },
    },
    DisconnectedDrivers: { Drivers: {} },
  });

  it("passes on the splits of a lap that has already finished", () => {
    // All three present means the driver crossed the line, and the board says
    // so rather than blanking them: the page keeps them up for ten seconds
    // before starting sector one, and it needs the times to do that.
    ingest(snapshot({ current: [31234, 16880, 20282] }));
    expect(getBoard().entries[0].currentSectors.map((s) => s?.ms ?? null)).toEqual([
      31234, 16880, 20282,
    ]);
  });

  it("keeps a lap that is genuinely part way through", () => {
    ingest(snapshot({ current: [31234, 16880] }));
    const [e] = getBoard().entries;
    expect(e.currentSectors.map((s) => s?.ms ?? null)).toEqual([31234, 16880, null]);
  });

  it("calls the lap after a pit visit an out lap, and stops at the line", () => {
    // In the pits...
    ingest(snapshot({ inPits: true, laps: 10, spline: 0.02 }));
    expect(getBoard().entries[0].inPits).toBe(true);
    expect(getBoard().entries[0].outLap).toBe(false);

    // ...out again. The pit flag needs to clear first (pitFlag.js), which the
    // speed guard cannot do here because a test snapshot carries no velocity,
    // so this is the timer's job and the board build after it.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now());
      ingest(snapshot({ inPits: false, laps: 10, spline: 0.05 }));
      getBoard(); // observes the flag dropping
      vi.advanceTimersByTime(2000);
      const out = getBoard().entries[0];
      expect(out.inPits).toBe(false);
      expect(out.outLap).toBe(true);

      // Round they go. Still the out lap at three quarters distance.
      ingest(snapshot({ inPits: false, laps: 10, spline: 0.75 }));
      expect(getBoard().entries[0].outLap).toBe(true);

      // Across the line: the spline wraps, and that is a timed lap starting.
      ingest(snapshot({ inPits: false, laps: 10, spline: 0.05 }));
      expect(getBoard().entries[0].outLap).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the out lap on the lap counter too, for a spline that never wrapped", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now());
      ingest(snapshot({ inPits: true, laps: 4, spline: 0.02 }));
      getBoard();
      ingest(snapshot({ inPits: false, laps: 4, spline: 0.03 }));
      getBoard();
      vi.advanceTimersByTime(2000);
      expect(getBoard().entries[0].outLap).toBe(true);
      // The next snapshot lands after they crossed, with the counter moved on.
      ingest(snapshot({ inPits: false, laps: 5, spline: 0.4 }));
      expect(getBoard().entries[0].outLap).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never calls a normal lap an out lap", () => {
    ingest(snapshot({ inPits: false, laps: 10, spline: 0.3 }));
    ingest(snapshot({ inPits: false, laps: 10, spline: 0.9 }));
    ingest(snapshot({ inPits: false, laps: 11, spline: 0.1 }));
    expect(getBoard().entries[0].outLap).toBe(false);
  });
});

// Two clocks a pit stop is judged on, and they are not the same clock.
describe("liveTiming: pit lane and stop timing", () => {
  beforeEach(() => reset());

  // A car in the pit lane. Telemetry carries the velocity, so this drives the
  // ET53 path as well as the snapshot: `carId` ties the two together.
  const inPitSnapshot = (speedMs) => ({
    SessionInfo: { Type: 3, Track: "most", CurrentSessionIndex: 0, Name: "Race" },
    TrackInfo: { name: "NABS Most" },
    ConnectedDrivers: {
      Drivers: {
        g1: {
          CarInfo: { DriverName: "Zohair", CarModel: "f", CarID: 7, Tyres: "SS", IsSpectator: false },
          Cars: { f: { NumLaps: 12, BestLap: 68396e6 } },
          TotalNumLaps: 12,
          NormalisedSplinePos: 0.02,
          IsInPits: true,
          NumPits: 1,
          Velocity: { X: speedMs, Y: 0, Z: 0 },
        },
      },
    },
    DisconnectedDrivers: { Drivers: {} },
  });

  // The speed a stop is judged by comes off the telemetry, not the snapshot, so
  // a test that only ingests snapshots is testing nothing about it.
  const frame = (speedMs, inPits = true) => ({
    CarID: 7,
    IsInPits: inPits,
    Velocity: { X: speedMs, Y: 0, Z: 0 },
  });

  it("dates the lane from the entry and the stop from standing still", () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.UTC(2026, 7, 26, 20, 0, 0);
      vi.setSystemTime(t0);
      // Rolling down the lane under the limiter: in the lane, not stopped.
      ingest(inPitSnapshot(16)); // names the car, so CarID 7 maps to a driver
      telemetry(frame(16)); // ~58 km/h
      const rolling = getBoard().entries[0];
      expect(rolling.inPits).toBe(true);
      expect(rolling.pitSince).toBe(t0);
      expect(rolling.stoppedSince).toBe(null);

      // Five seconds later they are stationary in the box.
      vi.setSystemTime(t0 + 5000);
      telemetry(frame(0));
      const stopped = getBoard().entries[0];
      expect(stopped.pitSince).toBe(t0); // still the entry, not the stop
      expect(stopped.stoppedSince).toBe(t0 + 5000);

      // Held while they sit there, rather than restarting every frame.
      vi.setSystemTime(t0 + 9000);
      telemetry(frame(0.2));
      expect(getBoard().entries[0].stoppedSince).toBe(t0 + 5000);

      // And released the moment they pull away.
      vi.setSystemTime(t0 + 12000);
      telemetry(frame(10)); // ~36 km/h, pulling away
      expect(getBoard().entries[0].stoppedSince).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing about either clock for a car that is not in the pits", () => {
    ingest(
      fullSnap({ type: 1, laps: 0, drivers: { g1: { name: "Alice", laps: 3, carId: 1 } } })
    );
    const [e] = getBoard().entries;
    expect(e.inPits).toBe(false);
    expect(e.pitSince).toBe(null);
    expect(e.stoppedSince).toBe(null);
  });
});


// The real track map is fetched per track, and the fetch is started by the
// snapshot that first mentions the track. Any snapshot — not only the one
// that ends a race, which is where the call once ended up (2026-09-04).
describe("track map", () => {
  beforeEach(() => reset());

  it("a snapshot asks for its track's map", () => {
    expect(mapKey()).toBe(null);
    ingest(snap({ type: 1, laps: 1 }));
    expect(mapKey()).toBe("monza|");
  });
});

// After the flag the classification is by the line, not by the road.
describe("finishing order", () => {
  beforeEach(() => reset());

  // Two cars, twenty laps. `at` is the server's timestamp of the last lap.
  function lap({ alice, bob, atAlice, atBob, splineAlice = 0.9, splineBob = 0.1 }) {
    const s = snap({ type: 3, guid: "g1", laps: alice, name: "Alice" });
    s.SessionInfo.Laps = 20;
    s.ConnectedDrivers.Drivers.g1.NormalisedSplinePos = splineAlice;
    if (atAlice) s.ConnectedDrivers.Drivers.g1.Cars.f.LastLapCompletedTime = atAlice;
    s.ConnectedDrivers.Drivers.g2 = {
      CarInfo: { DriverName: "Bob", CarModel: "f", Tyres: "M", IsSpectator: false },
      Cars: { f: { NumLaps: bob, ...(atBob ? { LastLapCompletedTime: atBob } : {}) } },
      TotalNumLaps: bob,
      NumPits: 0,
      IsInPits: false,
      NormalisedSplinePos: splineBob,
    };
    return s;
  }

  it("the car that crossed the line first wins, whatever the running order says afterwards", () => {
    // Lap 19 for both, Alice further round the lap: running order says Alice.
    ingest(lap({ alice: 19, bob: 19, atAlice: "2026-09-04T19:30:00.000Z", atBob: "2026-09-04T19:30:01.000Z" }));
    expect(getBoard().entries.map((e) => e.name)).toEqual(["Alice", "Bob"]);
    // Both take the flag. Bob crossed five seconds BEFORE Alice, and on the
    // cool-down lap Alice is still further round the circuit.
    ingest(lap({ alice: 20, bob: 20, atAlice: "2026-09-04T19:31:05.000Z", atBob: "2026-09-04T19:31:00.000Z" }));
    const board = getBoard();
    expect(board.entries.map((e) => e.name)).toEqual(["Bob", "Alice"]);
    // and the gap is measured against the actual winner
    expect(board.entries[1].gapToLeaderMs).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Carried training bests (lib/liveBestLaps.js -> the board).
//
// The point of the feature: the race server keeps one practice session, and
// between two race weekends that session restarts every few hours and takes
// the week's times with it. An admin hands the site the server manager's
// session files, and these are the rules the board applies to their laps.
// ---------------------------------------------------------------------------
describe("liveTiming carried training bests", () => {
  const ALICE = "76561198000000001";
  const BOB = "76561198000000002";
  const CARA = "76561198000000003";

  // The relay under test is server "test" (see __testing), and Track "monza"
  // with no layout keys the track as "monza".
  const SERVER = "test";
  const TRACK = "monza";
  const SERIES = "friday-f1";
  const SEASON = 8;

  const msToNs = (ms) => ms * 1e6;

  // A lap as a session file gave it, kept for this season's Monza. A fifth
  // element carries the rest of the row (best sectors, laps, last lap, tyre).
  function give(laps, name = "practice.json") {
    addUploadedLaps(SERIES, SEASON, TRACK, {
      track: "monza",
      layout: "",
      laps: laps.map(([steamId, driver, lapTimeMs, sectorsMs = null, more = {}]) => ({ steamId, name: driver, car: "f", lapTimeMs, sectorsMs, ...more })),
      file: { name, type: "PRACTICE" },
    });
  }

  // A practice/qualifying snapshot where drivers carry a best lap and its
  // splits — the two things a carried lap is allowed to overwrite.
  function bestSnap({ type = 1, track = "monza", drivers }) {
    const Drivers = {};
    for (const [guid, d] of Object.entries(drivers)) {
      Drivers[guid] = {
        CarInfo: { DriverName: d.name, CarModel: "f", CarSkin: "", CarID: d.carId ?? 1, IsSpectator: false, Tyres: "S" },
        Cars: {
          f: {
            NumLaps: d.laps ?? 5,
            BestLap: d.bestMs ? msToNs(d.bestMs) : 0,
            TyreBestLap: d.bestMs ? "S" : "",
            TopSpeedBestLap: d.topSpeed ?? 300,
            BestLapSplits: d.bestMs
              ? { 0: { SplitIndex: 0, SplitTime: msToNs(30_000) }, 1: { SplitIndex: 1, SplitTime: msToNs(30_000) }, 2: { SplitIndex: 2, SplitTime: msToNs(d.bestMs - 60_000) } }
              : undefined,
            // The driver's own best of each sector, which the server keeps
            // apart from the best lap's splits; here the same three, with the
            // server's own flag on them.
            BestSplits: d.bestMs
              ? { 0: { SplitIndex: 0, SplitTime: msToNs(30_000), IsDriversBest: true }, 1: { SplitIndex: 1, SplitTime: msToNs(30_000), IsDriversBest: true }, 2: { SplitIndex: 2, SplitTime: msToNs(d.bestMs - 60_000), IsDriversBest: true } }
              : undefined,
          },
        },
        TotalNumLaps: d.laps ?? 5,
        IsInPits: d.inPits ?? true,
      };
    }
    return {
      SessionInfo: { Type: type, Track: track, CurrentSessionIndex: 0, Name: "Session" },
      TrackInfo: { name: `NABS ${track}` },
      ConnectedDrivers: { Drivers },
      DisconnectedDrivers: { Drivers: {} },
    };
  }

  const row = (board, name) => board.entries.find((e) => e.name === name);

  const wipe = () => {
    clearTrack(SERIES, SEASON, TRACK);
    __clearImportCache();
  };
  beforeEach(() => {
    reset();
    wipe();
    // The test server's board follows this series, whose active season is 8 —
    // what the relay resolves by the minute in production.
    setBoardScopes(SERVER, [{ series: SERIES, season: SEASON }]);
  });
  afterEach(wipe);

  it("puts a driver who is not on the server onto the board with their time and the server's sectors", () => {
    give([[CARA, "Cara", 94_000, [29_500, 32_000, 32_500]]]);
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));

    const board = getBoard();
    const cara = row(board, "Cara");
    expect(cara).toBeTruthy();
    expect(cara.bestLapMs).toBe(94_000);
    expect(cara.imported).toBe(true);
    expect(cara.onTrack).toBe(false);
    // In the shape a live lap's sectors take, so the same table draws them.
    expect(cara.sectors.map((s) => s.ms)).toEqual([29_500, 32_000, 32_500]);
    expect(cara.sectors[0]).toMatchObject({ driversBest: false, cuts: 0 });
    // What a result file does not carry, the board does not invent.
    expect(cara.topSpeed).toBe(null);
    expect(cara.lapCount).toBe(0);
    // Ranked among the live rows like any other lap: Cara's 1:34 leads.
    expect(board.entries[0].name).toBe("Cara");
    expect(board.session.bestLapMs).toBe(94_000);
  });

  it("a carried lap faster than the live one takes the row, and its splits follow it", () => {
    give([[ALICE, "Alice", 93_000, [29_000, 32_000, 32_000]]]);
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));

    const alice = row(getBoard(), "Alice");
    expect(alice.bestLapMs).toBe(93_000);
    expect(alice.imported).toBe(true);
    expect(alice.sectors.map((s) => s.ms)).toEqual([29_000, 32_000, 32_000]); // not the 1:36's 30/30/36
    expect(alice.topSpeed).toBe(null); // the 1:36's top speed does not belong to the 1:33
    // What the session itself produced is untouched: laps, pits, presence.
    expect(alice.lapCount).toBe(5);
  });

  it("a carried lap without usable splits takes the row with three blanks, never the displaced lap's", () => {
    give([[ALICE, "Alice", 93_000]]);
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));
    const alice = row(getBoard(), "Alice");
    expect(alice.bestLapMs).toBe(93_000);
    expect(alice.sectors).toEqual([null, null, null]);
  });

  it("a driver who has since gone quicker keeps their live lap", () => {
    give([[ALICE, "Alice", 96_000]]);
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 93_000 } } }));

    const alice = row(getBoard(), "Alice");
    expect(alice.bestLapMs).toBe(93_000);
    expect(alice.imported).toBeUndefined();
    expect(alice.sectors[0]?.ms).toBe(30_000); // the live lap's splits stay
  });

  it("a driver who beats their training best on the server takes their own row", () => {
    give([[ALICE, "Alice", 93_000, [29_000, 32_000, 32_000]]]);

    // Out on track, still slower than the time the board is carrying for them.
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));
    expect(row(getBoard(), "Alice").bestLapMs).toBe(93_000);

    // They put in a quicker one. Nothing is pressed, nothing waits: their own
    // lap is the faster of the two and takes the row, splits and all.
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 92_100 } } }));
    const alice = row(getBoard(), "Alice");
    expect(alice.bestLapMs).toBe(92_100);
    expect(alice.imported).toBeUndefined();
    expect(alice.sectors[0]?.ms).toBe(30_000);
  });

  it("an identical time changes nothing about the row", () => {
    give([[ALICE, "Alice", 95_000]]);
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 95_000 } } }));

    const alice = row(getBoard(), "Alice");
    expect(alice.bestLapMs).toBe(95_000);
    expect(alice.imported).toBeUndefined();
    expect(alice.sectors[0]?.ms).toBe(30_000);
  });

  it("qualifying and the race are classifications of their own session, so nothing is carried into them", () => {
    give([[ALICE, "Alice", 90_000], [CARA, "Cara", 89_000]]);

    for (const type of [2, 3]) {
      reset();
      ingest(bestSnap({ type, drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));
      const board = getBoard();
      expect(row(board, "Cara")).toBeUndefined();
      expect(row(board, "Alice").bestLapMs).toBe(96_000);
      expect(row(board, "Alice").imported).toBeUndefined();
    }
  });

  it("carries every driver the files gave, not just the first", () => {
    give([[BOB, "Bob", 95_500], [CARA, "Cara", 94_000]]);
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));

    const board = getBoard();
    expect(board.entries.map((e) => e.name)).toEqual(["Cara", "Bob", "Alice"]);
    expect(board.session.driverCount).toBe(3);
  });

  it("the server moving to another track starts that board from nothing, and back again brings the laps back", () => {
    give([[CARA, "Cara", 94_000]]);
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));
    expect(row(getBoard(), "Cara")).toBeTruthy();

    // The server switches to Spa: nothing has been given for Spa, so it is
    // the session and nothing else — the week starts over, as it should.
    reset();
    ingest(bestSnap({ track: "spa", drivers: { [ALICE]: { name: "Alice", bestMs: 140_000 } } }));
    const spa = getBoard();
    expect(spa.session.trackKey).toBe("spa");
    expect(spa.entries.map((e) => e.name)).toEqual(["Alice"]);

    // Back to Monza: Cara's time is there again, it was never Spa's to lose.
    reset();
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));
    expect(row(getBoard(), "Cara")?.bestLapMs).toBe(94_000);
  });

  it("a new season starts the board from nothing, whatever last season carried for the track", () => {
    give([[CARA, "Cara", 94_000]]);
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));
    expect(row(getBoard(), "Cara")).toBeTruthy();

    // The league switches season 9 on. The relay's next scope refresh sees
    // it, and the same server on the same track carries nothing any more.
    setBoardScopes(SERVER, [{ series: SERIES, season: SEASON + 1 }]);
    expect(getBoard().entries.map((e) => e.name)).toEqual(["Alice"]);
  });

  it("a layout renamed between two weeks is still the same circuit on the board", () => {
    // Monday's file names the layout "nabs_monza_2025"; the server now calls
    // it "monza" with no config. The key differs, the circuit does not.
    addUploadedLaps(SERIES, SEASON, "monza--nabs-monza-2025", {
      track: "monza",
      layout: "nabs_monza_2025",
      laps: [{ steamId: CARA, name: "Cara", car: "f", lapTimeMs: 94_000, sectorsMs: [29_500, 32_000, 32_500] }],
      file: { name: "monday.json", type: "PRACTICE" },
    });
    try {
      ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));
      expect(row(getBoard(), "Cara")?.bestLapMs).toBe(94_000);
    } finally {
      clearTrack(SERIES, SEASON, "monza--nabs-monza-2025");
    }
  });

  it("a carried row reads like a live one: best sectors, potential, laps, last lap, tyre", () => {
    give([[CARA, "Cara", 94_000, [29_500, 32_000, 32_500], { bestSectorsMs: [29_000, 32_000, 32_500], lapStamps: Array.from({ length: 14 }, (_, i) => 1000 + i), lastLapMs: 95_200, lastAt: 1013, tyre: "SS" }]]);
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));

    const cara = row(getBoard(), "Cara");
    expect(cara.bestSectors.map((s) => s.ms)).toEqual([29_000, 32_000, 32_500]);
    expect(cara.potentialMs).toBe(93_500);
    expect(cara.lapCount).toBe(14);
    expect(cara.lastLapMs).toBe(95_200);
    expect(cara.tyre).toBe("SS");
    // The best lap's own S2 and S3 are her best of those sectors: green, as
    // the server would flag them on a live lap. S1 was quicker on another lap.
    expect(cara.sectors.map((s) => s.driversBest)).toEqual([false, true, true]);
    expect(cara.topSpeed).toBe(null);
    expect(cara.numPits).toBe(0);
  });

  it("a live driver's potential counts the week's best sectors, and their laps are the week's plus this session's", () => {
    // Alice's live lap has 30.0/30.0/36.0 splits; the week had a 29.0 S1 and
    // twenty laps, all from before this session.
    const longAgo = Math.floor(Date.now() / 1000) - 3 * 24 * 3600;
    give([[ALICE, "Alice", 97_000, [29_000, 33_000, 35_000], { bestSectorsMs: [29_000, 33_000, 35_000], lapStamps: Array.from({ length: 20 }, (_, i) => longAgo + i * 100), lastLapMs: 98_000, lastAt: longAgo + 1900, tyre: "M" }]]);
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));

    const alice = row(getBoard(), "Alice");
    expect(alice.bestLapMs).toBe(96_000); // her live lap is the quicker one and stays
    expect(alice.imported).toBeUndefined();
    expect(alice.bestSectors.map((s) => s.ms)).toEqual([29_000, 30_000, 35_000]); // best of both, per sector
    expect(alice.potentialMs).toBe(94_000);
    expect(alice.lapCount).toBe(25); // the week's twenty and this session's five
    expect(alice.tyre).toBe("S"); // the live best lap's tyre, not the week's
  });

  it("a file of the session the server is in does not count its laps twice", () => {
    // The session started an hour ago; the file of it (uploaded mid-session)
    // holds Alice's five laps from twenty minutes in, and three from a session
    // the day before.
    const now = Math.floor(Date.now() / 1000);
    const thisSession = Array.from({ length: 5 }, (_, i) => now - 2400 + i * 120);
    const yesterday = [now - 90_000, now - 89_900, now - 89_800];
    give([[ALICE, "Alice", 97_000, null, { lapStamps: [...yesterday, ...thisSession], lastLapMs: 98_000, lastAt: now - 1920 }]]);
    const snap = bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } });
    snap.SessionInfo.ElapsedMilliseconds = 3600 * 1000;
    ingest(snap);

    expect(row(getBoard(), "Alice").lapCount).toBe(5 + 3); // this session's five as the server counts them, plus yesterday's three
  });

  it("a live driver with no lap yet this session shows the week's last lap until they complete one", () => {
    give([[ALICE, "Alice", 97_000, null, { lapStamps: [1000], lastLapMs: 98_500, lastAt: 1000 }]]);
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 0, laps: 0 } } }));
    expect(row(getBoard(), "Alice").lastLapMs).toBe(98_500);
  });

  it("nothing given is the board exactly as it was", () => {
    ingest(bestSnap({ drivers: { [ALICE]: { name: "Alice", bestMs: 96_000 } } }));
    const board = getBoard();
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0].imported).toBeUndefined();
  });
});

// A race whose server simply stops talking — no session-change snapshot, no
// close, nothing — is over, and must not stand on the page as a live board.
// Baku, 2026-09-18: two hours of "safety car out, eight laps to go".
describe("liveTiming: a silent race is over", () => {
  beforeEach(() => {
    reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T19:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const race = () =>
    fullSnap({ laps: 36, drivers: {
      sc: { name: "Pace", laps: 28, pos: 1, carId: 9, skin: "sc", model: "drf_audi_rs5_dtm_2019" },
      g1: { name: "Alice", laps: 28, pos: 2, carId: 1, crossedAt: T0 },
      g2: { name: "Bob", laps: 28, pos: 3, carId: 2, crossedAt: T0 + 344 },
    } });

  it("still reads as live while the server is talking", () => {
    ingest(race());
    const board = getBoard();
    expect(board.ok).toBe(true);
    expect(board.stale).toBe(false);
    expect(board.session.safetyCar).toBe(true);
    expect(board.session.onTrackCount).toBeGreaterThan(0);
    expect(board.session.finished).toBeUndefined();
  });

  it("drops the on-track claims once the feed is stale, before anything is declared over", () => {
    ingest(race());
    vi.advanceTimersByTime(2 * 60 * 1000);
    const board = getBoard();
    expect(board.ok).toBe(true);
    expect(board.stale).toBe(true);
    expect(board.session.finished).toBeUndefined();
    expect(board.session.safetyCar).toBe(false);
    expect(board.session.onTrackCount).toBe(0);
    expect(board.entries.every((e) => !e.onTrack)).toBe(true);
  });

  it("freezes the result after five silent minutes, then goes off air", () => {
    ingest(race());
    vi.advanceTimersByTime(6 * 60 * 1000);
    const frozen = getBoard();
    expect(frozen.ok).toBe(true);
    expect(frozen.session.finished).toBe(true);
    expect(frozen.session.endedBySilence).toBe(true);
    expect(frozen.session.remainingMs).toBe(0);
    expect(frozen.session.safetyCar).toBe(false);
    expect(frozen.lastDataAt).toBe(new Date("2026-09-18T19:00:00Z").getTime());
    // The result of THIS session does not release itself: the snapshot on file
    // is still the race the result is of.
    expect(getBoard().session.finished).toBe(true);
    // The hold runs out, and a silent race is off air rather than live again.
    vi.advanceTimersByTime(16 * 60 * 1000);
    const after = getBoard();
    expect(after.ok).toBe(false);
    expect(after.session).toBe(null);
    expect(after.stale).toBe(true);
  });

  it("comes back to life when the server talks again, and a new race releases the result", () => {
    ingest(race());
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(getBoard().session.finished).toBe(true);
    // The same session resumes sending: live again, no result in front of it
    // (the hold is released by its own clock or a new session; a resumed feed
    // is a live board underneath — the frozen copy stays until then).
    ingest(race());
    const held = getBoard();
    expect(held.stale).toBe(false);
    // A NEW race on the wire releases the old result at once.
    ingest(fullSnap({ name: "Race 2", laps: 20, drivers: {
      g1: { name: "Alice", laps: 1, pos: 1, carId: 1, crossedAt: T0 },
    } }));
    const next = getBoard();
    expect(next.session.finished).toBeUndefined();
    expect(next.session.raceLaps).toBe(20);
  });

  it("leaves a quiet practice up, with nobody on track", () => {
    ingest(fullSnap({ type: 1, name: "Practice", drivers: {
      g1: { name: "Alice", laps: 3, pos: 1, carId: 1 },
    } }));
    vi.advanceTimersByTime(30 * 60 * 1000);
    const board = getBoard();
    expect(board.ok).toBe(true);
    expect(board.session).not.toBe(null);
    expect(board.session.finished).toBeUndefined();
    expect(board.session.onTrackCount).toBe(0);
  });
});
