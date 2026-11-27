import { describe, it, expect, vi } from "vitest";

vi.mock("./notifications.js", () => ({ notifyReserveSignupRemoved: vi.fn(), notifyWaitlistPromoted: vi.fn() }));
vi.mock("./waitlist.js", () => ({ promoteFromWaitlist: vi.fn(async () => []) }));
vi.mock("../services/discordService.js", () => ({ syncRaceToDiscord: vi.fn(async () => ({})) }));
vi.mock("./persons.js", () => ({
  getPersonGroups: vi.fn(async () => ({ byDriver: new Map([["twin_res", "p1"], ["twin_seat", "p1"]]), byPerson: new Map() })),
  discordIdsForDrivers: vi.fn(async (prisma, ids) => new Map(ids.map((id) => [id, `discord-${id}`]))),
}));

const { reserveSignupsToClear, clearReserveSignups, clearReserveSignupsOnce } = await import("./reserveSignupCleanup.js");
const { notifyReserveSignupRemoved } = await import("./notifications.js");
const { promoteFromWaitlist } = await import("./waitlist.js");

const reserve = (id) => ({ id, name: id, tier: 0, team: { tier: 0 } });
const seatedDriver = (id, tier = 1) => ({ id, name: id, tier, team: { tier } });
const answer = (id, driver, status) => ({ id: `a-${id}-${driver.id}`, driverId: driver.id, status, driver });

describe("which answers go", () => {
  const byDriver = new Map([["twin_res", "p1"], ["twin_seat", "p1"]]);
  const pick = (rsvps, seated = [], withSeat = []) =>
    reserveSignupsToClear({ rsvps, seated: new Set(seated), withSeat: new Set(withSeat), byDriver }).map((r) => r.driverId);

  it("a reserve's accepted, tentative and waiting-list answer", () => {
    const rsvps = [answer(1, reserve("a"), "ACCEPTED"), answer(1, reserve("b"), "TENTATIVE"), answer(1, reserve("c"), "WAITLIST")];
    expect(pick(rsvps)).toEqual(["a", "b", "c"]);
  });

  it("not a decline, a driver with a seat, or a reserve who was given a car", () => {
    const rsvps = [
      answer(1, reserve("no"), "DECLINED"),
      answer(1, seatedDriver("t1"), "ACCEPTED"),
      answer(1, seatedDriver("d2", 3), "ACCEPTED"),
      answer(1, reserve("sub"), "ACCEPTED"),
    ];
    expect(pick(rsvps, ["sub"])).toEqual([]);
  });

  it("not somebody whose other row in the season has a seat", () => {
    expect(pick([answer(1, reserve("twin_res"), "ACCEPTED")], [], ["p1"])).toEqual([]);
  });
});

// Season s9 runs Division 2, s8 does not. Rounds: r-next (three days off),
// r-running (started), r-done, r-event, r-other (one division).
function db() {
  const soon = new Date(Date.now() + 3 * 86_400_000);
  const state = {
    settings: {},
    races: [
      { id: "r-next", seasonId: "s9", isCompleted: false, isSpecialEvent: false, date: soon, track: "Suzuka", number: 11 },
      { id: "r-running", seasonId: "s9", isCompleted: false, isSpecialEvent: false, date: new Date(Date.now() - 3_600_000) },
      { id: "r-done", seasonId: "s9", isCompleted: true, isSpecialEvent: false, date: new Date(Date.now() - 86_400_000) },
      { id: "r-event", seasonId: "s9", isCompleted: false, isSpecialEvent: true, date: soon },
      { id: "r-other", seasonId: "s8", isCompleted: false, isSpecialEvent: false, date: soon },
    ],
    rsvps: [],
    offers: [{ raceId: "r-next", status: "FILLED", filledById: "sub" }],
  };
  for (const race of state.races) {
    state.rsvps.push(
      { ...answer(race.id, reserve("guest"), "ACCEPTED"), raceId: race.id },
      { ...answer(race.id, reserve("mitch"), "WAITLIST"), raceId: race.id },
      { ...answer(race.id, reserve("sub"), "ACCEPTED"), raceId: race.id },
      { ...answer(race.id, reserve("out"), "DECLINED"), raceId: race.id },
      { ...answer(race.id, seatedDriver("bot"), "ACCEPTED"), raceId: race.id }
    );
  }
  return {
    state,
    $queryRawUnsafe: async () => [{ id: "s9" }],
    race: {
      findMany: async ({ where }) =>
        state.races.filter(
          (r) =>
            where.seasonId.in.includes(r.seasonId) &&
            !r.isCompleted &&
            !r.isSpecialEvent &&
            (r.date == null || r.date > where.OR[1].date.gt)
        ),
    },
    raceRsvp: {
      findMany: async ({ where }) => state.rsvps.filter((r) => r.raceId === where.raceId),
      deleteMany: async ({ where }) => {
        state.rsvps = state.rsvps.filter((r) => !where.id.in.includes(r.id));
      },
    },
    seatOffer: { findMany: async ({ where }) => state.offers.filter((o) => o.raceId === where.raceId) },
    driver: { findMany: async () => [{ id: "bot" }] },
    setting: {
      findUnique: async ({ where }) => (state.settings[where.key] ? { value: state.settings[where.key] } : null),
      upsert: async ({ where, create }) => {
        state.settings[where.key] = create.value;
      },
    },
  };
}

describe("taking them off", () => {
  it("clears the coming round of a two-division season and nothing else", async () => {
    const prisma = db();
    const removed = await clearReserveSignups(prisma);
    expect(removed.map((r) => `${r.raceId}:${r.driverId}`)).toEqual(["r-next:guest", "r-next:mitch"]);
    const left = (raceId) => prisma.state.rsvps.filter((r) => r.raceId === raceId).map((r) => r.driverId);
    expect(left("r-next")).toEqual(["sub", "out", "bot"]);
    for (const untouched of ["r-running", "r-done", "r-event", "r-other"]) expect(left(untouched)).toHaveLength(5);
    expect(notifyReserveSignupRemoved).toHaveBeenCalledTimes(2);
    expect(notifyReserveSignupRemoved.mock.calls[0][1]).toMatchObject({ driverId: "guest", recipientId: "discord-guest" });
    expect(promoteFromWaitlist).toHaveBeenCalledWith(prisma, "r-next");
  });

  it("runs once: a reserve an admin enters afterwards stays", async () => {
    const prisma = db();
    expect(await clearReserveSignupsOnce(prisma)).toHaveLength(2);
    prisma.state.rsvps.push({ ...answer("later", reserve("byhand"), "ACCEPTED"), raceId: "r-next" });
    expect(await clearReserveSignupsOnce(prisma)).toBeNull();
    expect(prisma.state.rsvps.some((r) => r.driverId === "byhand")).toBe(true);
    // What went is on record.
    expect(JSON.parse(prisma.state.settings.reserve_signups_cleared).removed).toHaveLength(2);
  });
});
