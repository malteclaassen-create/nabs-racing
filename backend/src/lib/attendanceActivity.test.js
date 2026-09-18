import { describe, it, expect } from "vitest";
import { activityFor, byNeedsAttention, tallyStates, INACTIVE_AFTER } from "./attendanceActivity.js";

// The verdict is the whole feature, and it is pure (rounds + two maps in, a
// state out), so every rule it makes can be pinned down without a database.

const ROUNDS = [1, 2, 3, 4, 5].map((n) => ({ id: `r${n}`, number: n, track: `Track ${n}`, date: `2026-0${n}-01` }));

const results = (obj) => new Map(Object.entries(obj));
const rsvps = (obj) => new Map(Object.entries(obj));

describe("activityFor", () => {
  it("counts a DNF as having turned up and a DNS as not", () => {
    const a = activityFor(ROUNDS, results({ r1: "FINISHED", r2: "DNF", r3: "DSQ", r4: "DNS" }), rsvps({}));
    expect(a.starts).toBe(3);
    expect(a.lastStart.number).toBe(3);
  });

  it("calls somebody who raced the last round active", () => {
    const a = activityFor(ROUNDS, results({ r5: "FINISHED" }), rsvps({}));
    expect(a.state).toBe("active");
    expect(a.roundsSinceSeen).toBe(0);
  });

  it("calls one round of silence quiet, not inactive", () => {
    const a = activityFor(ROUNDS, results({ r4: "FINISHED" }), rsvps({}));
    expect(a.state).toBe("quiet");
    expect(a.roundsSinceSeen).toBe(1);
  });

  it("calls three rounds of silence inactive", () => {
    const a = activityFor(ROUNDS, results({ r2: "FINISHED" }), rsvps({}));
    expect(a.roundsSinceSeen).toBe(INACTIVE_AFTER);
    expect(a.state).toBe("inactive");
  });

  it("nothing at all all season is never, not inactive", () => {
    const a = activityFor(ROUNDS, results({}), rsvps({}));
    expect(a.state).toBe("never");
    expect(a.lastSeen).toBe(null);
    expect(a.roundsSinceSeen).toBe(null);
    expect(a.silent).toBe(5);
  });

  it("answering counts as a sign of life even when they never race", () => {
    // The reserve case: needed for nothing, answers every round anyway.
    const a = activityFor(ROUNDS, results({}), rsvps({ r4: "DECLINED", r5: "DECLINED" }));
    expect(a.starts).toBe(0);
    expect(a.state).toBe("active");
    expect(a.lastSeen.raced).toBe(false);
    // Racing and being there are still reported apart, so the table can say so.
    expect(a.roundsSinceStart).toBe(null);
  });

  it("an answer without a start leaves the driver quiet on the racing count", () => {
    const a = activityFor(ROUNDS, results({ r1: "FINISHED" }), rsvps({ r5: "TENTATIVE" }));
    expect(a.state).toBe("active");
    expect(a.roundsSinceStart).toBe(4);
    expect(a.tentative).toBe(1);
  });

  it("counts an accepted round they never started as a no-show", () => {
    const a = activityFor(
      ROUNDS,
      results({ r1: "FINISHED", r2: "DNS" }),
      rsvps({ r1: "ACCEPTED", r2: "ACCEPTED", r3: "ACCEPTED" })
    );
    expect(a.noShows).toBe(2); // entered and didn't start, plus never entered
    expect(a.accepted).toBe(3);
  });

  it("reports one cell per round, in the season's order", () => {
    const a = activityFor(ROUNDS, results({ r3: "FINISHED" }), rsvps({ r3: "ACCEPTED" }));
    expect(a.cells.map((c) => c.raceId)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(a.cells[2]).toMatchObject({ raced: true, rsvp: "ACCEPTED", seen: true });
    expect(a.cells[0].seen).toBe(false);
  });

  it("a season with no completed rounds yet says never rather than crashing", () => {
    const a = activityFor([], results({}), rsvps({}));
    expect(a.state).toBe("never");
    expect(a.rounds).toBe(0);
  });
});

describe("tallyStates", () => {
  it("always reports all four states, zeros included", () => {
    expect(tallyStates([{ state: "active" }, { state: "quiet" }, { state: "active" }])).toEqual({
      active: 2,
      quiet: 1,
      inactive: 0,
      never: 0,
    });
  });
});

describe("byNeedsAttention", () => {
  it("puts the longest silence first and the still-racing last", () => {
    const rows = [
      { name: "Active", state: "active", roundsSinceSeen: 0, starts: 5 },
      { name: "Gone", state: "never", roundsSinceSeen: null, starts: 0 },
      { name: "Quiet", state: "quiet", roundsSinceSeen: 2, starts: 3 },
      { name: "Inactive", state: "inactive", roundsSinceSeen: 4, starts: 1 },
    ];
    expect([...rows].sort(byNeedsAttention).map((r) => r.name)).toEqual(["Gone", "Inactive", "Quiet", "Active"]);
  });

  it("breaks a tie by starts, then by name, so the order never wobbles", () => {
    const rows = [
      { name: "Zoe", state: "quiet", roundsSinceSeen: 1, starts: 2 },
      { name: "Alex", state: "quiet", roundsSinceSeen: 1, starts: 2 },
      { name: "Sam", state: "quiet", roundsSinceSeen: 1, starts: 1 },
    ];
    expect([...rows].sort(byNeedsAttention).map((r) => r.name)).toEqual(["Sam", "Alex", "Zoe"]);
  });
});
