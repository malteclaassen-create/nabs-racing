import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// End to end across the three pieces the live pit recording is made of:
// pitRecorder (watches the feed) -> pitEventsStore (disk) -> telemetryExtractor
// (turns a result import into stints). Unit tests for the middle piece live in
// lib/pitEventsStore.test.js; what this file protects is the SEAM, where the
// two off-by-one traps sit — what a recorded lap number means, and what the
// recorded compound is allowed to override.
//
// The reference case is real: at Hockenheim, round 1 of season 8, a driver ran
// soft-medium-medium-hard over three stops and the server's own result file
// described it as one stop onto hards, wrong on both counts.

let dir;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "pitrec-"));
  vi.resetModules();
  vi.doMock("../lib/dataDirs.js", async () => {
    const real = await vi.importActual("../lib/dataDirs.js");
    return { ...real, LIVE_PITS_DIR: dir };
  });
});
afterEach(() => {
  vi.doUnmock("../lib/dataDirs.js");
  rmSync(dir, { recursive: true, force: true });
});

const G = "76561198000000001";
const SESSION_KEY = "vhe_hockenheim|2|Race";

// One ET200 snapshot. NumLaps is laps COMPLETED, which is how the feed reports
// it and how the Live page's "Laps" column reads.
const snapshot = ({ done, pits, tyre, laps = 46 }) => ({
  SessionInfo: { Type: 3, Track: "vhe_hockenheim", TrackConfig: "nabs_hockenheim", Name: "Race", Laps: laps },
  TrackInfo: { name: "Hockenheim" },
  ConnectedDrivers: {
    Drivers: {
      [G]: {
        CarInfo: { CarID: 7, DriverName: "Flo", CarModel: "f10", Tyres: tyre },
        NumPits: pits,
        IsInPits: false,
        TotalNumLaps: done,
        Cars: {},
      },
    },
  },
});

// Drive the whole race past the recorder, stopping at the end of each of
// `stopLaps` and taking on the matching compound.
async function record(plan, { laps = 46 } = {}) {
  const rec = await import("./pitRecorder.js");
  const { findPitFile, loadPitStops, pitTrackKey } = await import("../lib/pitEventsStore.js");
  let pits = 0;
  let tyre = plan.start;
  for (let done = 0; done <= laps; done++) {
    const change = plan.stops.find((s) => s.after === done);
    if (change) {
      pits += 1;
      tyre = change.tyre;
    }
    rec.onSnapshot("nabs1", snapshot({ done, pits, tyre, laps }), SESSION_KEY);
  }
  const file = findPitFile({
    dayIso: new Date().toISOString().slice(0, 10),
    trackKey: pitTrackKey("nabs_hockenheim", "vhe_hockenheim"),
  });
  return loadPitStops(file);
}

// A result file, optionally lying about the compound the way the real one does.
const resultJson = (tyreOfLap, laps = 46) => ({
  Type: "RACE",
  Cars: [{ CarId: 1, Driver: { Guid: G, Name: "Flo" } }],
  Result: [{ DriverGuid: G, DriverName: "Flo", GridPosition: 1, BestLap: 90000, NumLaps: laps, TotalTime: 1000 }],
  Laps: Array.from({ length: laps }, (_, i) => ({
    DriverGuid: G,
    DriverName: "Flo",
    CarId: 1,
    LapTime: 90000,
    Cuts: 0,
    Tyre: tyreOfLap(i + 1),
    Sectors: [30000, 30000, 30000],
    Timestamp: 1786000000 + i * 90,
  })),
  Events: [],
  Penalties: [],
});

const shape = (m) => m.stints.map((s) => `${s.tyre}:${s.laps}`).join(" ");

describe("live pit recording, end to end", () => {
  it("recovers stops AND compounds the result file gets wrong", async () => {
    // Flo's own account: soft to lap 6, then two sets of mediums, then hards.
    const stops = await record({
      start: "S",
      stops: [
        { after: 6, tyre: "Medium" },
        { after: 8, tyre: "Medium" },
        { after: 25, tyre: "Hard" },
      ],
    });
    expect(stops.get(G)).toMatchObject({ stops: [6, 8, 25], totalPits: 3 });

    const { extractTelemetry } = await import("./telemetryExtractor.js");
    // The file as the server wrote it: hards from lap 7 to the flag.
    const json = resultJson((n) => (n <= 6 ? "S" : "H"));
    expect(shape(extractTelemetry(json).byGuid.get(G))).toBe("S:6 H:40");
    expect(shape(extractTelemetry(json, { pitStopsByGuid: stops }).byGuid.get(G))).toBe("S:6 M:2 M:17 H:21");
  });

  it("keeps both of two stops made two laps apart", async () => {
    // The regression this exists for: the "already expressed by a compound
    // change" window used to reach two laps past the stop, so the first of a
    // close pair was skipped and its stint merged into the one before it.
    const stops = await record({
      start: "S",
      stops: [
        { after: 6, tyre: "Medium" },
        { after: 8, tyre: "Medium" },
      ],
    });
    const { extractTelemetry } = await import("./telemetryExtractor.js");
    const json = resultJson((n) => (n <= 6 ? "S" : "M"));
    const m = extractTelemetry(json, { pitStopsByGuid: stops }).byGuid.get(G);
    expect(m.stints.length).toBe(3);
    expect(shape(m)).toBe("S:6 M:2 M:38");
  });

  it("a race with no stop stays one stint even with a slow lap in it", async () => {
    const stops = await record({ start: "M", stops: [] });
    expect(stops.get(G)).toMatchObject({ stops: [], totalPits: 0 });
    const { extractTelemetry } = await import("./telemetryExtractor.js");
    const json = resultJson(() => "M");
    json.Laps[20].LapTime = 130000;
    json.Laps[20].Sectors = [30000, 70000, 30000];
    expect(shape(extractTelemetry(json, { pitStopsByGuid: stops }).byGuid.get(G))).toBe("M:46");
  });

  it("records nothing outside a race", async () => {
    const rec = await import("./pitRecorder.js");
    const { findPitFile, pitTrackKey } = await import("../lib/pitEventsStore.js");
    const practice = snapshot({ done: 3, pits: 2, tyre: "S" });
    practice.SessionInfo.Type = 1; // Practice: drivers park in the pits constantly
    rec.onSnapshot("nabs1", practice, "vhe_hockenheim|0|Practice");
    expect(
      findPitFile({
        dayIso: new Date().toISOString().slice(0, 10),
        trackKey: pitTrackKey("nabs_hockenheim", "vhe_hockenheim"),
      })
    ).toBe(null);
  });

  it("ignores a return to the pit lane after the flag", async () => {
    const stops = await record(
      { start: "M", stops: [{ after: 4, tyre: "Hard" }, { after: 11, tyre: "Soft" }] },
      { laps: 10 }
    );
    // Only the stop made while the race was running counts as a race stop.
    expect(stops.get(G)).toMatchObject({ stops: [4], totalPits: 1 });
  });
});
