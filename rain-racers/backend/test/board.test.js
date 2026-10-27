import { describe, it, expect } from "vitest";
import { buildBoard, createProgress } from "../src/live/board.js";

const NS = 1e6;
const driver = (id, name, { laps, best, last, model = "gt3" }) => ({
  CarInfo: { DriverName: name, CarID: id, CarModel: model, RaceNumber: id + 1 },
  Cars: { [model]: { NumLaps: laps, BestLap: best * NS, LastLap: last * NS } },
});

const snapshot = (type) => ({
  SessionInfo: { Type: type, Name: "S", Track: "spa", TrackConfig: "", Laps: 20 },
  ConnectedDrivers: {
    Drivers: {
      g1: driver(0, "Ann", { laps: 5, best: 120000, last: 121000 }),
      g2: driver(1, "Bob", { laps: 5, best: 119000, last: 120000 }),
      g3: driver(2, "Cat", { laps: 4, best: 125000, last: 126000 }),
    },
  },
  DisconnectedDrivers: { Drivers: { g4: driver(3, "Dan", { laps: 2, best: 118000, last: 130000 }) } },
});

describe("buildBoard", () => {
  it("orders practice by best lap and gives the gap to the fastest", () => {
    const b = buildBoard({ status: snapshot(1), connected: true });
    expect(b.session.type).toBe("Practice");
    expect(b.rows.map((r) => r.name)).toEqual(["Dan", "Bob", "Ann", "Cat"]);
    expect(b.rows[1].gap).toEqual({ ms: 1000 });
    expect(b.fastestLapMs).toBe(118000);
    expect(b.rows[0].online).toBe(false);
  });

  it("orders a race by the server's positions and works out gaps", () => {
    const progress = createProgress();
    const live = new Map([
      [0, { CarID: 0, RacePosition: 1 }],
      [1, { CarID: 1, RacePosition: 2 }],
      [2, { CarID: 2, RacePosition: 3 }],
    ]);
    progress.snapshot("g1", 5);
    progress.snapshot("g2", 5);
    progress.snapshot("g3", 4);
    progress.update("g1", 0.5);
    progress.update("g2", 0.45);
    progress.update("g3", 0.4);
    const b = buildBoard({ status: snapshot(3), liveByCar: live, progress, connected: true });
    expect(b.rows.map((r) => r.name)).toEqual(["Ann", "Bob", "Cat", "Dan"]);
    expect(b.rows[1].gap).toEqual({ ms: 6000 }); // 0.05 laps of a 120 s lap
    expect(b.rows[2].gap).toEqual({ laps: 1 });
    expect(b.rows[3].gap).toBe(null); // not on the server any more
  });

  it("never puts a Steam id on the board", () => {
    const b = buildBoard({ status: snapshot(1) });
    expect(JSON.stringify(b)).not.toMatch(/g1|g2|g3|g4/);
  });

  it("counts a lap when the spline wraps before the next snapshot", () => {
    const p = createProgress();
    p.snapshot("x", 3);
    p.update("x", 0.95);
    p.update("x", 0.02);
    expect(p.of("x")).toBeCloseTo(4.02);
    p.snapshot("x", 4);
    expect(p.of("x")).toBeCloseTo(4.02);
  });
});

describe("live board map", () => {
  it("places the track's map and every car on it", async () => {
    const { buildBoard } = await import("../src/live/board.js");
    const status = {
      SessionInfo: { Track: "phakisa_circuit", TrackConfig: "", Type: 1, Name: "Practice" },
      TrackInfo: { name: "Phakisa Freeway" },
      TrackMapData: { width: 1680, height: 1530, scale_factor: 0.6087, offset_x: 502.1, offset_y: 380.6, padding: 40 },
      ConnectedDrivers: { Drivers: { 7656119: { CarInfo: { CarID: 8, DriverName: "Endriu" }, Cars: {} } } },
    };
    const board = buildBoard({ status, liveByCar: new Map([[8, { Pos: { X: -472.66, Y: 5, Z: -77.97 } }]]) });
    expect(board.session.track).toBe("Phakisa Freeway");
    expect(board.session.map).toMatchObject({ path: "/content/tracks/phakisa_circuit/map.png", width: 1680, scale: 0.6087, offsetZ: 380.6, padding: 40 });
    expect(board.rows[0].pos).toEqual({ x: -472.7, z: -78 });
  });
});
