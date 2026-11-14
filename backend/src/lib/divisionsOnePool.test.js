import { describe, it, expect } from "vitest";
import { divisionOf, filledDivision2Seats, readDivision2Drivers } from "./divisions.js";
import { divisionForDriver } from "./waitlist.js";

// One Reserve pool for both divisions: a reserve is a Division 1 driver, and
// races in Division 2 only on a night they took over a Division 2 seat on the
// Driver Market.

// The season: Division 2 on; "d2" drives for a Division 2 team, "d1" for a
// Division 1 team, "res" and "res2" are reserves (res2 with an old Division 2
// pool flag, which no longer counts). Race "r1": res took over d2's seat.
function fakePrisma() {
  const drivers = [
    { id: "d1", tier: 1, teamTier: 1, division: null },
    { id: "d2", tier: 3, teamTier: 3, division: null },
    { id: "res", tier: 0, teamTier: 0, division: null },
    { id: "res2", tier: 0, teamTier: 0, division: 2 },
  ];
  const offers = [
    { raceId: "r1", status: "FILLED", filledById: "res", team: { tier: 3 } },
    { raceId: "r1", status: "FILLED", filledById: "res2", team: { tier: 1 } },
  ];
  return {
    $queryRawUnsafe: async (q) => {
      if (q.includes('SELECT "division2" FROM "Season"')) return [{ division2: 1 }];
      if (q.includes('FROM "Driver" d LEFT JOIN "Team" t')) {
        // The query as written: team tier 3 or driver tier 3, nothing else.
        if (q.includes('"division" = 2')) throw new Error("the pool flag must not be read");
        return drivers.filter((d) => d.teamTier === 3 || d.tier === 3).map((d) => ({ id: d.id }));
      }
      return [];
    },
    seatOffer: {
      findMany: async ({ where }) =>
        offers.filter((o) => o.raceId === where.raceId && o.status === where.status && o.filledById),
    },
  };
}

describe("one Reserve pool", () => {
  it("a reserve is Division 1, whatever an old pool flag says", () => {
    expect(divisionOf({ tier: 0, division: 2 })).toBe(1);
    expect(divisionOf({ tier: 0 })).toBe(1);
    expect(divisionOf({ tier: 3 })).toBe(2);
    expect(divisionOf({ tier: 0 }, { tier: 3 })).toBe(2);
  });

  it("the season's Division 2 drivers are the Division 2 teams' drivers only", async () => {
    expect([...(await readDivision2Drivers(fakePrisma(), "s9"))]).toEqual(["d2"]);
  });

  it("knows who took over a Division 2 seat for a race", async () => {
    expect([...(await filledDivision2Seats(fakePrisma(), "r1"))]).toEqual(["res"]);
    expect((await filledDivision2Seats(fakePrisma(), "r2")).size).toBe(0);
    expect((await filledDivision2Seats(fakePrisma(), null)).size).toBe(0);
  });

  it("a reserve counts on Division 2's grid only for the race they took a Division 2 seat in", async () => {
    const prisma = fakePrisma();
    const r1 = { id: "r1", seasonId: "s9" };
    const r2 = { id: "r2", seasonId: "s9" };
    expect(await divisionForDriver(prisma, r1, "res")).toBe(2);
    expect(await divisionForDriver(prisma, r2, "res")).toBe(1);
    // Took over a Division 1 seat: stays on Division 1's grid.
    expect(await divisionForDriver(prisma, r1, "res2")).toBe(1);
    expect(await divisionForDriver(prisma, r1, "d2")).toBe(2);
    expect(await divisionForDriver(prisma, r1, "d1")).toBe(1);
  });
});
