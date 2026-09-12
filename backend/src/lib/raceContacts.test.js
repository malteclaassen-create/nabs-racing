// The round reader is asked about a round long before that round's result file
// exists: in-game reports land during the race and the stewards open the list
// straight away. The answer "no file" must not outlive the import.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const A = "76561198000000001";
const B = "76561198000000002";
let dataDir;
let contactsForRound, contactsForDriver, sessionStartForRound, forgetRound;

const T0 = 1788545000; // unix seconds, the scale AC stamps laps and events with
const WAIT = 60;

function file({ events = true } = {}) {
  return {
    Type: "RACE",
    SessionConfig: { wait_time: WAIT },
    Result: [
      { DriverGuid: A, DriverName: "Alpha", NumLaps: 2, TotalTime: 120000 },
      { DriverGuid: B, DriverName: "Bravo", NumLaps: 2, TotalTime: 121000 },
    ],
    Laps: [
      { DriverGuid: A, DriverName: "Alpha", LapTime: 60000, Timestamp: T0 + WAIT + 60, Cuts: 0 },
      { DriverGuid: B, DriverName: "Bravo", LapTime: 61000, Timestamp: T0 + WAIT + 61, Cuts: 0 },
      { DriverGuid: A, DriverName: "Alpha", LapTime: 60000, Timestamp: T0 + WAIT + 120, Cuts: 0 },
      { DriverGuid: B, DriverName: "Bravo", LapTime: 60000, Timestamp: T0 + WAIT + 121, Cuts: 0 },
    ],
    Events: events
      ? [
          {
            Type: "COLLISION_WITH_CAR",
            Driver: { Guid: A, Name: "Alpha" },
            OtherDriver: { Guid: B, Name: "Bravo" },
            ImpactSpeed: 42,
            Timestamp: T0 + WAIT + 90,
            AfterSessionEnd: false,
          },
        ]
      : [],
  };
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "contacts-"));
  process.env.DATA_DIR = dataDir;
  mkdirSync(join(dataDir, "results-archive", "season8"), { recursive: true });
  ({ contactsForRound, contactsForDriver, sessionStartForRound, forgetRound } = await import("./raceContacts.js"));
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("contactsForRound", () => {
  it("does not remember 'no file' once the round has been imported", () => {
    // The reports list is opened during the race: nothing on disk yet.
    expect(contactsForRound(8, 5).archived).toBe(false);
    expect(sessionStartForRound(8, 5)).toBeNull();
    expect(contactsForDriver(8, 5, A)).toEqual([]);

    // The admin imports the round after the flag. No restart in between.
    writeFileSync(join(dataDir, "results-archive", "season8", "r05-spa.json"), JSON.stringify(file()));

    const round = contactsForRound(8, 5);
    expect(round.archived).toBe(true);
    expect(sessionStartForRound(8, 5)).toBe(T0);
    const mine = contactsForDriver(8, 5, A);
    expect(mine).toHaveLength(1);
    expect(mine[0].other.guid).toBe(B);
    expect(mine[0].second).toBe(WAIT + 90);
  });

  it("serves the cached round until forgetRound() drops it after a re-import", () => {
    const path = join(dataDir, "results-archive", "season8", "r05-spa.json");
    writeFileSync(path, JSON.stringify(file({ events: false })));
    // Still the cached shape from the previous read: one contact.
    expect(contactsForDriver(8, 5, A)).toHaveLength(1);
    forgetRound(8, 5);
    expect(contactsForDriver(8, 5, A)).toEqual([]);
  });
});
