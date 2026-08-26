import { describe, it, expect } from "vitest";
import { ensureSprintChild, readParentIds, readSprintChildren } from "./sprintRaces.js";

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
    expect(child.number ?? null).toBeNull(); // never a round
    expect(child.isSpecialEvent).toBe(true); // never scored
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
