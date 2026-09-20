import { describe, it, expect } from "vitest";
import {
  ensureSprintChild, readParentIds, readSprintChildren, readSprintChildrenOf,
  withSprintClassifications, withSprintRounds,
} from "./sprintRaces.js";

// A minimal in-memory Race table speaking just enough prisma for the lib: the
// raw reads/writes it does are pinned here, because the sprint child is the one
// row in the schema that must NEVER show up twice for an event — a second
// import of the same sprint has to land on the same child.
function fakePrisma() {
  const rows = new Map(); // id -> race row
  let n = 0;
  return {
    rows,
    race: {
      create: async ({ data }) => {
        const row = { id: `race${++n}`, parentRaceId: null, country: null, raceLaps: null, type: "CHAMPIONSHIP", ...data };
        rows.set(row.id, row);
        return row;
      },
      findUnique: async ({ where }) => rows.get(where.id) || null,
      findMany: async ({ where }) => [...rows.values()].filter((r) => where.id.in.includes(r.id)),
    },
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('"parentRaceId" IS NOT NULL')) {
        return [...rows.values()].filter((r) => r.parentRaceId && args.includes(r.id));
      }
      if (sql.includes('"parentRaceId" IN')) {
        return [...rows.values()].filter((r) => args.includes(r.parentRaceId));
      }
      if (sql.includes('SELECT "country", "sprintLaps"')) {
        const r = rows.get(args[0]);
        return r ? [{ country: r.country ?? null, sprintLaps: r.sprintLaps ?? null }] : [];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    $executeRawUnsafe: async (sql, ...args) => {
      const id = args[args.length - 1];
      const r = rows.get(id);
      if (!r) return 0;
      if (sql.includes('"parentRaceId" =')) r.parentRaceId = args[0];
      else if (sql.includes('"country" =')) r.country = args[0];
      else if (sql.includes('"raceLaps" =')) r.raceLaps = args[0];
      else if (sql.includes('"type" =')) r.type = args[0];
      else throw new Error(`unexpected write: ${sql}`);
      return 1;
    },
    setting: { findUnique: async () => null, upsert: async () => null },
  };
}

describe("ensureSprintChild", () => {
  it("creates the hidden child once and returns the same row after that", async () => {
    const prisma = fakePrisma();
    const parent = await prisma.race.create({
      data: { track: "Barcelona", seasonId: "s8", date: new Date("2026-08-28"), country: "es", sprintLaps: 12 },
    });
    const child = await ensureSprintChild(prisma, parent);
    const again = await ensureSprintChild(prisma, parent);
    expect(again.id).toBe(child.id);
    expect([...prisma.rows.values()].filter((r) => r.parentRaceId === parent.id)).toHaveLength(1);
  });

  it("shapes the child so nothing downstream can mistake it for a race of its own", async () => {
    const prisma = fakePrisma();
    const parent = await prisma.race.create({
      data: { track: "Barcelona", seasonId: "s8", date: new Date("2026-08-28"), country: "es", sprintLaps: 12 },
    });
    const child = await ensureSprintChild(prisma, parent);
    expect(child.number ?? null).toBeNull(); // never a round of its own
    expect(child.isSpecialEvent).toBe(true); // not counted as a round (it scores through its parent)
    expect(child.type).toBe("SPECIAL"); // never announced / signed up
    expect(child.seasonId).toBe("s8");
    expect(child.track).toBe("Barcelona");
    expect(child.country).toBe("es"); // flag follows the event
    expect(child.raceLaps).toBe(12); // the sprint distance is the child's race
  });

  it("refuses to hang a child on a child", async () => {
    const prisma = fakePrisma();
    const parent = await prisma.race.create({ data: { track: "Barcelona", seasonId: "s8" } });
    const child = await ensureSprintChild(prisma, parent);
    await expect(ensureSprintChild(prisma, child)).rejects.toThrow(/sprint classification/);
  });
});

describe("readSprintChildrenOf", () => {
  it("maps each round's sprint child back to the round, and only rounds that have one", async () => {
    const prisma = fakePrisma();
    const parent = await prisma.race.create({ data: { number: 5, track: "Barcelona", seasonId: "s8" } });
    const plain = await prisma.race.create({ data: { number: 6, track: "Monza", seasonId: "s8" } });
    const child = await ensureSprintChild(prisma, parent);
    const map = await readSprintChildrenOf(prisma, [parent, plain]);
    expect([...map.keys()]).toEqual([child.id]);
    expect(map.get(child.id).number).toBe(5);
  });
});

