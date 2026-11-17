import { describe, it, expect } from "vitest";
import { parseSignupSettings, parseSignupForm, cleanLine, shapeForSender, openSeatsFrom, freeAgentsFrom, markCovered } from "./teamSignups.js";

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

describe("drivers still on their own", () => {
  const e = (discordId, teamName, driver1, driver2 = null, note = null) => ({ discordId, teamName, driver1, driver2, note });

  it("lists who has no team yet or is looking for one, without the note", () => {
    const list = freeAgentsFrom(
      [e("a", "No team yet", "Lobter", null, "for the admins"), e("b", "Looking for a team", "Rashford"), e("c", "Apex", "Max")],
      "me"
    );
    expect(list).toEqual([
      { name: "Lobter", choice: "No team yet" },
      { name: "Rashford", choice: "Looking for a team" },
    ]);
  });

  it("leaves out pairs, the asker and the same name twice", () => {
    const list = freeAgentsFrom([e("a", "No team yet", "Lou", "Kim"), e("me", "No team yet", "Malte"), e("b", "no team yet", "Pengi"), e("c", "Looking for a team", "pengi")], "me");
    expect(list).toEqual([{ name: "Pengi", choice: "No team yet" }]);
  });
});

describe("a solo entry once its driver is in a pair", () => {
  const e = (id, teamName, driver1, driver2 = null, extra = {}) => ({ id, seriesId: "sun", label: "S7", discordId: id, teamName, driver1, driver2, ...extra });

  it("is marked with the pair that names them, which carries its note", () => {
    const [solo, pair] = markCovered([e("a", "No team yet", "Lobter", null, { note: "any team" }), e("b", "Apex", "Max", "lobter")]);
    expect(solo.coveredBy).toEqual({ id: "b", teamName: "Apex", with: "Max" });
    expect(pair.coveredBy).toBeUndefined();
    expect(pair.alsoSent).toEqual([{ id: "a", senderName: null, teamName: "No team yet", note: "any team" }]);
  });

  it("folds the same pair sent by both into one, a real team first, else the newest", () => {
    const spy = e("s", "Looking for a team", "Spy", "Lobter", { updatedAt: "2026-11-17T22:18:00Z", note: "us together" });
    const lob = e("l", "No team yet", "Lobter", "spy", { updatedAt: "2026-11-17T22:22:00Z" });
    const [a, b] = markCovered([spy, lob]);
    expect(a.coveredBy).toEqual({ id: "l", teamName: "No team yet", with: null });
    expect(b.coveredBy).toBeUndefined();
    expect(b.alsoSent).toEqual([{ id: "s", senderName: null, teamName: "Looking for a team", note: "us together" }]);

    const [c, d] = markCovered([e("s", "Apex", "Spy", "Lobter"), lob]);
    expect(c.coveredBy).toBeUndefined();
    expect(d.coveredBy.id).toBe("s");
  });

  it("stays as it is in another sign-up, or when nobody names them", () => {
    const list = markCovered([e("a", "No team yet", "Lobter"), e("b", "Apex", "Max", "Lobter", { label: "S6" }), e("c", "Apex", "Max", "Kim")]);
    expect(list[0].coveredBy).toBeUndefined();
  });

  it("drops out of the free seats and the drivers on their own", () => {
    const list = markCovered([e("a", "Pirates", "Lou"), e("b", "No team yet", "Pengi"), e("c", "Apex", "Max", "Lou"), e("d", "Rocket", "Kim", "Pengi")]);
    expect(openSeatsFrom(list, "me")).toEqual([]);
    expect(freeAgentsFrom(list, "me")).toEqual([]);
  });
});
