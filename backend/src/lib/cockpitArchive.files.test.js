// Which of a round's archived files the readers use, and what the admin is
// shown about them. Two files can share a round number and kind (a re-import
// under another spelling of the circuit, from before the commit swept the old
// one); the newest is the round's result.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dataDir;
let findArchiveFor, archiveFilesFor, findArchiveForRace;

const A = "76561198000000001";
const B = "76561198000000002";

function file({ laps = 2, drivers = [A, B], track = "Baku", date = "2026-09-20T18:03:00Z" } = {}) {
  const Laps = [];
  for (const g of drivers) for (let i = 0; i < laps; i++) Laps.push({ DriverGuid: g, LapTime: 60000, Timestamp: 1 + i });
  return { Type: "RACE", TrackName: track, Date: date, Result: drivers.map((g) => ({ DriverGuid: g })), Laps };
}

const write = (dir, name, json, ageMs) => {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(json));
  const t = new Date(Date.now() - ageMs);
  utimesSync(p, t, t);
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cockpit-files-"));
  process.env.DATA_DIR = dataDir;
  ({ findArchiveFor, archiveFilesFor, findArchiveForRace } = await import("./cockpitArchive.js"));
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("a round with more than one file of a kind", () => {
  it("reads the newest one, not the one with the most laps", () => {
    const dir = join(dataDir, "results-archive", "season8");
    mkdirSync(dir, { recursive: true });
    // The stale file has more laps in it (a longer session under the old
    // name); the fresh import is the shorter race the admin just saved.
    write(dir, "r03-nabs-baku-2024.json", file({ laps: 30, track: "NABS Baku 2024" }), 60 * 60 * 1000);
    write(dir, "r03-baku.json", file({ laps: 12, track: "Baku" }), 1000);
    write(dir, "r03-baku-sprint.json", file({ laps: 8, track: "Baku" }), 500);

    expect(findArchiveFor(8, 3).TrackName).toBe("Baku");
    expect(findArchiveFor(8, 3).Laps.length).toBe(24);
    expect(findArchiveFor(8, 3, { sprint: true }).Laps.length).toBe(16);
  });

  it("lists every file with what it holds, and marks the one in use per kind", () => {
    const files = archiveFilesFor(8, 3);
    expect(files.map((f) => f.name)).toEqual(["r03-baku.json", "r03-nabs-baku-2024.json", "r03-baku-sprint.json"]);
    const by = Object.fromEntries(files.map((f) => [f.name, f]));
    expect(by["r03-baku.json"]).toMatchObject({ sprint: false, inUse: true, leaderLaps: 12, drivers: 2, track: "Baku" });
    expect(by["r03-nabs-baku-2024.json"]).toMatchObject({ sprint: false, inUse: false, leaderLaps: 30 });
    expect(by["r03-baku-sprint.json"]).toMatchObject({ sprint: true, inUse: true, leaderLaps: 8 });
  });

  it("answers an empty list for a round with nothing on file", () => {
    expect(archiveFilesFor(8, 4)).toEqual([]);
    expect(findArchiveFor(8, 4)).toBe(null);
  });
});

// A sprint weekend runs two races on one night and files two results under the
// one round number. A reader that starts from a RACE ROW has to be able to ask
// for either, or the sprint half of the weekend is invisible to it — which is
// what the race recap asks for when it tells the sprint beside the feature.
describe("a race row asking for its own file", () => {
  const round = { season: { id: "s8", number: 8 }, number: 3, date: "2026-09-20T18:00:00Z" };

  it("reads the feature race by default and the sprint when asked", () => {
    expect(findArchiveForRace(round).Laps.length).toBe(24);
    expect(findArchiveForRace(round, { sprint: true }).Laps.length).toBe(16);
  });

  it("still refuses a file from another night, sprint or not", () => {
    const wrongNight = { ...round, date: "2026-10-20T18:00:00Z" };
    expect(findArchiveForRace(wrongNight)).toBe(null);
    expect(findArchiveForRace(wrongNight, { sprint: true })).toBe(null);
  });
});
