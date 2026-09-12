import { describe, it, expect } from "vitest";
import { withClassifiedPositions } from "./penalisedResults.js";

// The whole field of one round, as stored: raw file order. Driver "b" finished
// P1 on the road but carries a 10 s penalty and only had 5 s over "c".
const field = [
  { raceId: "r1", driverId: "a", position: 3, status: "FINISHED", points: null, penaltySeconds: 0, totalTimeMs: 3_620_000, laps: 30 },
  { raceId: "r1", driverId: "b", position: 1, status: "FINISHED", points: null, penaltySeconds: 10, totalTimeMs: 3_600_000, laps: 30 },
  { raceId: "r1", driverId: "c", position: 2, status: "FINISHED", points: null, penaltySeconds: 0, totalTimeMs: 3_605_000, laps: 30 },
  { raceId: "r1", driverId: "d", position: 4, status: "DNF", points: null, penaltySeconds: 0, totalTimeMs: null, laps: 12 },
];
const prisma = {
  raceResult: {
    findMany: async ({ where }) => field.filter((r) => where.raceId.in.includes(r.raceId)),
  },
};

describe("withClassifiedPositions", () => {
  it("gives a driver's rows the classified position, not the raw file order", async () => {
    const mine = [{ raceId: "r1", driverId: "c", position: 2, status: "FINISHED", points: null, penaltySeconds: 0, totalTimeMs: 3_605_000, laps: 30, race: { track: "Most" } }];
    const out = await withClassifiedPositions(prisma, mine);
    expect(out[0].position).toBe(1);
    expect(out[0].race).toEqual({ track: "Most" }); // extra fields ride along
  });

  it("demotes the penalised car", async () => {
    const out = await withClassifiedPositions(prisma, [field[1]]);
    expect(out[0].position).toBe(2);
  });

  it("leaves non-finishers and unmoved rows as they are", async () => {
    const out = await withClassifiedPositions(prisma, [field[3], field[0]]);
    expect(out[0]).toBe(field[3]);
    expect(out[1]).toBe(field[0]);
  });

  it("handles an empty list without touching the database", async () => {
    expect(await withClassifiedPositions({ raceResult: { findMany: () => { throw new Error("no"); } } }, [])).toEqual([]);
  });
});
