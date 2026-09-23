import { describe, it, expect } from "vitest";
import { incidentWatch } from "./incidentWatch.js";

// The incident watch adds up what the result files counted per person and
// round. What matters most is what it does NOT do: count a round nobody
// measured as a clean one, count a sprint weekend as two rounds, or show one
// person twice.

const ROUNDS = [
  { id: "r1", number: 1, track: "Spa" },
  { id: "r2", number: 2, track: "Monza" },
  { id: "r3", number: 3, track: "Imola" },
  { id: "r4", number: 4, track: "Suzuka" },
];
const roundOf = new Map([...ROUNDS.map((r) => [r.id, r.id]), ["r2s", "r2"]]);
const row = (id, over = {}) => ({ id, name: id, team: "Team", tier: 1, isActive: true, ...over });
const res = (raceId, driverId, t = {}, status = "FINISHED") => ({
  raceId,
  driverId,
  status,
  contacts: null,
  envContacts: null,
  cuts: null,
  gamePenalties: null,
  ...t,
});
const tel = (contacts, envContacts = 0, cuts = 0, gamePenalties = 0) => ({ contacts, envContacts, cuts, gamePenalties });
const byName = (out) => Object.fromEntries(out.drivers.map((d) => [d.name, d]));

describe("incidentWatch", () => {
  it("averages over the rounds a driver started and that were measured", () => {
    const out = incidentWatch({
      rounds: ROUNDS,
      roundOf,
      rows: [row("a")],
      results: [
        res("r1", "a", tel(4, 1, 3, 1)),
        // Imported before the telemetry columns: no data, NOT zero.
        res("r2", "a"),
        res("r3", "a", tel(2, 0, 1, 0)),
        // Entered, never started: not a race of theirs at all.
        res("r4", "a", tel(9, 9, 9, 9), "DNS"),
      ],
    });
    const [a] = out.drivers;
    expect(a.races).toBe(3);
    expect(a.totals).toEqual({ contacts: 6, envContacts: 1, cuts: 4, gamePenalties: 1 });
    expect(a.measuredRaces.contacts).toBe(2);
    expect(a.averages).toEqual({ contacts: 3, envContacts: 0.5, cuts: 2, gamePenalties: 0.5 });
    const r2 = a.rounds.find((r) => r.roundId === "r2");
    expect(r2).toMatchObject({ started: true, contacts: null, envContacts: null });
    expect(a.rounds.find((r) => r.roundId === "r4").started).toBe(false);
    expect(out.rounds.map((r) => [r.id, r.measured])).toEqual([
      ["r1", true],
      ["r2", false],
      ["r3", true],
      ["r4", false],
    ]);
  });

  it("has no average at all for a driver with no measured round", () => {
    const [a] = incidentWatch({ rounds: ROUNDS, roundOf, rows: [row("a")], results: [res("r1", "a")] }).drivers;
    expect(a.races).toBe(1);
    expect(a.totals.contacts).toBe(null);
    expect(a.averages.contacts).toBe(null);
  });

  it("folds a sprint into its round and one person's two rows into one line", () => {
    const personOf = (id) => ({ d1: "steve", d1b: "steve", s6: "steve" })[id] || id;
    const out = incidentWatch({
      rounds: ROUNDS,
      roundOf,
      personOf,
      // The old row is inactive and s6 is last season's; the line is shown as
      // this season's roster row.
      rows: [
        row("s6", { name: "Steve S6", current: false }),
        row("d1", { name: "Steve old", isActive: false }),
        row("d1b", { name: "Steve", team: "New" }),
      ],
      results: [res("r2s", "d1", tel(2)), res("r2", "d1b", tel(1)), res("r3", "d1b", tel(0))],
    });
    expect(out.drivers).toHaveLength(1);
    const [s] = out.drivers;
    expect(s).toMatchObject({ name: "Steve", team: "New", races: 2 });
    expect(s.rounds.find((r) => r.roundId === "r2").contacts).toBe(3);
    expect(s.averages.contacts).toBe(1.5);
  });

  it("keeps the sprint's number when the feature has none", () => {
    const [a] = incidentWatch({
      rounds: ROUNDS,
      roundOf,
      rows: [row("a")],
      results: [res("r2s", "a", tel(2)), res("r2", "a")],
    }).drivers;
    expect(a.rounds.find((r) => r.roundId === "r2").contacts).toBe(2);
  });

  it("counts the reports naming a driver and the penalties among them, per round", () => {
    const out = incidentWatch({
      rounds: ROUNDS,
      roundOf,
      rows: [row("a"), row("b")],
      results: [res("r1", "a", tel(1)), res("r1", "b", tel(1))],
      reports: [
        { raceId: "r1", accusedDriverId: "a", status: "PENALTY" },
        { raceId: "r1", accusedDriverId: "a", status: "NO_PENALTY" },
        { raceId: "r2s", accusedDriverId: "a", status: "NEW" },
        // Names nobody: belongs to no line.
        { raceId: "r1", accusedDriverId: null, status: "NEW" },
        // Named in a round they did not start: still listed, with no races.
        { raceId: "r3", accusedDriverId: "c", status: "PENALTY" },
      ],
    });
    const d = byName(out);
    expect(d.a).toMatchObject({ reports: 3, penalties: 1 });
    expect(d.a.rounds.find((r) => r.roundId === "r2")).toMatchObject({ reports: 1, penalties: 0, started: false });
    expect(d.b).toMatchObject({ reports: 0, penalties: 0 });
    expect(d["Unknown driver"]).toMatchObject({ races: 0, reports: 1, penalties: 1 });
  });

  it("looks at the last N rounds only when asked", () => {
    const results = [res("r1", "a", tel(10)), res("r3", "a", tel(1)), res("r4", "a", tel(3)), res("r1", "old", tel(5))];
    const out = incidentWatch({ rounds: ROUNDS, roundOf, rows: [row("a"), row("old")], results, last: 3 });
    expect(out.rounds.map((r) => r.id)).toEqual(["r2", "r3", "r4"]);
    // Only raced in round 1, which is outside the window.
    expect(out.drivers.map((d) => d.name)).toEqual(["a"]);
    expect(out.drivers[0]).toMatchObject({ races: 2, averages: expect.objectContaining({ contacts: 2 }) });
    expect(incidentWatch({ rounds: ROUNDS, roundOf, rows: [row("a")], results, last: 0 }).rounds).toHaveLength(4);
  });

  it("puts the most contacts per race first and unmeasured drivers last", () => {
    const out = incidentWatch({
      rounds: ROUNDS,
      roundOf,
      rows: [row("clean"), row("busy"), row("unknown")],
      results: [res("r1", "clean", tel(0)), res("r1", "busy", tel(4)), res("r1", "unknown")],
    });
    expect(out.drivers.map((d) => d.name)).toEqual(["busy", "clean", "unknown"]);
  });
});
