import { describe, it, expect } from "vitest";
import { lapGeometry, projectOnLine, cornerAt, cornerText, pointAt, buildContactMap } from "./contactMap.js";
import { reduceRound } from "./raceContacts.js";

// A square lap of 400 m: 100 m a side, anticlockwise from (0, 0), a point
// every 10 m. The start line is the first point.
function square() {
  const pts = [];
  for (let i = 0; i < 10; i++) pts.push([i * 10, 0]);
  for (let i = 0; i < 10; i++) pts.push([100, i * 10]);
  for (let i = 0; i < 10; i++) pts.push([100 - i * 10, 100]);
  for (let i = 0; i < 10; i++) pts.push([0, 100 - i * 10]);
  return pts;
}

const ME = "765611";
const RIVAL = "765622";
const OTHER_A = "765633";
const OTHER_B = "765644";
const PACE = "765699";

// A result file the way the league's server writes one: laps with
// timestamps, events with impact speed and world position.
function file({ events = [], cars = [] } = {}) {
  const lap = (guid, ts) => ({ DriverGuid: guid, DriverName: guid, LapTime: 60000, Timestamp: ts });
  return {
    TrackName: "ks_square",
    TrackConfig: "",
    SessionConfig: { wait_time: 0 },
    Cars: cars,
    Laps: [ME, RIVAL, OTHER_A, OTHER_B].flatMap((g) => [lap(g, 1060), lap(g, 1120), lap(g, 1180)]),
    Result: [],
    Events: events,
  };
}
const carHit = (a, b, ts, kph, x, z) => ({
  Type: "COLLISION_WITH_CAR",
  Driver: { Guid: a, Name: a },
  OtherDriver: { Guid: b, Name: b },
  ImpactSpeed: kph,
  Timestamp: ts,
  WorldPosition: { X: x, Y: 3, Z: z },
});
const wallHit = (a, ts, kph, x, z) => ({
  Type: "COLLISION_WITH_ENV",
  Driver: { Guid: a, Name: a },
  OtherDriver: { Guid: "", Name: "" },
  ImpactSpeed: kph,
  Timestamp: ts,
  WorldPosition: { X: x, Y: 3, Z: z },
});
const scene = (data) => {
  const r = reduceRound(data);
  return { contacts: r.contacts, walls: r.walls, track: r.track, paceCars: new Set(r.paceCars) };
};

describe("lapGeometry / projectOnLine", () => {
  it("measures a closed lap, including the last point back to the first", () => {
    expect(lapGeometry(square()).total).toBe(400);
  });

  it("finds how far round the lap a point is and how far off the line", () => {
    const g = lapGeometry(square());
    const p = projectOnLine(g, [100, 35]);
    expect(p.s).toBeCloseTo(135, 5);
    expect(p.d).toBeCloseTo(0, 5);
    const off = projectOnLine(g, [50, -8]);
    expect(off.s).toBeCloseTo(50, 5);
    expect(off.d).toBeCloseTo(8, 5);
  });

  it("measures the closing stretch from the last point back to the start", () => {
    const g = lapGeometry(square());
    expect(projectOnLine(g, [0, 5]).s).toBeCloseTo(395, 5);
  });

  it("finds the point a distance round the lap, past the last point too", () => {
    const g = lapGeometry(square());
    expect(pointAt(g, 135)).toEqual([100, 35]);
    expect(pointAt(g, 395)).toEqual([0, 5]);
    expect(pointAt(g, 400)).toEqual([0, 0]);
  });

  it("gives nothing for a line too short to be a lap", () => {
    expect(lapGeometry([[0, 0], [1, 1]])).toBeNull();
  });
});

