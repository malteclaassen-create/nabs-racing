import { describe, it, expect } from "vitest";
import { teamLineageKey, sameTeamBySeason, linkMap, cleanTeamLinks, suggestTeamLinks } from "./teamLineage.js";

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

describe("admin team links", () => {
  const links = linkMap([
    { from: "Volvo Racing", to: "Volvo" },
    { from: "Volvo Cyan Racing", to: "Volvo Racing" },
  ]);

  it("joins up a linked name, and follows chains", () => {
    expect(teamLineageKey("Volvo Racing", links)).toBe(teamLineageKey("Volvo", links));
    expect(teamLineageKey("volvo cyan-racing", links)).toBe(teamLineageKey("Volvo", links));
  });

  it("only the saved links count once there are any", () => {
    expect(teamLineageKey("Porsche Martini", links)).not.toBe(teamLineageKey("Porsche", links));
  });

  it("refuses a loop, an empty name and a link to itself", () => {
    expect(cleanTeamLinks([{ from: "A Team", to: "B Team" }, { from: "B Team", to: "A Team" }]).error).toMatch(/circle/);
    expect(cleanTeamLinks([{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "A" }]).error).toMatch(/circle/);
    expect(cleanTeamLinks([{ from: "Volvo", to: " " }]).error).toBeTruthy();
    expect(cleanTeamLinks([{ from: "Red Bull", to: "Redbull" }]).error).toBeTruthy();
  });

  it("keeps one link per name, the last one", () => {
    expect(cleanTeamLinks([{ from: "Volvo Racing", to: "Volvo" }, { from: " volvo racing", to: "Polestar" }]).links).toEqual([
      { from: "volvo racing", to: "Polestar" },
    ]);
  });

  it("suggests names that look like the same team, not ones already joined", () => {
    expect(suggestTeamLinks(["Volvo Racing", "Volvo", "Ferrari", "Porsche Martini", "Porsche"])).toEqual([
      { from: "Volvo Racing", to: "Volvo" },
    ]);
    // BMW Sauber is linked to Sauber, so it is no candidate for BMW.
    expect(suggestTeamLinks(["BMW Sauber", "BMW", "Sauber"])).toEqual([]);
  });
});
