import { describe, it, expect } from "vitest";
import { teamForRound, byDriver } from "./driverTransfers.js";

// The rule that turns a list of "from round N they drive for X" statements into
// an answer for one round. Everything else in the service hangs off it: which
// team a round is saved with, which rounds a backdated change has to correct.

const changes = [
  { driverId: "malte", fromRound: 5, teamId: "ferrari" },
  { driverId: "malte", fromRound: 9, teamId: "reserve" },
];

describe("teamForRound", () => {
  it("says nothing about the rounds before the first change", () => {
    // Rounds 1-4 were driven under whatever the caller already knows, so the
    // fallback stands and no round gets rewritten behind the admin's back.
    expect(teamForRound(changes, 4)).toBe(null);
    expect(teamForRound(changes, 4, "renault")).toBe("renault");
  });

  it("applies from its own round on", () => {
    expect(teamForRound(changes, 5, "renault")).toBe("ferrari");
    expect(teamForRound(changes, 8, "renault")).toBe("ferrari");
  });

  it("lets a later change win from where it starts", () => {
    expect(teamForRound(changes, 9, "renault")).toBe("reserve");
    expect(teamForRound(changes, 12, "renault")).toBe("reserve");
  });

  it("has no answer for a round that is not a round", () => {
    // A training night or a special event: no number, nothing to attribute.
    expect(teamForRound(changes, null, "renault")).toBe("renault");
  });

  it("leaves a driver with no changes to their fallback", () => {
    expect(teamForRound([], 7, "renault")).toBe("renault");
    expect(teamForRound(undefined, 7, "renault")).toBe("renault");
  });
});

describe("byDriver", () => {
  it("groups the season's changes per driver", () => {
    const map = byDriver([...changes, { driverId: "steve", fromRound: 3, teamId: "lotus" }]);
    expect(map.get("malte")).toHaveLength(2);
    expect(teamForRound(map.get("steve"), 3)).toBe("lotus");
    expect(map.get("nobody")).toBeUndefined();
  });
});
