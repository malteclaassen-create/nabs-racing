import { describe, it, expect } from "vitest";
import { libraryEntries, logoSourceFor, logoPatch, hasOwnLogo } from "./teamLibrary.js";
import { linkMap, DEFAULT_TEAM_LINKS } from "./teamLineage.js";

const numberOf = new Map([["s5", 5], ["s6", 6], ["s7", 7], ["s9", 9]]);
const team = (id, name, seasonId, tier = 1, extra = {}) => ({ id, name, seasonId, tier, color: "#123456", logoUrl: null, ...extra });

describe("libraryEntries", () => {
  it("shows a team once, newest copy, with every season it raced", () => {
    const rows = libraryEntries(
      [
        team("bmw_s5", "BMW", "s5", 1, { logoUrl: "/old.png" }),
        team("bmw_s6", "BMW", "s6", 2, { logoUrl: "/new.png" }),
        team("bmw_sauber_s7", "BMW Sauber", "s7", 2),
      ],
      numberOf,
      "s9",
      "bmw"
    );
    expect(rows.map((r) => r.name)).toEqual(["BMW Sauber", "BMW"]);
    const bmw = rows.find((r) => r.name === "BMW");
    expect(bmw.id).toBe("bmw_s6");
    expect(bmw.logoUrl).toBe("/new.png");
    expect(bmw.seasons).toEqual([6, 5]);
  });

  it("knows per division whether the name is here already", () => {
    const rows = libraryEntries(
      [team("bmw_s6", "BMW", "s6"), team("bmw_d2_s9", "BMW", "s9", 3)],
      numberOf,
      "s9"
    );
    expect(rows[0].here).toEqual({ 1: false, 2: true });
  });

  it("offers this season's Division 1 team to Division 2", () => {
    const rows = libraryEntries([team("porsche_s9", "Porsche", "s9", 1, { logoUrl: "/p.png" })], numberOf, "s9");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "porsche_s9", here: { 1: true, 2: false } });
  });

  it("drops a name this season already has in both divisions", () => {
    const rows = libraryEntries(
      [team("porsche_s9", "Porsche", "s9"), team("porsche_d2_s9", "Porsche", "s9", 3)],
      numberOf,
      "s9"
    );
    expect(rows).toHaveLength(0);
  });

  it("treats spelling differences as one team and skips the Reserve pool", () => {
    const rows = libraryEntries(
      [team("rb_s6", "Red Bull", "s6"), team("rb_s7", "RedBull", "s7"), team("reserve_s7", "Reserve", "s7", 0)],
      numberOf,
      "s9"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "rb_s7", seasons: [7, 6] });
  });
});

describe("logoSourceFor", () => {
  const links = linkMap(DEFAULT_TEAM_LINKS);
  const all = [
    team("porsche_martini_s5", "Porsche Martini", "s5", 1, { logoUrl: "/pm.png" }),
    team("porsche_s6", "Porsche", "s6", 1, { logoUrl: "/p6.png" }),
    team("porsche_s9", "Porsche", "s9", 1, { logoUrl: "/p9.png" }),
    team("porsche_d2_s9", "Porsche", "s9", 3),
  ];

  it("takes the newest logo of the same name, not the team itself", () => {
    expect(logoSourceFor(all, numberOf, "porsche", { excludeId: "porsche_d2_s9", links }).id).toBe("porsche_s9");
  });

  it("falls back to a linked name", () => {
    const only = [team("porsche_martini_s5", "Porsche Martini", "s5", 1, { logoUrl: "/pm.png" })];
    expect(logoSourceFor(only, numberOf, "Porsche", { links }).id).toBe("porsche_martini_s5");
  });

  it("is null for a name no team has", () => {
    expect(logoSourceFor(all, numberOf, "Arrows", { links })).toBeNull();
  });
});

describe("logoPatch", () => {
  it("brings the colour along only while the team is still plain grey", () => {
    const src = { logoUrl: "/p.png", color: "#00aa88" };
    expect(logoPatch({ logoUrl: null, color: "#888888" }, src)).toEqual({ logoUrl: "/p.png", color: "#00aa88" });
    expect(logoPatch({ logoUrl: null, color: "#ff0000" }, src)).toEqual({ logoUrl: "/p.png" });
    expect(logoPatch({ logoUrl: "/p.png", color: "#ff0000" }, src)).toBeNull();
  });
});

describe("hasOwnLogo", () => {
  it("is an upload stored under the team's own id", () => {
    expect(hasOwnLogo({ id: "haas_s9", logoUrl: "/api/uploads/teams/haas_s9.png?v=1" })).toBe(true);
    expect(hasOwnLogo({ id: "haas_s9", logoUrl: "/api/uploads/teams/haas_s8.png?v=1" })).toBe(false);
    expect(hasOwnLogo({ id: "haas_s9", logoUrl: null })).toBe(false);
  });
});
