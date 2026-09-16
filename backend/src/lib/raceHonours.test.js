import { describe, it, expect } from "vitest";
import { poleFromQuali, readPoleHolders } from "./raceHonours.js";

// Who took pole. The imported qualifying session decides where one is on
// file; the grid only speaks for rounds without one — a reverse-grid feature
// race puts somebody in slot 1 who did not qualify there, and that slot used
// to count as a pole everywhere.
describe("poleFromQuali", () => {
  it("names the fastest classified entrant", () => {
    expect(
      poleFromQuali({
        entries: [
          { position: 1, driverId: "A", bestLapMs: 90_000 },
          { position: 2, driverId: "B", bestLapMs: 90_500 },
        ],
      })
    ).toBe("A");
  });

  it("orders by lap when positions are missing", () => {
    expect(
      poleFromQuali({
        entries: [
          { driverId: "B", bestLapMs: 90_500 },
          { driverId: "A", bestLapMs: 90_000 },
        ],
      })
    ).toBe("A");
  });

  it("has no pole when the fastest entrant never matched a roster driver", () => {
    expect(
      poleFromQuali({
        entries: [
          { position: 1, driverId: null, acDriverName: "Guest", bestLapMs: 89_000 },
          { position: 2, driverId: "A", bestLapMs: 90_000 },
        ],
      })
    ).toBeNull();
  });

  it("ignores garage sitters and sentinel laps", () => {
    expect(
      poleFromQuali({
        entries: [
          { position: 1, driverId: "A", bestLapMs: 999_999_999 },
          { position: 2, driverId: "B", bestLapMs: null },
        ],
      })
    ).toBeNull();
    expect(poleFromQuali(null)).toBeNull();
    expect(poleFromQuali({})).toBeNull();
  });
});

describe("readPoleHolders", () => {
  // r1 has a quali on file and a reverse grid (B in slot 1); r2 has only a
  // grid; r3 has a quali whose fastest entrant is unmatched and a grid.
  const RACES = {
    r1: JSON.stringify({ entries: [{ position: 1, driverId: "A", bestLapMs: 90_000 }, { position: 2, driverId: "B", bestLapMs: 90_400 }] }),
    r3: JSON.stringify({ entries: [{ position: 1, driverId: null, bestLapMs: 89_000 }, { position: 2, driverId: "C", bestLapMs: 90_000 }] }),
  };
  const GRID1 = [
    { raceId: "r1", driverId: "B" },
    { raceId: "r2", driverId: "C" },
    { raceId: "r3", driverId: "D" },
  ];
  const prisma = {
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('"qualiJson"')) {
        return args.filter((id) => RACES[id]).map((id) => ({ id, qualiJson: RACES[id] }));
      }
      if (sql.includes('"grid" = 1')) return GRID1.filter((g) => args.includes(g.raceId));
      throw new Error(`unexpected: ${sql}`);
    },
  };

  it("takes the quali's fastest driver over the grid, and the grid where there is no quali", async () => {
    const poles = await readPoleHolders(prisma, ["r1", "r2", "r3"]);
    expect(poles.get("r1")).toBe("A"); // not B, who merely started first
    expect(poles.get("r2")).toBe("C");
  });

  it("never falls back to the grid for a round that HAS a quali", async () => {
    const poles = await readPoleHolders(prisma, ["r3"]);
    expect(poles.has("r3")).toBe(false);
  });

  it("copes with an empty list and a database from before the columns", async () => {
    expect((await readPoleHolders(prisma, [])).size).toBe(0);
    const old = { $queryRawUnsafe: async () => { throw new Error("no such column"); } };
    expect((await readPoleHolders(old, ["r1"])).size).toBe(0);
  });
});
