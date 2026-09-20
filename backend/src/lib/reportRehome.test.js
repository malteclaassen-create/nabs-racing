// A sprint weekend's in-game presses all land on the event; once the result
// files are in, the ones pressed during the sprint move onto the sprint.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const A = "76561198000000001";
const T_FEATURE = 1788545000; // unix seconds: the feature's clock
const T_SPRINT = T_FEATURE + 3600; // the sprint, an hour later
const WAIT = 60;

// A two-lap file whose clock starts at t0 (lib/raceContacts.js measures the
// start as first lap minus its time minus wait_time).
const file = (t0) => ({
  Type: "RACE",
  SessionConfig: { wait_time: WAIT },
  Result: [{ DriverGuid: A, DriverName: "Alpha", NumLaps: 2, TotalTime: 120000 }],
  Laps: [
    { DriverGuid: A, DriverName: "Alpha", LapTime: 60000, Timestamp: t0 + WAIT + 60, Cuts: 0 },
    { DriverGuid: A, DriverName: "Alpha", LapTime: 60000, Timestamp: t0 + WAIT + 120, Cuts: 0 },
  ],
  Events: [],
});

const iso = (sec) => new Date(sec * 1000).toISOString();

function fakePrisma(reports) {
  return {
    reports,
    $queryRawUnsafe: async (sql, ...ids) =>
      reports.filter((r) => r.source === "INGAME" && r.incidentAt && ids.includes(r.raceId)),
    $executeRawUnsafe: async (sql, raceId, id) => {
      const r = reports.find((x) => x.id === id);
      if (r) r.raceId = raceId;
      return 1;
    },
  };
}

let dataDir;
let rehomeWeekendReports;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "rehome-"));
  process.env.DATA_DIR = dataDir;
  const dir = join(dataDir, "results-archive", "season8");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "r05-spa.json"), JSON.stringify(file(T_FEATURE)));
  writeFileSync(join(dir, "r05-spa-sprint.json"), JSON.stringify(file(T_SPRINT)));
  ({ rehomeWeekendReports } = await import("./reportRehome.js"));
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("rehomeWeekendReports", () => {
  it("moves the presses of the sprint onto the sprint and leaves the rest", async () => {
    const reports = [
      { id: "a", raceId: "parent", source: "INGAME", incidentAt: iso(T_FEATURE + WAIT + 90) }, // feature
      { id: "b", raceId: "parent", source: "INGAME", incidentAt: iso(T_SPRINT + WAIT + 90) }, // sprint
      { id: "c", raceId: "child", source: "INGAME", incidentAt: iso(T_FEATURE + WAIT + 30) }, // filed wrong
      { id: "d", raceId: "parent", source: "MEMBER", incidentAt: iso(T_SPRINT + WAIT + 90) }, // by hand: stays
      { id: "e", raceId: "parent", source: "INGAME", incidentAt: iso(T_FEATURE - 3600) }, // nobody's window
    ];
    const prisma = fakePrisma(reports);
    const moved = await rehomeWeekendReports(prisma, {
      season: 8,
      parent: { id: "parent", number: 5 },
      child: { id: "child" },
    });
    expect(moved).toBe(2);
    expect(reports.map((r) => [r.id, r.raceId])).toEqual([
      ["a", "parent"],
      ["b", "child"],
      ["c", "parent"],
      ["d", "parent"],
      ["e", "parent"],
    ]);
  });

  it("does nothing for a round with no file", async () => {
    const reports = [{ id: "a", raceId: "parent", source: "INGAME", incidentAt: iso(T_SPRINT) }];
    const moved = await rehomeWeekendReports(fakePrisma(reports), {
      season: 8,
      parent: { id: "parent", number: 6 },
      child: { id: "child" },
    });
    expect(moved).toBe(0);
    expect(reports[0].raceId).toBe("parent");
  });
});
