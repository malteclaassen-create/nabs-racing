import { describe, it, expect, beforeEach, vi } from "vitest";
import { __testing } from "./liveTiming.js";
import { listProvisional, __resetProvisional } from "./provisionalResults.js";

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
      IsInPits: false,
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

// The provisional result: the board's classification kept the moment the
// race is over (services/provisionalResults.js), so the live page can show
// it after the server has moved on.
describe("provisional result", () => {
  beforeEach(() => {
    reset();
    __resetProvisional();
  });

  // A two-car race: SessionInfo.Laps is the distance the leader has to cover.
  function race({ leaderLaps, otherLaps, otherInPits = false, sessionType = 3, index = 0 }) {
    const s = snap({ type: sessionType, guid: "g1", laps: leaderLaps, name: "Alice" });
    s.SessionInfo.Laps = 20;
    s.SessionInfo.CurrentSessionIndex = index;
    s.ConnectedDrivers.Drivers.g2 = {
      CarInfo: { DriverName: "Bob", CarModel: "f", Tyres: "M", IsSpectator: false },
      Cars: { f: { NumLaps: otherLaps } },
      TotalNumLaps: otherLaps,
      NumPits: 1,
      IsInPits: otherInPits,
    };
    return s;
  }
  // The server moving on: a different session in the same event.
  function practiceAfter() {
    const s = snap({ type: 1, laps: 0 });
    s.SessionInfo.CurrentSessionIndex = 1;
    s.SessionInfo.Name = "Practice";
    return s;
  }

  it("is taken once the leader has the distance and the field is home, and finalised when the session moves on", () => {
    ingest(race({ leaderLaps: 10, otherLaps: 9 }));
    expect(listProvisional("test")).toEqual([]);
    // Leader across the line, Bob a lap down and still touring: not yet.
    ingest(race({ leaderLaps: 20, otherLaps: 18 }));
    expect(listProvisional("test")).toEqual([]);
    // Bob completes his last lap (19 of 20, one down): everybody is home.
    ingest(race({ leaderLaps: 20, otherLaps: 19 }));
    let list = listProvisional("test");
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ final: false, completed: true, laps: 20, raceLaps: 20, drivers: 2 });
    expect(list[0].entries.map((e) => e.name)).toEqual(["Alice", "Bob"]);
    // The server goes back to practice: same id, now final.
    const id = list[0].id;
    ingest(practiceAfter());
    list = listProvisional("test");
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(id);
    expect(list[0]).toMatchObject({ final: true, completed: true });
  });

  it("a race the server left mid-way is kept, marked as not completed", () => {
    ingest(race({ leaderLaps: 12, otherLaps: 11 }));
    ingest(practiceAfter());
    const list = listProvisional("test");
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ final: true, completed: false, laps: 12 });
  });

  it("an aborted start (under two laps) leaves nothing behind", () => {
    ingest(race({ leaderLaps: 1, otherLaps: 1 }));
    ingest(practiceAfter());
    expect(listProvisional("test")).toEqual([]);
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
  beforeEach(() => {
    reset();
    __resetProvisional();
  });

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
    expect(getBoard().entries.map((e) => e.name)).toEqual(["Bob", "Alice"]);
    // And that is the order the provisional result was taken in.
    const list = listProvisional("test");
    expect(list.length).toBe(1);
    expect(list[0].entries.map((e) => e.name)).toEqual(["Bob", "Alice"]);
    expect(list[0].entries[1].gapToLeaderMs).toBe(5000);
  });
});
