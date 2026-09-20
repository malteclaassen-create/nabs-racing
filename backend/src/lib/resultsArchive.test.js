// The archive files each round under its season's SERIES, so two leagues'
// "season 8, round 2" never land on top of each other. These cover the index
// that knows the series, where a season reads from and writes to, and the
// one-time move of the pre-series folders under the first series.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dataDir;
let archiveDirsFor, refreshArchiveIndex, migrateArchiveLayout, saveDirect, seriesSlugForSeason;

const fakePrisma = {
  $queryRawUnsafe: async (sql) => {
    if (sql.includes('FROM "Series"')) {
      return [
        { id: "ser-f1", slug: "friday-f1" },
        { id: "ser-gt", slug: "sunday-gt" },
      ];
    }
    return [
      { id: "s8-f1", seriesId: "ser-f1" },
      { id: "s8-gt", seriesId: "ser-gt" },
      { id: "s-orphan", seriesId: null },
    ];
  },
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "archive-"));
  process.env.DATA_DIR = dataDir;
  ({ archiveDirsFor, refreshArchiveIndex, migrateArchiveLayout, saveDirect, seriesSlugForSeason } = await import("./resultsArchive.js"));
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("before the index knows anything", () => {
  it("reads and writes the root folder, as it always did", () => {
    expect(archiveDirsFor({ id: "s8-f1", number: 8 })).toEqual([join(dataDir, "results-archive", "season8")]);
    expect(archiveDirsFor(8)).toEqual([join(dataDir, "results-archive", "season8")]);
  });
});

describe("with the index", () => {
  beforeAll(() => refreshArchiveIndex(fakePrisma));

  it("knows each season's series", () => {
    expect(seriesSlugForSeason("s8-f1")).toBe("friday-f1");
    expect(seriesSlugForSeason("s8-gt")).toBe("sunday-gt");
    expect(seriesSlugForSeason("s-orphan")).toBeNull();
  });

  it("files a season under its series, and lets the first series fall back to the root", () => {
    const root = join(dataDir, "results-archive");
    expect(archiveDirsFor({ id: "s8-f1", number: 8 })).toEqual([join(root, "friday-f1", "season8"), join(root, "season8")]);
    expect(archiveDirsFor({ id: "s8-gt", number: 8 })).toEqual([join(root, "sunday-gt", "season8")]);
    expect(archiveDirsFor({ id: "s-orphan", number: 3 })).toEqual([join(root, "season3")]);
  });

  it("keeps the two leagues' round 2 apart on disk", () => {
    const f1 = saveDirect({ Type: "RACE" }, { season: { id: "s8-f1", number: 8 }, raceNumber: 2, track: "Watkins Glen" });
    const gt = saveDirect({ Type: "RACE" }, { season: { id: "s8-gt", number: 8 }, raceNumber: 2, track: "Watkins Glen" });
    expect(f1).toBe(join(dataDir, "results-archive", "friday-f1", "season8", "r02-watkins-glen.json"));
    expect(gt).toBe(join(dataDir, "results-archive", "sunday-gt", "season8", "r02-watkins-glen.json"));
    expect(existsSync(f1) && existsSync(gt)).toBe(true);
  });

  it("moves the pre-series folders under the first series, once, without clobbering", () => {
    const root = join(dataDir, "results-archive");
    mkdirSync(join(root, "season7"), { recursive: true });
    writeFileSync(join(root, "season7", "r01-spa.json"), "{}");
    // A round the series folder already has stays as it is; the rest moves.
    mkdirSync(join(root, "season8"), { recursive: true });
    writeFileSync(join(root, "season8", "r02-watkins-glen.json"), '{"old":true}');
    writeFileSync(join(root, "season8", "r03-monza.json"), "{}");

    const moved = migrateArchiveLayout();
    expect(moved).toBe(2); // the whole season7 folder, and r03 of season8
    expect(existsSync(join(root, "friday-f1", "season7", "r01-spa.json"))).toBe(true);
    expect(existsSync(join(root, "friday-f1", "season8", "r03-monza.json"))).toBe(true);
    expect(readdirSync(join(root, "friday-f1", "season8"))).toHaveLength(2);
    // The clash was left at the root, not written over; the folder stays because it is not empty.
    expect(existsSync(join(root, "season8", "r02-watkins-glen.json"))).toBe(true);
    expect(existsSync(join(root, "season7"))).toBe(false);
    // Running it again finds nothing more to do.
    expect(migrateArchiveLayout()).toBe(0);
  });
});