describe("cornerAt", () => {
  const corners = [
    { at: 25, turn: 1, name: "" },
    { at: 50, turn: 2, name: "Hairpin" },
  ];
  it("names the corner a contact is braking into", () => {
    expect(cornerAt(corners, 90, 1000)).toBe("T1"); // 160 m before T1
  });
  it("names the corner just behind, but only for a short way", () => {
    expect(cornerAt(corners, 300, 1000)).toBe("T1"); // 50 m after T1
    expect(cornerAt(corners, 400, 1000)).toBe("T2 Hairpin"); // 150 m after T1, 100 m before T2
  });
  it("leaves a straight unnamed", () => {
    expect(cornerAt(corners, 800, 1000)).toBeNull();
  });
  it("goes round the start line", () => {
    expect(cornerAt([{ at: 2, turn: 1 }], 990, 1000)).toBe("T1"); // 30 m before, across the line
  });
  it("writes a corner the way the site does", () => {
    expect(cornerText({ turn: 4, name: "Roggia" })).toBe("T4 Roggia");
    expect(cornerText({ turn: 7, name: "" })).toBe("T7");
    expect(cornerText({ turn: null, name: "Eau Rouge" })).toBe("Eau Rouge");
  });
});

describe("reduceRound positions", () => {
  it("keeps where each contact happened and the circuit it was on", () => {
    const r = reduceRound(file({ events: [carHit(ME, RIVAL, 1070, 30, 100, 35)] }));
    expect(r.contacts[0].pos).toEqual([100, 35]);
    expect(r.track).toEqual({ name: "ks_square", layout: "" });
  });

  it("counts wall hits like the stored figure: from 15 km/h, once per merge window", () => {
    const r = reduceRound(
      file({
        events: [
          wallHit(ME, 1070, 40, 10, 0),
          wallHit(ME, 1071, 35, 11, 0), // the same slide along the wall
          wallHit(ME, 1100, 9, 50, 0), // too light to count
          wallHit(ME, 1150, 22, 100, 50),
        ],
      })
    );
    expect(r.walls.map((w) => w.at)).toEqual([1070, 1150]);
    expect(r.walls[1].lap).toBe(3);
  });

  it("knows the pace car by its skin", () => {
    const r = reduceRound(file({ cars: [{ Driver: { Guid: PACE }, Skin: "NABS Safetycar", Model: "x" }] }));
    expect(r.paceCars).toEqual([PACE]);
  });
});

