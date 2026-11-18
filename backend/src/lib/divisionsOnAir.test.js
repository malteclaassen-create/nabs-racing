import { describe, it, expect } from "vitest";
import { isRaceDay, sameCircuit, division2OnAir } from "./divisions.js";

// The Live page calls the two servers "Division 1" and "Division 2" only while
// Division 2 is racing: race day, and the same circuit on both servers. The
// rest of the week the second server is a practice server.

// A Friday round, stored the way the admin form stores a date without a time:
// UTC midnight, which the league reads as 19:00 German time.
const FRIDAY = { date: "2026-11-20T00:00:00.000Z" };
// November is CET, so 19:00 in Germany is 18:00 UTC.
const at = (iso) => new Date(iso);

describe("isRaceDay", () => {
  it("is the whole day of the race, German time", () => {
    expect(isRaceDay([FRIDAY], at("2026-11-19T23:30:00Z"))).toBe(true); // Friday 00:30 in Germany
    expect(isRaceDay([FRIDAY], at("2026-11-20T09:00:00Z"))).toBe(true);
    expect(isRaceDay([FRIDAY], at("2026-11-20T19:30:00Z"))).toBe(true); // mid-race
  });

  it("is not the days around it", () => {
    expect(isRaceDay([FRIDAY], at("2026-11-18T20:27:00Z"))).toBe(false); // Wednesday evening
    expect(isRaceDay([FRIDAY], at("2026-11-19T21:00:00Z"))).toBe(false); // Thursday 22:00 in Germany
    expect(isRaceDay([FRIDAY], at("2026-11-21T10:00:00Z"))).toBe(false); // Saturday morning
  });

  it("keeps a race that runs past midnight", () => {
    expect(isRaceDay([FRIDAY], at("2026-11-20T23:45:00Z"))).toBe(true); // Saturday 00:45 in Germany
    expect(isRaceDay([FRIDAY], at("2026-11-21T03:00:00Z"))).toBe(false); // nine hours after the start
  });

  it("uses a stored start time as it is", () => {
    const sundayAfternoon = { date: "2026-11-22T13:00:00.000Z" };
    expect(isRaceDay([sundayAfternoon], at("2026-11-22T08:00:00Z"))).toBe(true);
    expect(isRaceDay([sundayAfternoon], at("2026-11-23T08:00:00Z"))).toBe(false);
  });

  it("has no race day without a dated race", () => {
    expect(isRaceDay([], at("2026-11-20T19:00:00Z"))).toBe(false);
    expect(isRaceDay([{ date: null }], at("2026-11-20T19:00:00Z"))).toBe(false);
    expect(isRaceDay(null, at("2026-11-20T19:00:00Z"))).toBe(false);
  });
});

describe("sameCircuit", () => {
  it("compares the circuit and not the layout", () => {
    expect(sameCircuit({ track: "nabs_hockenheim_2026", layout: "gp" }, { track: "NABS_Hockenheim_2026", layout: "" })).toBe(true);
    expect(sameCircuit({ track: "nabs_hockenheim_2026" }, { track: "monza" })).toBe(false);
  });

  it("is never true for a server with nothing loaded", () => {
    expect(sameCircuit(null, null)).toBe(false);
    expect(sameCircuit({ track: "monza" }, null)).toBe(false);
    expect(sameCircuit({ track: "" }, { track: "" })).toBe(false);
  });
});

describe("division2OnAir", () => {
  const HOCKENHEIM = { track: "nabs_hockenheim_2026", layout: "" };
  // Answers like the database would: only rounds inside the asked window.
  const fakePrisma = (races, seen = {}) => ({
    race: {
      findMany: async ({ where }) => {
        seen.where = where;
        return races.filter((r) => {
          const t = new Date(r.date).getTime();
          return t >= where.date.gte.getTime() && t <= where.date.lte.getTime();
        });
      },
    },
  });
  const raceNight = at("2026-11-20T18:30:00Z");

  it("is on when it is race day and both servers run the same circuit", async () => {
    expect(
      await division2OnAir(fakePrisma([FRIDAY]), "s1", { mainTrack: HOCKENHEIM, otherTrack: HOCKENHEIM, now: raceNight })
    ).toBe(true);
  });

  it("is off in the week, with both servers practising on next Friday's circuit", async () => {
    expect(
      await division2OnAir(fakePrisma([FRIDAY]), "s1", {
        mainTrack: HOCKENHEIM,
        otherTrack: HOCKENHEIM,
        now: at("2026-11-18T20:27:00Z"),
      })
    ).toBe(false);
  });

  it("is off on race day when the second server runs something else", async () => {
    expect(
      await division2OnAir(fakePrisma([FRIDAY]), "s1", { mainTrack: HOCKENHEIM, otherTrack: { track: "monza" }, now: raceNight })
    ).toBe(false);
    expect(await division2OnAir(fakePrisma([FRIDAY]), "s1", { mainTrack: HOCKENHEIM, otherTrack: null, now: raceNight })).toBe(
      false
    );
  });

  it("only looks at the season's own rounds", async () => {
    const seen = {};
    await division2OnAir(fakePrisma([FRIDAY], seen), "s1", { mainTrack: HOCKENHEIM, otherTrack: HOCKENHEIM, now: raceNight });
    expect(seen.where.seasonId).toBe("s1");
    // Training sessions, special events and Division 2's own hidden row of a
    // round all carry this flag, so none of them makes a race day.
    expect(seen.where.isSpecialEvent).toBe(false);
  });

  it("is off rather than broken without a season or a database", async () => {
    expect(await division2OnAir(fakePrisma([FRIDAY]), null, { mainTrack: HOCKENHEIM, otherTrack: HOCKENHEIM, now: raceNight })).toBe(
      false
    );
    const broken = { race: { findMany: async () => { throw new Error("down"); } } };
    expect(await division2OnAir(broken, "s1", { mainTrack: HOCKENHEIM, otherTrack: HOCKENHEIM, now: raceNight })).toBe(false);
  });
});
