import { describe, it, expect } from "vitest";
import { seatsFor, promoteFromWaitlist, WAITLIST } from "./waitlist.js";

// A prisma stand-in with just the four calls the waiting list makes. The
// person-grouping and the bell notification both look things up through the
// same client and both already swallow their own failures, so a fake this thin
// exercises the real code path.
function fakePrisma({ capacity = 3, isCompleted = false, answers = [], offers = 0 } = {}) {
  const rows = answers.map((a, i) => ({
    id: `r${i}`,
    driverId: a.driverId,
    status: a.status,
    updatedAt: new Date(a.at || 0).toISOString(),
    driver: { id: a.driverId, name: a.driverId, discordUserId: null },
  }));
  return {
    rows,
    race: { findUnique: async () => ({ id: "race1", capacity, isCompleted, seasonId: "s1", track: "Baku" }) },
    raceRsvp: {
      findMany: async () => rows,
      update: async ({ where, data }) => {
        rows.find((r) => r.id === where.id).status = data.status;
      },
    },
    seatOffer: { count: async () => offers },
  };
}

const race = { id: "race1", capacity: 3 };

describe("seatsFor", () => {
  it("counts accepted answers against the grid size", async () => {
    const p = fakePrisma({
      answers: [
        { driverId: "a", status: "ACCEPTED" },
        { driverId: "b", status: "ACCEPTED" },
        { driverId: "c", status: "DECLINED" },
      ],
    });
    const seats = await seatsFor(p, race);
    expect(seats.accepted).toBe(2);
    expect(seats.free).toBe(true);
  });

  it("shuts the door once the grid is full", async () => {
    const p = fakePrisma({
      answers: ["a", "b", "c"].map((driverId) => ({ driverId, status: "ACCEPTED" })),
    });
    expect((await seatsFor(p, race)).free).toBe(false);
  });

  it("treats a car offered in the Driver Market as still taken", async () => {
    // The offering driver is DECLINED, so accepted is 2 of 3 — but that seat is
    // spoken for and must not be handed to the queue as well.
    const p = fakePrisma({
      answers: [
        { driverId: "a", status: "ACCEPTED" },
        { driverId: "b", status: "ACCEPTED" },
        { driverId: "c", status: "DECLINED" },
      ],
      offers: 1,
    });
    expect((await seatsFor(p, race)).free).toBe(false);
  });

  it("reports the caller's own answer", async () => {
    const p = fakePrisma({ answers: [{ driverId: "a", status: WAITLIST }] });
    expect((await seatsFor(p, race, "a")).mine).toBe(WAITLIST);
  });
});

describe("promoteFromWaitlist", () => {
  it("moves the longest waiting driver up when a seat comes free", async () => {
    const p = fakePrisma({
      answers: [
        { driverId: "a", status: "ACCEPTED" },
        { driverId: "b", status: "ACCEPTED" },
        { driverId: "late", status: WAITLIST, at: "2026-09-20T12:00:00Z" },
        { driverId: "early", status: WAITLIST, at: "2026-09-20T09:00:00Z" },
      ],
    });
    const moved = await promoteFromWaitlist(p, "race1");
    expect(moved.map((r) => r.driverId)).toEqual(["early"]);
    expect(p.rows.find((r) => r.driverId === "late").status).toBe(WAITLIST);
  });

  it("fills every seat a bigger grid opened up, in order", async () => {
    const p = fakePrisma({
      capacity: 4,
      answers: [
        { driverId: "a", status: "ACCEPTED" },
        { driverId: "b", status: WAITLIST, at: "2026-09-20T09:00:00Z" },
        { driverId: "c", status: WAITLIST, at: "2026-09-20T10:00:00Z" },
        { driverId: "d", status: WAITLIST, at: "2026-09-20T11:00:00Z" },
      ],
    });
    const moved = await promoteFromWaitlist(p, "race1");
    expect(moved.map((r) => r.driverId)).toEqual(["b", "c", "d"]);
  });

  it("leaves a full grid alone", async () => {
    const p = fakePrisma({
      answers: [
        ...["a", "b", "c"].map((driverId) => ({ driverId, status: "ACCEPTED" })),
        { driverId: "d", status: WAITLIST },
      ],
    });
    expect(await promoteFromWaitlist(p, "race1")).toEqual([]);
  });

  it("nobody is pushed out of a round that is already over capacity", async () => {
    const p = fakePrisma({
      answers: [
        ...["a", "b", "c", "d"].map((driverId) => ({ driverId, status: "ACCEPTED" })),
        { driverId: "e", status: WAITLIST },
      ],
    });
    await promoteFromWaitlist(p, "race1");
    expect(p.rows.filter((r) => r.status === "ACCEPTED")).toHaveLength(4);
  });

  it("does nothing once the race has run", async () => {
    const p = fakePrisma({ isCompleted: true, answers: [{ driverId: "a", status: WAITLIST }] });
    expect(await promoteFromWaitlist(p, "race1")).toEqual([]);
  });
});
