import { describe, it, expect } from "vitest";
import { rankContacts, withAccusedSuggestions } from "./reportSuggest.js";

// One driver's own contacts for a round, in the shape contactsForDriver hands
// out: `lap` is already theirs, `other` is the car on the far side.
const c = (eventIndex, lap, kph, otherName, otherGuid = `g-${otherName}`) => ({
  id: `${eventIndex}`,
  at: 1000 + eventIndex,
  second: 100 + eventIndex,
  eventIndex,
  lap,
  kph,
  other: { guid: otherGuid, name: otherName },
});

describe("rankContacts", () => {
  const round = [
    c(101, 30, 12, "Kronos"),
    c(205, 32, 41, "urmagaeddon"),
    c(206, 32, 8, "Steve"),
    c(310, 33, 25, "urmagaeddon"),
    c(420, 40, 60, "Kalervo"),
  ];

  it("offers the contacts on the lap the driver gave", () => {
    const out = rankContacts(round, { lap: 32 });
    expect(out.map((x) => x.eventIndex)).toEqual([205, 206, 310]);
  });

  it("leads with the exact lap, then the harder hit", () => {
    const out = rankContacts(round, { lap: 32 });
    expect(out[0].eventIndex).toBe(205); // lap 32, 41 km/h
    expect(out[1].eventIndex).toBe(206); // lap 32, 8 km/h
    expect(out[2].exactLap).toBe(false); // lap 33, only offered as a neighbour
  });

  it("narrows to the driver the report names", () => {
    const out = rankContacts(round, { lap: 32, accusedName: "urmagaeddon" });
    expect(out.map((x) => x.eventIndex)).toEqual([205, 310]);
  });

  it("matches a named driver by Steam id when there is one", () => {
    const out = rankContacts(round, { lap: 32, accusedGuid: "g-Steve" });
    expect(out.map((x) => x.eventIndex)).toEqual([206]);
  });

  it("ignores punctuation and case in a name, the way the rest of the site does", () => {
    expect(rankContacts(round, { lap: 32, accusedName: "UrMagAeddon" })).toHaveLength(2);
  });

  it("offers nothing when the pair has no contact at all, rather than widening", () => {
    // Somebody else's incident under this report's heading would be worse than
    // an empty list: the reporter has said who it was.
    expect(rankContacts(round, { lap: 32, accusedName: "Nobody" })).toEqual([]);
  });

  it("offers nothing when the named pair's contacts are on other laps", () => {
    expect(rankContacts(round, { lap: 2, accusedName: "urmagaeddon" })).toEqual([]);
  });

  it("allows a lap either side, because two lap countings disagree on the line", () => {
    // Nothing is on lap 31 itself, so all three neighbours are equal on that
    // count and the impact speed decides the order: 41, 12, 8 km/h.
    expect(rankContacts(round, { lap: 31 }).map((x) => x.eventIndex)).toEqual([205, 101, 206]);
  });

  it("does not stretch to two laps away", () => {
    expect(rankContacts(round, { lap: 36 })).toEqual([]);
  });

  it("suggests nothing when the report gives neither a lap nor a name", () => {
    // The whole round's contact list under one report is a search result, not
    // a suggestion.
    expect(rankContacts(round, {})).toEqual([]);
  });

  it("takes a name with no lap, since the pair alone is usually enough", () => {
    expect(rankContacts(round, { accusedName: "urmagaeddon" }).map((x) => x.eventIndex)).toEqual([205, 310]);
  });

  it("stops at three, because a longer list is not a suggestion", () => {
    const many = Array.from({ length: 8 }, (_, i) => c(500 + i, 12, 30 + i, "Flo"));
    expect(rankContacts(many, { lap: 12 })).toHaveLength(3);
  });

  it("survives an empty round, a missing list and a contact with no lap", () => {
    expect(rankContacts([], { lap: 5 })).toEqual([]);
    expect(rankContacts(null, { lap: 5 })).toEqual([]);
    expect(rankContacts([{ ...c(1, null, 20, "Flo") }], { lap: 5 })).toEqual([]);
  });
});

// Who the file says was on the other side of a report that names nobody.
//
// A suggestion, never an accusation: it is prefilled into a dropdown a steward
// confirms. Assetto Corsa is good at "these two cars touched" and knows nothing
// whatever about fault.
describe("withAccusedSuggestions", () => {
  // The roster, by the Steam id each driver races under. urmagaeddon has rows
  // in two seasons, and the one that is RUNNING is who they are now.
  const prisma = {
    driver: {
      findMany: async ({ where }) =>
        [
          { id: "d-old", name: "urma", steamId: "g-urmagaeddon", season: { isActive: false, number: 6 } },
          { id: "d-new", name: "urmagaeddon", steamId: "g-urmagaeddon", season: { isActive: true, number: 7 } },
          { id: "d-steve", name: "Steve", steamId: "g-Steve", season: { isActive: true, number: 7 } },
        ].filter((d) => where.steamId.in.includes(d.steamId)),
    },
  };

  it("offers the car the press was matched to, and says so", async () => {
    const [out] = await withAccusedSuggestions(prisma, [
      { id: "r1", accusedDriverId: null, contactOther: { name: "urmagaeddon", guid: "g-urmagaeddon" } },
    ]);
    expect(out.accusedSuggestion).toEqual({ driverId: "d-new", name: "urmagaeddon", from: "matched" });
  });

  it("falls back to the best contact the file offered for the lap", async () => {
    const [out] = await withAccusedSuggestions(prisma, [
      {
        id: "r1",
        accusedDriverId: null,
        contactSuggestions: [{ other: { name: "Steve", guid: "g-Steve" } }, { other: { name: "x", guid: "g-x" } }],
      },
    ]);
    expect(out.accusedSuggestion).toEqual({ driverId: "d-steve", name: "Steve", from: "suggested" });
  });

  it("says the name without a driver when nobody on the roster races under it", async () => {
    // Worth showing anyway: the steward can go and find whose it is. What it
    // must not do is hand back an id nobody stands behind.
    const [out] = await withAccusedSuggestions(prisma, [
      { id: "r1", accusedDriverId: null, contactOther: { name: "A Stranger", guid: "g-nobody" } },
    ]);
    expect(out.accusedSuggestion).toEqual({ driverId: null, name: "A Stranger", from: "matched" });
  });

  it("never suggests anything for a report that already names somebody", async () => {
    // Naming a driver lets them in and tells them, so a report that has one is
    // settled — offering a second name would be offering to re-point it.
    const [out] = await withAccusedSuggestions(prisma, [
      { id: "r1", accusedDriverId: "d-steve", contactOther: { name: "urmagaeddon", guid: "g-urmagaeddon" } },
    ]);
    expect(out.accusedSuggestion).toBeUndefined();
  });

  it("leaves a report the file has nothing on exactly as it was", async () => {
    const input = [{ id: "r1", accusedDriverId: null }];
    expect(await withAccusedSuggestions(prisma, input)).toEqual(input);
  });
});
