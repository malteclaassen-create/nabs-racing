import { describe, it, expect, beforeEach } from "vitest";
import { __testing } from "./liveTiming.js";

const { accumulateStints, stintsFor, ingest, getBoard, reset } = __testing;

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

// A full ET200 snapshot with several drivers, for the board-level tests
// (leavers held during a race, result frozen past the session change).
function fullSnap({ type = 3, name = "Race", drivers }) {
  const Drivers = {};
  for (const [guid, d] of Object.entries(drivers)) {
    Drivers[guid] = {
      CarInfo: { DriverName: d.name, CarModel: "f", Tyres: "S", CarID: d.carId ?? 1, IsSpectator: false },
      Cars: { f: { NumLaps: d.laps ?? 1 } },
      TotalNumLaps: d.laps ?? 1,
      RacePosition: d.pos ?? null,
      NumPits: 0,
      IsInPits: false,
    };
  }
  return {
    SessionInfo: { Type: type, Track: "monza", CurrentSessionIndex: 0, Name: name },
    TrackInfo: { name: "NABS Monza" },
    ConnectedDrivers: { Drivers },
    DisconnectedDrivers: { Drivers: {} },
  };
}

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
