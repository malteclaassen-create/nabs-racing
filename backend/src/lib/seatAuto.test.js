import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./notifications.js", () => ({
  notifySeatOffered: vi.fn(),
  notifySeatReclaimed: vi.fn(),
}));

const { offerSeatOnDecline, reclaimSeat } = await import("./seatAuto.js");
const { notifySeatOffered, notifySeatReclaimed } = await import("./notifications.js");

// Just the three tables this touches: offers, interest in them, answers.
function db({ offers = [], rsvps = [], drivers = {} } = {}) {
  let n = 0;
  const state = {
    offers: offers.map((o) => ({ status: "OPEN", filledById: null, ...o })),
    interests: [],
    rsvps: [...rsvps],
  };
  const match = (o, where) =>
    (!where.raceId || o.raceId === where.raceId) &&
    (!where.driverId || (typeof where.driverId === "string" ? o.driverId === where.driverId : o.driverId !== where.driverId.not)) &&
    (!where.status || (typeof where.status === "string" ? o.status === where.status : o.status !== where.status.not));
  return {
    state,
    team: { findUnique: async ({ where }) => ({ t1: { id: "t1", tier: 1, name: "Williams" }, r: { id: "r", tier: 0, name: "Reserve" } })[where.id] || null },
    driver: { findUnique: async ({ where }) => drivers[where.id] || { id: where.id } },
    seatOffer: {
      findFirst: async ({ where }) => state.offers.find((o) => match(o, where)) || null,
      findMany: async ({ where }) => state.offers.filter((o) => match(o, where)),
      upsert: async ({ where, create, update }) => {
        const k = where.raceId_driverId;
        const have = state.offers.find((o) => o.raceId === k.raceId && o.driverId === k.driverId);
        if (have) return Object.assign(have, update);
        const row = { id: `o${++n}`, filledById: null, ...create };
        state.offers.push(row);
        return row;
      },
      delete: async ({ where }) => {
        state.offers = state.offers.filter((o) => o.id !== where.id);
        state.interests = state.interests.filter((i) => i.offerId !== where.id);
      },
    },
    seatInterest: {
      upsert: async ({ create }) => {
        if (!state.interests.some((i) => i.offerId === create.offerId && i.driverId === create.driverId)) state.interests.push(create);
      },
    },
    raceRsvp: {
      deleteMany: async ({ where }) => {
        state.rsvps = state.rsvps.filter(
          (r) => !(r.raceId === where.raceId && r.driverId === where.driverId && r.status === where.status)
        );
      },
    },
  };
}

const race = { id: "race8", seasonId: "s8", track: "Interlagos", number: 8, isCompleted: false, isSpecialEvent: false };
const pizd = { id: "pizd", teamId: "t1" };

beforeEach(() => vi.clearAllMocks());

describe("declining puts the seat up", () => {
  it("opens an offer for a full-time driver and rings the reserves", async () => {
    const prisma = db();
    await offerSeatOnDecline(prisma, race, pizd);
    expect(prisma.state.offers).toMatchObject([{ raceId: "race8", driverId: "pizd", teamId: "t1", status: "OPEN" }]);
    expect(notifySeatOffered).toHaveBeenCalledOnce();
  });

  it("puts it up, it does not hand it to anybody", async () => {
    const prisma = db();
    await offerSeatOnDecline(prisma, race, pizd);
    expect(prisma.state.offers[0].filledById).toBeNull();
  });

  it("leaves reserves, special events and finished races alone", async () => {
    const prisma = db();
    await offerSeatOnDecline(prisma, race, { id: "res", teamId: "r" });
    await offerSeatOnDecline(prisma, { ...race, isSpecialEvent: true }, pizd);
    await offerSeatOnDecline(prisma, { ...race, isCompleted: true }, pizd);
    expect(prisma.state.offers).toEqual([]);
  });

  it("does not touch a seat that is already up", async () => {
    const prisma = db({ offers: [{ id: "o1", raceId: "race8", driverId: "pizd", status: "FILLED", filledById: "res" }] });
    await offerSeatOnDecline(prisma, race, pizd);
    expect(prisma.state.offers).toHaveLength(1);
    expect(prisma.state.offers[0].filledById).toBe("res");
    expect(notifySeatOffered).not.toHaveBeenCalled();
  });
});

describe("saying yes again takes the seat back", () => {
  it("an open offer simply comes off the market", async () => {
    const prisma = db({ offers: [{ id: "o1", raceId: "race8", driverId: "pizd" }] });
    const r = await reclaimSeat(prisma, race, "pizd");
    expect(r).toEqual({ reclaimed: true, bumped: null, movedTo: 0 });
    expect(prisma.state.offers).toEqual([]);
  });

  it("a picked reserve loses the car and is put down for every other open seat", async () => {
    const prisma = db({
      offers: [
        { id: "o1", raceId: "race8", driverId: "pizd", status: "FILLED", filledById: "res" },
        { id: "o2", raceId: "race8", driverId: "other1" },
        { id: "o3", raceId: "race8", driverId: "other2" },
        { id: "o4", raceId: "race8", driverId: "other3", status: "FILLED", filledById: "res2" },
        { id: "o5", raceId: "race9", driverId: "other1" },
      ],
      rsvps: [
        { raceId: "race8", driverId: "res", status: "ACCEPTED" },
        { raceId: "race8", driverId: "res2", status: "ACCEPTED" },
      ],
    });
    const r = await reclaimSeat(prisma, race, "pizd");
    expect(r).toEqual({ reclaimed: true, bumped: "res", movedTo: 2 });
    // Off the entry list, and nobody else with them.
    expect(prisma.state.rsvps).toEqual([{ raceId: "race8", driverId: "res2", status: "ACCEPTED" }]);
    // Interest in the two OPEN seats of this race; not the filled one, not the next race.
    expect(prisma.state.interests.map((i) => i.offerId).sort()).toEqual(["o2", "o3"]);
    // Interest only: nobody picked them.
    expect(prisma.state.offers.filter((o) => o.filledById === "res")).toEqual([]);
    expect(notifySeatReclaimed).toHaveBeenCalledOnce();
  });

  it("with no seat up, nothing happens", async () => {
    const prisma = db();
    expect((await reclaimSeat(prisma, race, "pizd")).reclaimed).toBe(false);
  });
});
