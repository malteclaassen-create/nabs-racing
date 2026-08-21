import { describe, it, expect, beforeEach } from "vitest";
import { __testing } from "./liveTiming.js";

const { accumulateStints, stintsFor, ingest, getBoard, raceSecond, reset } = __testing;

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
