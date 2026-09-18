import { describe, it, expect } from "vitest";
import { buildTeamHistory, nextRoundOf } from "./teamHistoryService.js";

// A season of six rounds, four of them driven. Two teams and a reserve pool.
const teams = [
  { id: "ferrari", name: "Ferrari", color: "#f00", tier: 1 },
  { id: "mclaren", name: "McLaren", color: "#f80", tier: 1 },
  { id: "reserve", name: "Reserve", color: "#888", tier: 0 },
];
const rounds = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `r${n}`,
  number: n,
  track: `Track ${n}`,
  isCompleted: n <= 4,
  date: null,
  country: null,
}));
const roundOfRace = new Map(rounds.map((r) => [r.id, r.number]));

function history({ drivers, results = [], changes = [], extraRoundOfRace = [] }) {
  const map = new Map(roundOfRace);
  for (const [id, n] of extraRoundOfRace) map.set(id, n);
  return buildTeamHistory({ drivers, teams, rounds, results, changes, roundOfRace: map });
}

describe("nextRoundOf", () => {
  it("is the first round without a result, or one past the end", () => {
    expect(nextRoundOf(rounds)).toBe(5);
    expect(nextRoundOf(rounds.map((r) => ({ ...r, isCompleted: true })))).toBe(7);
    expect(nextRoundOf([])).toBe(1);
  });
});