describe("buildContactMap", () => {
  const corners = [
    { at: 25, turn: 1, name: "" },
    { at: 75, turn: 3, name: "" },
  ];

  it("numbers the driver's contacts and wall hits in the order they happened", () => {
    const s = scene(
      file({
        events: [
          carHit(RIVAL, ME, 1065, 28, 95, 0), // 5 m before T1 (at 100 m), ME is the OtherDriver
          wallHit(ME, 1090, 50, 100, 60),
          carHit(ME, OTHER_A, 1130, 6, 10, 100), // a light tap: in the driver's list all the same
        ],
      })
    );
    const map = buildContactMap({ scene: s, guid: ME, line: square(), corners });
    expect(map.mine.map((m) => [m.n, m.kind, m.corner])).toEqual([
      [1, "car", "T1"],
      [2, "wall", "T1"], // 60 m after T1
      [3, "car", "T3"],
    ]);
    expect(map.mine[0].other).toEqual({ guid: RIVAL, name: RIVAL });
    expect(map.mine.map((m) => m.counted)).toEqual([true, true, false]); // the 6 km/h tap is listed, not counted
    expect(map.mine[0].lap).toBe(2); // lap 1 ended at 1060
    expect(map.mine[2].lap).toBe(3);
  });

  it("shows the rest of the field as dots, from the counted speed up, without the pace car", () => {
    const s = scene(
      file({
        cars: [{ Driver: { Guid: PACE }, Skin: "sc", Model: "x" }],
        events: [
          carHit(OTHER_A, OTHER_B, 1070, 25, 90, 0),
          carHit(OTHER_A, OTHER_B, 1100, 5, 100, 50), // a tap: not on the field map
          carHit(PACE, OTHER_B, 1110, 40, 100, 70), // the pace car
          carHit(ME, RIVAL, 1150, 30, 80, 0),
        ],
      })
    );
    const map = buildContactMap({ scene: s, guid: ME, line: square(), corners });
    expect(map.field).toEqual([[90, 0, 25]]);
    expect(map.mine).toHaveLength(1);
    expect(map.fieldCount).toBe(2);
    expect(map.busiest).toEqual({ corner: "T1", count: 2 });
    expect(map.byCorner).toEqual([{ corner: "T1", count: 2 }]);
    expect(map.labels).toEqual([{ text: "T1", pos: [100, 0] }]);
    expect(map.mine[0]).not.toHaveProperty("c");
  });

  it("lists the corners most contact happened at, most first, level ones round the lap", () => {
    const s = scene(
      file({
        events: [
          carHit(OTHER_A, OTHER_B, 1070, 25, 10, 100), // 10 m before T3 (at 300 m)
          carHit(OTHER_A, OTHER_B, 1100, 25, 95, 0), // T1
          carHit(RIVAL, OTHER_B, 1130, 25, 20, 100), // T3
          carHit(RIVAL, OTHER_A, 1160, 25, 0, 50), // 50 m past T3: still T3
        ],
      })
    );
    const map = buildContactMap({ scene: s, guid: ME, line: square(), corners });
    expect(map.byCorner).toEqual([
      { corner: "T3", count: 3 },
      { corner: "T1", count: 1 },
    ]);
    expect(map.fieldCount).toBe(4);
    expect(map.elsewhere).toBe(0);
    expect(map.labels.map((l) => l.text).sort()).toEqual(["T1", "T3"]);

    const level = scene(file({ events: [carHit(OTHER_A, OTHER_B, 1070, 25, 10, 100), carHit(OTHER_A, OTHER_B, 1100, 25, 95, 0)] }));
    expect(buildContactMap({ scene: level, guid: ME, line: square(), corners }).byCorner.map((b) => b.corner)).toEqual(["T1", "T3"]);
  });

  it("keeps a driver's own contact with the pace car in their list, out of the tally", () => {
    const s = scene(
      file({
        cars: [{ Driver: { Guid: PACE }, Skin: "sc", Model: "x" }],
        events: [carHit(PACE, ME, 1070, 30, 95, 0)],
      })
    );
    const map = buildContactMap({ scene: s, guid: ME, line: square(), corners });
    expect(map.mine).toHaveLength(1);
    expect(map.fieldCount).toBe(0);
  });

  it("keeps a contact off the map when it is nowhere near the circuit, but in the list", () => {
    const s = scene(file({ events: [carHit(ME, RIVAL, 1070, 30, 500, 500), carHit(OTHER_A, OTHER_B, 1080, 30, 50, 0)] }));
    const map = buildContactMap({ scene: s, guid: ME, line: square(), corners });
    expect(map.mine[0].pos).toBeNull();
    expect(map.mine[0].n).toBe(1);
    expect(map.field).toHaveLength(1);
  });

  it("gives up when the file says nothing about where anything happened", () => {
    const hit = carHit(ME, RIVAL, 1070, 30, 0, 0);
    delete hit.WorldPosition;
    const s = scene(file({ events: [hit] }));
    expect(buildContactMap({ scene: s, guid: ME, line: square(), corners })).toBeNull();
  });

  it("draws a clean race: the circuit and the field, nothing of the driver's", () => {
    const s = scene(file({ events: [carHit(OTHER_A, OTHER_B, 1070, 25, 90, 0)] }));
    const map = buildContactMap({ scene: s, guid: ME, line: square(), corners });
    expect(map.mine).toEqual([]);
    expect(map.field).toHaveLength(1);
    expect(map.lapM).toBe(400);
  });

  it("needs a circuit", () => {
    const s = scene(file());
    expect(buildContactMap({ scene: s, guid: ME, line: null, corners })).toBeNull();
  });
});
