import { describe, it, expect } from "vitest";
import { shapeDownload, ensureDownloadTables, dbCreateDownload, dbUpdateDownload } from "./downloads.js";

// A stand-in for the Prisma client that writes down every raw statement.
// Tagged-template calls arrive as (strings, ...values); unsafe ones as (sql).
function fakePrisma({ columns = [] } = {}) {
  const calls = [];
  const row = { id: "x", title: "T", published: 1, required: 1 };
  return {
    calls,
    $executeRawUnsafe: async (sql) => { calls.push({ sql }); return 0; },
    $queryRawUnsafe: async (sql) => (/PRAGMA/.test(sql) ? columns.map((name) => ({ name })) : []),
    $executeRaw: async (strings, ...values) => { calls.push({ sql: strings.join("?"), values }); return 1; },
    $queryRaw: async () => [row],
  };
}

describe("Download.required", () => {
  it("comes out of shapeDownload as a real boolean", () => {
    expect(shapeDownload({ id: "a", title: "CSP", required: 1n }).required).toBe(true);
    expect(shapeDownload({ id: "a", title: "CSP", required: 0 }).required).toBe(false);
    // A row read before the column existed counts as optional.
    expect(shapeDownload({ id: "a", title: "CSP" }).required).toBe(false);
  });

  it("is added at boot when the column is missing, and only then", async () => {
    const fresh = fakePrisma({ columns: ["id", "folderId", "raceId"] });
    await ensureDownloadTables(fresh);
    expect(fresh.calls.some((c) => /ADD COLUMN "required" INTEGER NOT NULL DEFAULT 0/.test(c.sql))).toBe(true);

    const done = fakePrisma({ columns: ["id", "folderId", "raceId", "required"] });
    await ensureDownloadTables(done);
    expect(done.calls.some((c) => /ADD COLUMN "required"/.test(c.sql))).toBe(false);
  });

  it("is written on create and update", async () => {
    const p = fakePrisma();
    await dbCreateDownload(p, { title: "Track pack", required: true, published: true });
    const insert = p.calls.find((c) => /INSERT INTO "Download"/.test(c.sql));
    expect(insert.sql).toMatch(/"required"\)/);
    expect(insert.values.at(-1)).toBe(1);

    await dbUpdateDownload(p, "x", { title: "Track pack", required: false, published: true });
    const update = p.calls.find((c) => /UPDATE "Download" SET/.test(c.sql));
    expect(update.sql).toMatch(/"required" = \?/);
    expect(update.values.at(-2)).toBe(0); // last value is the id
  });
});
