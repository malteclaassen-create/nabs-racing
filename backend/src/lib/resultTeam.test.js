import { describe, it, expect } from "vitest";
import { resultTeamId, resultTeam } from "./resultTeam.js";

// The whole point of this resolver is that a driver moving to another team
// mid-season must not drag their finished rounds along. The cases below are the
// ones that decide that, in the order the resolver consults them.

const drivers = new Map([
  ["alice", { id: "alice", teamId: "ferrari" }],
  ["bob", { id: "bob", teamId: "reserve" }],
]);
const teams = new Map([
  ["ferrari", { id: "ferrari", name: "Ferrari", tier: 1 }],
  ["mclaren", { id: "mclaren", name: "McLaren", tier: 1 }],
  ["reserve", { id: "reserve", name: "Reserve", tier: 0 }],
]);

describe("resultTeamId", () => {
  it("keeps the team a finished round was stamped with, not the driver's team today", () => {
    // Alice drove round 3 for McLaren and has since moved to Ferrari.
    expect(resultTeamId({ driverId: "alice", teamId: "mclaren" }, drivers)).toBe("mclaren");
  });

  it("falls back to the driver's team for a round that carries no stamp", () => {
    // Every round saved before the column existed, and every unsaved result the
    // import preview builds.
    expect(resultTeamId({ driverId: "alice" }, drivers)).toBe("ferrari");
  });

  it("lets a reserve's drive count for the team they subbed for", () => {
    expect(resultTeamId({ driverId: "bob", subForTeamId: "mclaren", teamId: "reserve" }, drivers)).toBe("mclaren");
  });

  it("has nothing to say about a driver it has never heard of", () => {
    expect(resultTeamId({ driverId: "ghost" }, drivers)).toBe(null);
    expect(resultTeamId(null, drivers)).toBe(null);
  });
});

describe("resultTeam", () => {
  it("answers with the stamped team itself", () => {
    expect(resultTeam({ driverId: "alice", teamId: "mclaren" }, drivers, teams).name).toBe("McLaren");
  });

  it("stays null when the stamped team is gone from this season", () => {
    expect(resultTeam({ driverId: "alice", teamId: "deleted" }, drivers, teams)).toBe(null);
  });
});
