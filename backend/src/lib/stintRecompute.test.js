// The one-time stint pass matches an archived result file to its stored race
// by date and track key. A mod layout the track table has no entry for (Most's
// "nabs_most_no_chicane") used to resolve to no key at all, so the round was
// skipped — and the pit recording, named by the recorder's own key, was never
// found. Both lookups now go the way the import goes.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GUID_A = "76561198000000001";
const GUID_B = "76561198000000002";
const GUID_C = "76561198000000003";
let dataDir;
let recomputeSeasonStints;

function lap(guid, n, ms, tyre, tsSec) {
  return { DriverGuid: guid, LapTime: ms, Tyre: tyre, Timestamp: tsSec, Sectors: [ms / 3, ms / 3, ms / 3], Cuts: 0 };
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "stints-"));
  process.env.DATA_DIR = dataDir;
  const t0 = 1788545000; // seconds, epoch — what AC stamps laps with
  const laps = [];
  for (let n = 1; n <= 6; n++) {
    laps.push(lap(GUID_A, n, 60000, "M", t0 + 60 * n));
    laps.push(lap(GUID_B, n, 61000, "M", t0 + 61 * n));
    laps.push(lap(GUID_C, n, 62000, "M", t0 + 62 * n));
  }
  const json = {
    Type: "RACE",
    Date: "2026-09-04T19:30:00Z",
    TrackName: "rt_autodrom_most",
    TrackConfig: "nabs_most_no_chicane",
    Laps: laps,
    Result: [
      { DriverGuid: GUID_A, DriverName: "A", NumLaps: 6, TotalTime: 360000, BestLap: 60000, GridPosition: 1 },
      { DriverGuid: GUID_B, DriverName: "B", NumLaps: 6, TotalTime: 366000, BestLap: 61000, GridPosition: 2 },
      { DriverGuid: GUID_C, DriverName: "C", NumLaps: 6, TotalTime: 372000, BestLap: 62000, GridPosition: 3 },
    ],
    Events: [],
    Cars: [],
  };
  mkdirSync(join(dataDir, "results-archive", "season8"), { recursive: true });
  writeFileSync(join(dataDir, "results-archive", "season8", "r04-most.json"), JSON.stringify(json));
  // The recorder's file for that evening: nobody stopped in the race, and A
  // drove back to the pit lane after the flag — a stop confirmed after A's
  // last crossing, on a lap the file does not have.
  const iso = (s) => new Date(s * 1000).toISOString();
  const uid = "u";
  const ev = [
    { v: 2, t: "session", uid, at: iso(t0), sessionKey: "k", track: json.TrackName, trackConfig: json.TrackConfig, raceLaps: 6 },
    { v: 2, t: "seed", uid, guid: GUID_A, name: "A", at: iso(t0 + 1), lap: 1, numPits: 0, tyre: "M" },
    { v: 2, t: "seed", uid, guid: GUID_B, name: "B", at: iso(t0 + 1), lap: 1, numPits: 0, tyre: "M" },
    { v: 2, t: "seed", uid, guid: GUID_C, name: "C", at: iso(t0 + 1), lap: 1, numPits: 0, tyre: "M" },
    { v: 2, t: "stop", uid, guid: GUID_A, at: iso(t0 + 60 * 6 + 30), numPits: 1, lap: 6, lapPrecise: false },
  ];
  mkdirSync(join(dataDir, "live-pits", "server"), { recursive: true });
  writeFileSync(
    join(dataDir, "live-pits", "server", "2026-09-04-nabsmostnochicane.jsonl"),
    ev.map((e) => JSON.stringify(e)).join("\n") + "\n"
  );
  ({ recomputeSeasonStints } = await import("./stintRecompute.js"));
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("recomputeSeasonStints", () => {
  it("matches a race on a mod layout the track table does not know, and uses its recording", async () => {
    const roster = [
      { id: "dA", steamId: GUID_A, name: "A" },
      { id: "dB", steamId: GUID_B, name: "B" },
      { id: "dC", steamId: GUID_C, name: "C" },
    ];
    const rows = [
      { id: "rA", driverId: "dA", stints: JSON.stringify([{ tyre: "M", laps: 5 }, { tyre: "M", laps: 1 }]) },
      { id: "rB", driverId: "dB", stints: JSON.stringify([{ tyre: "M", laps: 6 }]) },
      { id: "rC", driverId: "dC", stints: JSON.stringify([{ tyre: "M", laps: 6 }]) },
    ];
    const writes = [];
    const prisma = {
      season: { findFirst: async () => ({ id: "s8", number: 8 }) },
      driver: { findMany: async () => roster },
      race: { findMany: async () => [{ id: "r4", number: 4, track: "Most", date: new Date("2026-09-04T00:00:00Z") }] },
      $queryRawUnsafe: async () => rows,
      $executeRawUnsafe: async (_sql, stints, id) => writes.push({ id, stints }),
    };
    const out = await recomputeSeasonStints(prisma, 8);
    expect(out.racesMatched).toBe(1);
    expect(out.rowsChanged).toBe(1);
    expect(out.rowsSame).toBe(2);
    expect(writes).toEqual([{ id: "rA", stints: JSON.stringify([{ tyre: "M", laps: 6 }]) }]);
  });
});
