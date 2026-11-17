import { describe, it, expect } from "vitest";
import { parseSignupSettings, parseSignupForm, cleanLine, shapeForSender, openSeatsFrom } from "./teamSignups.js";

describe("team sign-up settings", () => {
  it("is closed with no series until an admin opens it", () => {
    expect(parseSignupSettings(null)).toEqual({ open: false, seriesId: null, label: "Next season" });
    expect(parseSignupSettings("not json")).toEqual({ open: false, seriesId: null, label: "Next season" });
  });

  it("reads back what was stored", () => {
    const raw = JSON.stringify({ open: true, seriesId: "sun", label: "  Season   7 " });
    expect(parseSignupSettings(raw)).toEqual({ open: true, seriesId: "sun", label: "Season 7" });
  });
});

describe("team sign-up form", () => {
  it("needs a team and one driver, the second seat may stay empty", () => {
    expect(parseSignupForm({ teamName: " Ferrari ", driver1: "Max", driver2: "  ", note: "" })).toEqual({
      teamName: "Ferrari",
      driver1: "Max",
      driver2: null,
      note: null,
    });
  });

  it("says what is missing", () => {
    expect(() => parseSignupForm({ driver1: "Max" })).toThrow(/which team/);
    expect(() => parseSignupForm({ teamName: "Ferrari" })).toThrow(/at least one driver/);
  });

  it("refuses the same name twice", () => {
    expect(() => parseSignupForm({ teamName: "Ferrari", driver1: "Max", driver2: "max" })).toThrow(/same name/);
  });

  it("caps long text", () => {
    const f = parseSignupForm({ teamName: "x".repeat(200), driver1: "y".repeat(200), note: "z".repeat(2000) });
    expect(f.teamName).toHaveLength(60);
    expect(f.driver1).toHaveLength(60);
    expect(f.note).toHaveLength(500);
  });

  it("keeps one line in a name", () => {
    expect(cleanLine("Red\nBull   Racing", 60)).toBe("Red Bull Racing");
  });
});

describe("what a member sees of their own entry", () => {
  it("leaves out the Discord id and the admin's status", () => {
    const out = shapeForSender({ id: "a", discordId: "123", status: "DONE", teamName: "T", driver1: "A", driver2: null, note: null, createdAt: "x", updatedAt: null });
    expect(out).not.toHaveProperty("discordId");
    expect(out).not.toHaveProperty("status");
    expect(out.teamName).toBe("T");
  });
});

describe("teams with a free seat", () => {
  const e = (discordId, teamName, driver1, driver2 = null) => ({ discordId, teamName, driver1, driver2 });

  it("lists teams with one driver so far", () => {
    const seats = openSeatsFrom([e("a", "Apex", "Max"), e("b", "Pirates", "Lou", "Kim")], "me");
    expect(seats).toEqual([{ teamName: "Apex", driver: "Max" }]);
  });

  it("counts a team full once two drivers are down for it across entries", () => {
    expect(openSeatsFrom([e("a", "Apex", "Max"), e("b", "apex ", "Lou", "max")], "me")).toEqual([]);
    expect(openSeatsFrom([e("a", "Apex", "Max"), e("b", "Apex", "Max")], "me")).toEqual([{ teamName: "Apex", driver: "Max" }]);
  });

  it("leaves out the asker's own entry and the choices that are not a team", () => {
    const seats = openSeatsFrom([e("me", "Apex", "Max"), e("b", "No team yet", "Lou"), e("c", "looking for a team", "Kim")], "me");
    expect(seats).toEqual([]);
  });
});
