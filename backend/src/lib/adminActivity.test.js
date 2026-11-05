import { describe, it, expect } from "vitest";
import {
  actorOf, describeAction, isLogged, safeFields, diffRows, diffResults, diffReport, queryEntries,
} from "./adminActivity.js";

describe("actorOf", () => {
  it("never puts a name on the shared PIN", () => {
    expect(actorOf({ role: "admin" })).toEqual({ kind: "pin", name: "PIN login" });
  });
  it("names the account that signed in, not the main account it acts for", () => {
    const who = actorOf({ role: "user", discordId: "main", loginDiscordId: "second", discordName: "Sam" });
    expect(who).toEqual({ kind: "discord", id: "second", name: "Sam" });
  });
});

describe("describeAction", () => {
  it("tells a decision from a thread message", () => {
    expect(describeAction("PUT", "/reports/abc")).toEqual({ area: "penalties", label: "Report decided" });
    expect(describeAction("POST", "/reports/abc/messages").label).toBe("Steward message in a report");
  });
  it("keeps the results post out of the results", () => {
    expect(describeAction("POST", "/races/abc/results-post").area).toBe("site");
    expect(describeAction("PUT", "/races/abc/results").area).toBe("results");
  });
  it("reads the lines written before names were recorded", () => {
    expect(describeAction("PUT", "/drivers/sam?series=gt").label).toBe("Driver updated");
  });
  it("falls back on words, never on a raw path", () => {
    expect(describeAction("PUT", "/race-recap").label).toBe("Race recap changed");
  });
});

describe("isLogged", () => {
  it("leaves out reads and everything that saves nothing", () => {
    expect(isLogged("GET", "/drivers")).toBe(false);
    expect(isLogged("POST", "/races/preview")).toBe(false);
    expect(isLogged("POST", "/races/import")).toBe(false);
    expect(isLogged("POST", "/races/commit")).toBe(true);
  });
});

describe("safeFields", () => {
  it("never keeps a secret", () => {
    const out = safeFields("/whatever", { pin: "1234", newPin: "1", apiKey: "x", webhookUrl: "y", password: "z", name: "Sam" });
    expect(out).toEqual([{ field: "Name", to: "Sam" }]);
  });
  it("keeps whole routes out, report threads above all", () => {
    expect(safeFields("/settings/pin", { current: "1234" })).toEqual([]);
    expect(safeFields("/discord/webhook", { value: "x" })).toEqual([]);
    expect(safeFields("/reports/abc/messages", { body: "private" })).toEqual([]);
  });
  it("skips ids and lists, cuts long text", () => {
    const out = safeFields("/x", { driverId: "a", results: [1], note: "n".repeat(500) });
    expect(out).toHaveLength(1);
    expect(out[0].to.length).toBeLessThan(170);
  });
  it("counts a bulk delete", () => {
    expect(safeFields("/reports/bulk-delete", { ids: ["a", "b"] })).toEqual([{ field: "How many", to: "2" }]);
  });
});

describe("diffRows", () => {
  it("lists what moved and ignores the bookkeeping", () => {
    const a = { id: "x", name: "Sam", team: "Ferrari", updatedAt: new Date(1), tier: 1 };
    const b = { id: "x", name: "Sam", team: "Lotus", updatedAt: new Date(2), tier: 1 };
    expect(diffRows(a, b)).toEqual([{ field: "Team", from: "Ferrari", to: "Lotus" }]);
  });
  it("does not call two equal dates a change", () => {
    expect(diffRows({ date: new Date(5) }, { date: new Date(5) })).toEqual([]);
  });
});

describe("diffResults", () => {
  const row = (driverId, position, extra = {}) => ({
    driverId, name: driverId.toUpperCase(), position, status: "FINISHED", penaltySeconds: 0, points: null, ...extra,
  });
  it("shows a penalty before the places it moved", () => {
    const out = diffResults(
      [row("a", 1), row("b", 2)],
      [row("a", 2, { penaltySeconds: 5 }), row("b", 1)]
    );
    expect(out[0]).toEqual({ field: "A: penalty", from: "0s", to: "5s" });
    expect(out.map((c) => c.field)).toEqual(["A: penalty", "A: position", "B: position"]);
  });
  it("catches a disqualification taken back", () => {
    const out = diffResults([row("a", 9, { status: "DSQ" })], [row("a", 9)]);
    expect(out).toEqual([{ field: "A: status", from: "DSQ", to: "FINISHED" }]);
  });
  it("sums up a first import instead of listing the grid", () => {
    expect(diffResults([], [row("a", 1), row("b", 2)])).toEqual([{ field: "Results", from: "none", to: "2 drivers" }]);
  });
  it("notices a driver added or dropped", () => {
    const out = diffResults([row("a", 1), row("b", 2)], [row("a", 1), row("c", 2)]);
    expect(out.map((c) => c.to)).toEqual(["P2, FINISHED", "removed"]);
  });
  it("says nothing when nothing changed", () => {
    expect(diffResults([row("a", 1)], [row("a", 1)])).toEqual([]);
  });
});

describe("diffReport", () => {
  it("records a penalty being changed", () => {
    const out = diffReport(
      { status: "PENALTY", penaltyKind: "TIME", penaltySeconds: 5, verdict: "x" },
      { status: "PENALTY", penaltyKind: "TIME", penaltySeconds: 10, verdict: "x" }
    );
    expect(out).toEqual([{ field: "Penalty seconds", from: "5", to: "10" }]);
  });
});

describe("queryEntries", () => {
  const lines = [
    { t: "1", method: "PUT", path: "/drivers/a" },
    { t: "2", method: "PUT", path: "/reports/b", who: { kind: "pin", name: "PIN login" } },
    {
      t: "3", method: "PUT", path: "/races/c/results", who: { kind: "discord", id: "7", name: "Sam" }, target: "R5 Spa",
      changes: [{ field: "Alex: penalty", from: "0s", to: "5s" }],
    },
    null,
  ];
  it("comes back newest first, with everybody for the filter", () => {
    const out = queryEntries(lines);
    expect(out.entries.map((e) => e.t)).toEqual(["3", "2", "1"]);
    expect(out.people.map((p) => p.key)).toEqual(["d:7", "pin", "none"]);
  });
  it("filters by person, by area and by text inside the changes", () => {
    expect(queryEntries(lines, { who: "pin" }).total).toBe(1);
    expect(queryEntries(lines, { who: "none" }).entries[0].t).toBe("1");
    expect(queryEntries(lines, { area: "penalties" }).entries[0].t).toBe("2");
    expect(queryEntries(lines, { q: "alex" }).entries[0].t).toBe("3");
  });
  it("keeps every person in the filter while a filter is on", () => {
    expect(queryEntries(lines, { who: "pin" }).people).toHaveLength(3);
  });
  it("pages", () => {
    const out = queryEntries(lines, { offset: 1, limit: 1 });
    expect(out.entries.map((e) => e.t)).toEqual(["2"]);
    expect(out.total).toBe(3);
  });
});
