import { describe, it, expect } from "vitest";
import { matchFieldToDrivers } from "./liveChampionshipService.js";

// The field matcher climbs the same evidence ladder as the result import:
// stored Steam id, exact roster name / Discord handle, then a STRICT fuzzy
// name match. These tests drive it as a pure function (realGuidFor injected).

const driver = (id, name, extra = {}) => ({ id, name, discordName: extra.discord || "", steamId: extra.steamId || null });
const entry = (name, guid = null) => ({ name, guid });
const noGuids = () => null;

describe("liveChampionship field matching", () => {
  it("matches exact roster names and Discord handles", () => {
    const drivers = [driver("d1", "Steve"), driver("d2", "Alice", { discord: "alice_gg" })];
    const { runningIds, unmatched } = matchFieldToDrivers({
      running: [entry("STEVE"), entry("alice_gg")],
      retired: [],
      drivers,
      realGuidFor: noGuids,
    });
    expect(runningIds).toEqual(["d1", "d2"]);
    expect(unmatched).toEqual([]);
  });

  it("a stored Steam id matches a driver racing under a completely different alias", () => {
    // Race night 2026-08-21: a league driver ran under an in-sim alias no name
    // matcher could bridge, and the projection paid their points to nobody.
    // Their Steam id from past imports is identity, whatever the name says.
    const drivers = [driver("d1", "Steve", { steamId: "76561190000000001" })];
    const { runningIds, unmatched } = matchFieldToDrivers({
      running: [entry("TAKODA", "pub-abc")],
      retired: [],
      drivers,
      realGuidFor: (pub) => (pub === "pub-abc" ? "76561190000000001" : null),
    });
    expect(runningIds).toEqual(["d1"]);
    expect(unmatched).toEqual([]);
  });

  it("fuzzy-matches the classic in-sim name drift", () => {
    const drivers = [driver("d1", "Steven H. Cheese"), driver("d2", "Gabriele Grossi")];
    const { runningIds, unmatched } = matchFieldToDrivers({
      running: [entry("Steven P6. Cheese"), entry("Gabrielle Grossi")],
      retired: [],
      drivers,
      realGuidFor: noGuids,
    });
    expect(runningIds).toEqual(["d1", "d2"]);
    expect(unmatched).toEqual([]);
  });

  it("leaves a name unmatched when two roster names are equally close", () => {
    // The clear-winner rule: guessing between near-ties would put someone
    // else's points on the table with nobody checking.
    const drivers = [driver("d1", "Sam Miller"), driver("d2", "Sam Mills")];
    const { runningIds, unmatched } = matchFieldToDrivers({
      running: [entry("Sam Mill")],
      retired: [],
      drivers,
      realGuidFor: noGuids,
    });
    expect(runningIds).toEqual([]);
    expect(unmatched).toEqual(["Sam Mill"]);
  });

  it("a fuzzy guess cannot steal a driver an exact name already owns", () => {
    const drivers = [driver("d1", "Steve")];
    const { runningIds, unmatched } = matchFieldToDrivers({
      // The guest "STEVE2" is close enough to fuzzy-match "Steve" — but the
      // real Steve is on track too, later in the order, and exact beats fuzzy
      // across the whole field, not per list position.
      running: [entry("STEVE2"), entry("STEVE")],
      retired: [],
      drivers,
      realGuidFor: noGuids,
    });
    expect(runningIds).toEqual(["d1"]);
    expect(unmatched).toEqual(["STEVE2"]);
  });

  it("a driver id is claimed once — a duplicate entry goes unmatched", () => {
    const drivers = [driver("d1", "Steve")];
    const { runningIds, unmatched } = matchFieldToDrivers({
      running: [entry("Steve"), entry("STEVE")],
      retired: [],
      drivers,
      realGuidFor: noGuids,
    });
    expect(runningIds).toEqual(["d1"]);
    expect(unmatched).toEqual(["STEVE"]);
  });

  it("keeps the running/retired split and each list's order", () => {
    const drivers = [driver("d1", "Alice"), driver("d2", "Bob"), driver("d3", "Cara")];
    const { runningIds, retiredIds, unmatched } = matchFieldToDrivers({
      running: [entry("Bob"), entry("Alice")],
      retired: [entry("Cara"), entry("Ghost Guest")],
      drivers,
      realGuidFor: noGuids,
    });
    expect(runningIds).toEqual(["d2", "d1"]);
    expect(retiredIds).toEqual(["d3"]);
    expect(unmatched).toEqual(["Ghost Guest"]);
  });
});
