import { describe, it, expect, vi } from "vitest";

vi.mock("./notifications.js", () => ({ notifySeatOffered: vi.fn(), notifySeatReclaimed: vi.fn() }));

const { offerDeclinedDivision2Seats, offerDeclinedDivision2SeatsOnce } = await import("./division2SeatBackfill.js");
const { notifySeatOffered } = await import("./notifications.js");

const driver = (id, tier) => ({ id, name: id, teamId: `team${tier}`, team: { id: `team${tier}`, tier, name: `Team ${tier}` } });

// Season s9 runs Division 2. "r-next" is three days off, "r-running" started
// an hour ago, "r-event" is a special event.
function db() {
  const soon = new Date(Date.now() + 3 * 86_400_000);
  const state = {
    settings: {},
    races: [
      { id: "r-next", seasonId: "s9", isCompleted: false, isSpecialEvent: false, date: soon, track: "Hockenheim", number: 1 },
      { id: "r-running", seasonId: "s9", isCompleted: false, isSpecialEvent: false, date: new Date(Date.now() - 3_600_000) },
      { id: "r-event", seasonId: "s9", isCompleted: false, isSpecialEvent: true, date: soon },
    ],
    rsvps: [],
    offers: [
      // An admin entered this swap by hand, and took another one back.
      { id: "o1", raceId: "r-next", driverId: "pengi", teamId: "team3", status: "FILLED", filledById: "res" },
      { id: "o2", raceId: "r-next", driverId: "spartan", teamId: "team3", status: "CANCELLED", filledById: null },
    ],
  };
  for (const race of state.races) {
    for (const [d, status] of [
      [driver("roman", 3), "DECLINED"],
      [driver("lewis", 3), "DECLINED"],
      [driver("pengi", 3), "DECLINED"],
      [driver("spartan", 3), "DECLINED"],
      [driver("genna", 3), "ACCEPTED"],
      // Tier 1, declined, no offer: they took it back on purpose.
      [driver("duck", 1), "DECLINED"],
      [driver("guest", 0), "DECLINED"],
    ]) state.rsvps.push({ raceId: race.id, driverId: d.id, status, driver: d });
  }
  let n = 2;
  const match = (o, where) =>
    (!where.raceId || o.raceId === where.raceId) &&
    (!where.driverId || o.driverId === where.driverId) &&
    (!where.status || (typeof where.status === "string" ? o.status === where.status : o.status !== where.status.not));
  return {
    state,
    $queryRawUnsafe: async () => [{ id: "s9" }],
    race: {
      findMany: async ({ where }) =>
        state.races.filter((r) => !r.isCompleted && !r.isSpecialEvent && (r.date == null || r.date > where.OR[1].date.gt)),
    },
    raceRsvp: { findMany: async ({ where }) => state.rsvps.filter((r) => r.raceId === where.raceId && r.status === where.status) },
    seatOffer: {
      findMany: async ({ where }) => state.offers.filter((o) => match(o, where)),
      findFirst: async ({ where }) => state.offers.find((o) => match(o, where)) || null,
      upsert: async ({ where, create, update }) => {
        const k = where.raceId_driverId;
        const have = state.offers.find((o) => o.raceId === k.raceId && o.driverId === k.driverId);
        if (have) return Object.assign(have, update);
        const row = { id: `o${++n}`, filledById: null, ...create };
        state.offers.push(row);
        return row;
      },
    },
    setting: {
      findUnique: async ({ where }) => (state.settings[where.key] ? { value: state.settings[where.key] } : null),
      upsert: async ({ where, create }) => {
        state.settings[where.key] = create.value;
      },
    },
  };
}

describe("Division 2 drivers who had already declined", () => {
  it("get their seat put up for the coming round, and nobody else does", async () => {
    const prisma = db();
    const offered = await offerDeclinedDivision2Seats(prisma);
    expect(offered.map((o) => `${o.raceId}:${o.driverId}`)).toEqual(["r-next:roman", "r-next:lewis"]);
    const open = prisma.state.offers.filter((o) => o.status === "OPEN");
    expect(open).toMatchObject([
      { raceId: "r-next", driverId: "roman", teamId: "team3" },
      { raceId: "r-next", driverId: "lewis", teamId: "team3" },
    ]);
    // The swap entered by hand and the offer an admin took back are as they were.
    expect(prisma.state.offers.find((o) => o.id === "o1")).toMatchObject({ status: "FILLED", filledById: "res" });
    expect(prisma.state.offers.find((o) => o.id === "o2").status).toBe("CANCELLED");
    expect(notifySeatOffered).toHaveBeenCalledTimes(2);
  });

  it("runs once", async () => {
    const prisma = db();
    expect(await offerDeclinedDivision2SeatsOnce(prisma)).toHaveLength(2);
    expect(await offerDeclinedDivision2SeatsOnce(prisma)).toBeNull();
    expect(prisma.state.offers.filter((o) => o.status === "OPEN")).toHaveLength(2);
    expect(JSON.parse(prisma.state.settings.division2_declines_offered).offered).toHaveLength(2);
  });
});
