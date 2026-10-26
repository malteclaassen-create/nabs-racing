import { describe, it, expect } from "vitest";
import { teamLineageKey, sameTeamBySeason } from "./teamLineage.js";

describe("teamLineageKey", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(teamLineageKey("Mclaren")).toBe(teamLineageKey("McLaren"));
    expect(teamLineageKey("Redbull")).toBe(teamLineageKey("Red Bull"));
    expect(teamLineageKey(" Brawn-GP ")).toBe(teamLineageKey("Brawn GP"));
  });

  it("joins up renamed teams", () => {
    expect(teamLineageKey("Porsche Martini")).toBe(teamLineageKey("Porsche"));
    expect(teamLineageKey("BMW Sauber")).toBe(teamLineageKey("Sauber"));
  });

  it("keeps different teams apart", () => {
    expect(teamLineageKey("BMW")).not.toBe(teamLineageKey("Sauber"));
    expect(teamLineageKey("Red Bull")).not.toBe(teamLineageKey("Toro Rosso"));
  });
});

describe("sameTeamBySeason", () => {
  const teams = [
    { id: "porsche", seasonId: "s7", name: "Porsche Martini" },
    { id: "s6_porsche", seasonId: "s6", name: "Porsche" },
    { id: "s6_ferrari", seasonId: "s6", name: "Ferrari" },
    { id: "s5_mclaren", seasonId: "s5", name: "McLaren" },
  ];

  it("finds the team in every season under whatever name it raced", () => {
    const m = sameTeamBySeason(teams, "Porsche Martini");
    expect([...m].map(([s, t]) => [s, t.id])).toEqual([
      ["s7", "porsche"],
      ["s6", "s6_porsche"],
    ]);
  });

  it("prefers the exact spelling when a season has two rows of the team", () => {
    const m = sameTeamBySeason([...teams, { id: "s5_mclaren2", seasonId: "s5", name: "Mclaren" }], "Mclaren");
    expect(m.get("s5").id).toBe("s5_mclaren2");
  });
});