describe("read maps", () => {
  it("answer both directions of the link and nothing else", async () => {
    const prisma = fakePrisma();
    const parent = await prisma.race.create({ data: { track: "Barcelona", seasonId: "s8" } });
    const plain = await prisma.race.create({ data: { track: "Monza", seasonId: "s8" } });
    const child = await ensureSprintChild(prisma, parent);
    const parents = await readParentIds(prisma, [parent.id, plain.id, child.id]);
    expect(parents.get(child.id)).toBe(parent.id);
    expect(parents.has(parent.id)).toBe(false);
    expect(parents.has(plain.id)).toBe(false);
    const children = await readSprintChildren(prisma, [parent.id, plain.id]);
    expect(children.get(parent.id)).toBe(child.id);
    expect(children.has(plain.id)).toBe(false);
  });
});

describe("withSprintRounds", () => {
  it("hands a sprint child its event's round number and the flag, and leaves the rest alone", async () => {
    const prisma = fakePrisma();
    const parent = await prisma.race.create({ data: { number: 5, track: "Barcelona", seasonId: "s8" } });
    const plain = await prisma.race.create({ data: { number: 6, track: "Monza", seasonId: "s8" } });
    const child = await ensureSprintChild(prisma, parent);
    // The child on its own: the parent's number has to be looked up.
    const [alone] = await withSprintRounds(prisma, [{ id: child.id, number: null }]);
    expect(alone).toMatchObject({ id: child.id, number: 5, sprint: true, hasSprint: false, roundId: parent.id });
    const rows = await withSprintRounds(prisma, [child, plain, parent]);
    expect(rows.map((r) => [r.number, r.sprint, r.hasSprint, r.roundId])).toEqual([
      [5, true, false, parent.id],
      [6, false, false, plain.id],
      [5, false, true, parent.id],
    ]);
  });
});

describe("withSprintClassifications", () => {
  // The ratings read this: a sprint is a race that was driven, so it counts —
  // but it has no round number of its own and must not become an extra round.
  it("adds each round's sprint under that round's number", async () => {
    const prisma = fakePrisma();
    const r5 = await prisma.race.create({ data: { number: 5, track: "Barcelona", seasonId: "s8", isCompleted: true } });
    const r6 = await prisma.race.create({ data: { number: 6, track: "Monza", seasonId: "s8", isCompleted: true } });
    const child = await ensureSprintChild(prisma, r5);
    child.isCompleted = true;

    const { races, sprintIds, roundOf } = await withSprintClassifications(prisma, [r5, r6]);
    expect(races).toHaveLength(3);
    const sprint = races.find((r) => r.id === child.id);
    // The parent's number, so an "as of round N" cut keeps the two together.
    expect(sprint).toMatchObject({ number: 5, sprintOf: r5.id });
    expect(sprintIds.has(child.id)).toBe(true);
    expect(sprintIds.has(r5.id)).toBe(false);
    // Both halves of the weekend map back to the one round.
    expect(roundOf.get(child.id)).toBe(r5.id);
    expect(roundOf.get(r5.id)).toBe(r5.id);
    expect(roundOf.get(r6.id)).toBe(r6.id);
  });

  it("leaves a season with no sprints exactly as it was", async () => {
    const prisma = fakePrisma();
    const r1 = await prisma.race.create({ data: { number: 1, track: "Spa", seasonId: "s8", isCompleted: true } });
    const { races, sprintIds } = await withSprintClassifications(prisma, [r1]);
    expect(races).toEqual([r1]);
    expect(sprintIds.size).toBe(0);
  });

  it("ignores a sprint whose result is not imported yet", async () => {
    const prisma = fakePrisma();
    const r5 = await prisma.race.create({ data: { number: 5, track: "Barcelona", seasonId: "s8", isCompleted: true } });
    // The feature can be on file before its sprint half is.
    await ensureSprintChild(prisma, r5);
    const { races, sprintIds } = await withSprintClassifications(prisma, [r5]);
    expect(races).toEqual([r5]);
    expect(sprintIds.size).toBe(0);
  });
});
