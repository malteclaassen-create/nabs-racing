import { describe, it, expect } from "vitest";
import { parseSignupSettings, parseSignupForm, cleanLine, shapeForSender } from "./teamSignups.js";

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