describe("buildTeamHistory", () => {
  it("reads the driven rounds off the result stamps and the rest off the roster", () => {
    const drivers = [{ id: "duck", name: "Duck", teamId: "mclaren", tier: 1, isActive: true }];
    const results = [1, 2, 3, 4].map((n) => ({ raceId: `r${n}`, driverId: "duck", teamId: "mclaren", subForTeamId: null }));
    const h = history({ drivers, results });
    const d = h.drivers[0];
    expect(d.cells[1]).toEqual({ teamId: "mclaren", status: "driven" });
    expect(d.cells[5]).toEqual({ teamId: "mclaren", status: "expected" });
    expect(d.raced).toBe(4);
    expect(d.stints).toEqual([{ teamId: "mclaren", from: 1, to: 4, races: 4 }]);
    expect(h.moves).toEqual([]);
    expect(h.nextRound).toBe(5);
  });

  it("shows a mid-season move from the stamps even when nobody recorded it", () => {
    // The old way: the admin changed the team on the roster and the rounds
    // since were saved with the new stamp. The grid still shows the move.
    const drivers = [{ id: "duck", name: "Duck", teamId: "ferrari", tier: 1, isActive: true }];
    const results = [
      ...[1, 2].map((n) => ({ raceId: `r${n}`, driverId: "duck", teamId: "mclaren", subForTeamId: null })),
      ...[3, 4].map((n) => ({ raceId: `r${n}`, driverId: "duck", teamId: "ferrari", subForTeamId: null })),
    ];
    const h = history({ drivers, results });
    expect(h.drivers[0].stints).toEqual([
      { teamId: "mclaren", from: 1, to: 2, races: 2 },
      { teamId: "ferrari", from: 3, to: 4, races: 2 },
    ]);
    expect(h.moves).toEqual([
      { driverId: "duck", round: 3, fromTeamId: "mclaren", toTeamId: "ferrari", pending: false, changeId: null },
    ]);
  });

  it("lets a recorded transfer plan the rounds ahead without touching the ones driven", () => {
    const drivers = [{ id: "duck", name: "Duck", teamId: "mclaren", tier: 1, isActive: true }];
    const results = [1, 2, 3, 4].map((n) => ({ raceId: `r${n}`, driverId: "duck", teamId: "mclaren", subForTeamId: null }));
    const changes = [{ id: "c1", driverId: "duck", fromRound: 6, teamId: "ferrari" }];
    const h = history({ drivers, results, changes });
    const d = h.drivers[0];
    expect(d.cells[4]).toEqual({ teamId: "mclaren", status: "driven" });
    expect(d.cells[5]).toEqual({ teamId: "mclaren", status: "expected" });
    expect(d.cells[6]).toEqual({ teamId: "ferrari", status: "planned" });
    expect(d.changes).toEqual([{ id: "c1", fromRound: 6, teamId: "ferrari", pending: true }]);
    expect(h.moves).toEqual([
      { driverId: "duck", round: 6, fromTeamId: "mclaren", toTeamId: "ferrari", pending: true, changeId: "c1" },
    ]);
  });

  it("marks a change whose round is the next one as still pending", () => {
    // applyTransfer has already moved the roster for a change from the next
    // round on; the grid must still say the move has not been driven yet.
    const drivers = [{ id: "duck", name: "Duck", teamId: "ferrari", tier: 1, isActive: true }];
    const results = [1, 2, 3, 4].map((n) => ({ raceId: `r${n}`, driverId: "duck", teamId: "mclaren", subForTeamId: null }));
    const changes = [{ id: "c1", driverId: "duck", fromRound: 5, teamId: "ferrari" }];
    const h = history({ drivers, results, changes });
    expect(h.drivers[0].cells[5]).toEqual({ teamId: "ferrari", status: "planned" });
    expect(h.moves[0]).toMatchObject({ round: 5, fromTeamId: "mclaren", toTeamId: "ferrari", pending: true, changeId: "c1" });
  });

  it("keeps a reserve's own seat when they fill in for a team", () => {
    const drivers = [{ id: "sub", name: "Sub", teamId: "reserve", tier: 0, isActive: true }];
    const results = [
      { raceId: "r2", driverId: "sub", teamId: "reserve", subForTeamId: "ferrari" },
      { raceId: "r3", driverId: "sub", teamId: "reserve", subForTeamId: null },
    ];
    const h = history({ drivers, results });
    const d = h.drivers[0];
    expect(d.cells[1]).toEqual({ teamId: "reserve", status: "absent" });
    expect(d.cells[2]).toEqual({ teamId: "ferrari", status: "sub" });
    expect(d.cells[3]).toEqual({ teamId: "reserve", status: "driven" });
    expect(d.stints).toEqual([
      { teamId: "ferrari", from: 2, to: 2, races: 1 },
      { teamId: "reserve", from: 3, to: 3, races: 1 },
    ]);
    // A sub drive is not a transfer.
    expect(h.moves).toEqual([]);
  });

  it("does not invent a move for a driver who joined late", () => {
    const drivers = [{ id: "late", name: "Late", teamId: "ferrari", tier: 1, isActive: true }];
    const results = [3, 4].map((n) => ({ raceId: `r${n}`, driverId: "late", teamId: "ferrari", subForTeamId: null }));
    const h = history({ drivers, results });
    expect(h.drivers[0].cells[1]).toEqual({ teamId: "ferrari", status: "absent" });
    expect(h.moves).toEqual([]);
  });

  it("reads a sprint weekend under its event's round and prefers the feature result", () => {
    const drivers = [{ id: "duck", name: "Duck", teamId: "mclaren", tier: 1, isActive: true }];
    const results = [
      { raceId: "sprint2", driverId: "duck", teamId: "mclaren", subForTeamId: null },
      { raceId: "r2", driverId: "duck", teamId: "mclaren", subForTeamId: null },
      { raceId: "sprint3", driverId: "duck", teamId: "ferrari", subForTeamId: null },
    ];
    const h = history({ drivers, results, extraRoundOfRace: [["sprint2", 2], ["sprint3", 3]] });
    const d = h.drivers[0];
    expect(d.raced).toBe(2);
    expect(d.cells[2].teamId).toBe("mclaren");
    expect(d.cells[3].teamId).toBe("ferrari");
  });

  it("hides a recorded change that says what the rounds already say", () => {
    const drivers = [{ id: "duck", name: "Duck", teamId: "mclaren", tier: 1, isActive: true }];
    const results = [1, 2, 3, 4].map((n) => ({ raceId: `r${n}`, driverId: "duck", teamId: "mclaren", subForTeamId: null }));
    const changes = [{ id: "c1", driverId: "duck", fromRound: 3, teamId: "mclaren" }];
    const h = history({ drivers, results, changes });
    expect(h.moves).toEqual([]);
    expect(h.drivers[0].changes).toHaveLength(1);
  });
});
