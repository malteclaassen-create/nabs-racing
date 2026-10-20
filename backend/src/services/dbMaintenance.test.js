import { describe, it, expect, vi } from "vitest";
import { worthVacuuming, pruneOldIncidents, runDbMaintenance, INCIDENT_KEEP_DAYS } from "./dbMaintenance.js";

// A stand-in for the Prisma client that records the SQL it is sent and
// answers the PRAGMAs with the numbers given.
function fakePrisma({ pageSize = 4096, pageCount = 10000, freePages = 0, deleted = 0 } = {}) {
  const sql = [];
  return {
    sql,
    $executeRawUnsafe: vi.fn(async (q, ...args) => {
      sql.push([q, ...args]);
      return q.startsWith("DELETE") ? deleted : 0;
    }),
    $queryRawUnsafe: vi.fn(async (q) => {
      sql.push([q]);
      if (q === "PRAGMA page_size") return [{ page_size: BigInt(pageSize) }];
      if (q === "PRAGMA page_count") return [{ page_count: BigInt(pageCount) }];
      if (q === "PRAGMA freelist_count") return [{ freelist_count: BigInt(freePages) }];
      return [{ busy: 0n, log: 0n, checkpointed: 0n }];
    }),
  };
}

const quiet = () => true;
const somebodyDriving = () => false;

describe("worthVacuuming", () => {
  it("only bothers when a real share of a real amount is free", () => {
    // 40 MB file, 25% free: yes.
    expect(worthVacuuming({ pageSize: 4096, pageCount: 10000, freePages: 2500 })).toBe(true);
    // 25% free, but of a tiny file: not worth a lock.
    expect(worthVacuuming({ pageSize: 4096, pageCount: 1000, freePages: 250 })).toBe(false);
    // Lots of bytes, small share of a huge file: no.
    expect(worthVacuuming({ pageSize: 4096, pageCount: 1_000_000, freePages: 10_000 })).toBe(false);
    expect(worthVacuuming({ pageSize: 0, pageCount: 0, freePages: 0 })).toBe(false);
  });
});

describe("pruneOldIncidents", () => {
  it("removes incidents recorded more than a month ago", async () => {
    const prisma = fakePrisma();
    const now = Date.UTC(2026, 9, 20);
    await pruneOldIncidents(prisma, now);
    const [q, cutoff] = prisma.sql[0];
    expect(q).toBe('DELETE FROM "Incident" WHERE "createdAtMs" < ?');
    expect(cutoff).toBe(now - INCIDENT_KEEP_DAYS * 24 * 3600 * 1000);
  });
});

describe("runDbMaintenance", () => {
  it("vacuums a half-empty file on a quiet night, then cuts the WAL back", async () => {
    const prisma = fakePrisma({ freePages: 5000, deleted: 12 });
    const out = await runDbMaintenance(prisma, { isQuiet: quiet });
    expect(out).toMatchObject({ incidents: 12, vacuumed: true, freeShare: 0.5 });
    const order = prisma.sql.map(([q]) => q);
    expect(order.indexOf("VACUUM")).toBeLessThan(order.indexOf("PRAGMA wal_checkpoint(TRUNCATE)"));
  });

  it("never vacuums while somebody is on track", async () => {
    const prisma = fakePrisma({ freePages: 5000 });
    const out = await runDbMaintenance(prisma, { isQuiet: somebodyDriving });
    expect(out.vacuumed).toBe(false);
    expect(prisma.sql.map(([q]) => q)).not.toContain("VACUUM");
    expect(prisma.sql.map(([q]) => q)).toContain("PRAGMA wal_checkpoint(TRUNCATE)");
  });

  it("does not vacuum a file that is nearly full", async () => {
    const prisma = fakePrisma({ freePages: 100 });
    expect((await runDbMaintenance(prisma, { isQuiet: quiet })).vacuumed).toBe(false);
  });

  it("carries on with the other chores when one fails", async () => {
    const prisma = fakePrisma({ freePages: 5000 });
    prisma.$executeRawUnsafe.mockImplementationOnce(async () => {
      throw new Error("no such table: Incident");
    });
    const out = await runDbMaintenance(prisma, { isQuiet: quiet });
    expect(out.vacuumed).toBe(true);
  });
});
