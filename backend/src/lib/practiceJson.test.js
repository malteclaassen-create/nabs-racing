import { describe, it, expect } from "vitest";
import { parsePracticeJson } from "./practiceJson.js";

// A session file read for its laps, not its classification. What matters:
// the fastest CLEAN lap per driver, its sectors only when they add up, and
// nobody on the board who cannot be matched to a Steam id.

const A = "76561198000000001";
const B = "76561198000000002";

const result = (guid, name, extra = {}) => ({ DriverGuid: guid, DriverName: name, CarModel: "rss_f1", BestLap: 0, ...extra });
const NAMES = { [A]: "Alice", [B]: "Bob" };
const lap = (guid, LapTime, Sectors, Cuts = 0, extra = {}) => ({
  DriverGuid: guid,
  DriverName: NAMES[guid] || "Someone",
  LapTime,
  Sectors,
  Cuts,
  CarModel: "rss_f1",
  ...extra,
});

const file = (over = {}) => ({
  Type: "PRACTICE",
  TrackName: "ks_monza",
  TrackConfig: "",
  Result: [result(A, "Alice"), result(B, "Bob")],
  Laps: [
    lap(A, 96_000, [30_000, 33_000, 33_000]),
    lap(A, 93_000, [29_000, 32_000, 32_000]),
    lap(B, 95_000, [30_000, 32_500, 32_500]),
  ],
  ...over,
});

describe("parsePracticeJson", () => {
  it("keeps the fastest clean lap per driver, with the server's sectors", () => {
    const p = parsePracticeJson(file());
    expect(p.type).toBe("PRACTICE");
    expect(p.trackKey).toBe("ks-monza");
    expect(p.laps.map((l) => [l.name, l.lapTimeMs])).toEqual([["Alice", 93_000], ["Bob", 95_000]]);
    expect(p.laps[0].sectorsMs).toEqual([29_000, 32_000, 32_000]);
  });

  it("a cut lap is not a lap time, however quick", () => {
    const p = parsePracticeJson(file({ Laps: [lap(A, 90_000, [28_000, 31_000, 31_000], 2), lap(A, 96_000, [30_000, 33_000, 33_000])] }));
    expect(p.laps[0].lapTimeMs).toBe(96_000);
  });

  it("sectors that do not add up to the lap are dropped, the time is kept", () => {
    const p = parsePracticeJson(file({ Laps: [lap(A, 93_000, [29_000, 32_000])] })); // a partial row
    expect(p.laps[0].lapTimeMs).toBe(93_000);
    expect(p.laps[0].sectorsMs).toBe(null);
    const q = parsePracticeJson(file({ Laps: [lap(A, 93_000, [29_000, 32_000, 40_000])] })); // wrong sum
    expect(q.laps[0].sectorsMs).toBe(null);
  });

  it("rounding each split can put the sum a couple of ms off, and that is still the lap", () => {
    const p = parsePracticeJson(file({ Laps: [lap(A, 93_000, [29_000.4, 32_000.4, 31_998.4])] }));
    expect(p.laps[0].sectorsMs).toEqual([29_000, 32_000, 31_998]);
  });

  it("an entrant with no clean lap rows has no time to show, whatever the classification says", () => {
    const p = parsePracticeJson(file({ Result: [result(A, "Alice", { BestLap: 94_500 })], Laps: [] }));
    expect(p.laps).toEqual([]);
  });

  it("a lap row without a Steam id is nobody the board can name, and is left out", () => {
    const p = parsePracticeJson(file({ Laps: [lap("", 90_000, [28_000, 31_000, 31_000]), lap(A, 93_000, [29_000, 32_000, 32_000])] }));
    expect(p.laps.map((l) => l.name)).toEqual(["Alice"]);
  });

  // The league's practice server has cars that several drivers use one after
  // another over an evening, and for those the server manager's Result[] row
  // is the CAR's: every name joined with commas, the car's best lap, one of the
  // drivers' Steam ids. The first cut read names and times from there and put
  // a driver on the board with somebody else's lap under a list of five names.
  it("a shared car is read driver by driver from the lap rows, never from the classification", () => {
    const C = "76561198000000003";
    const p = parsePracticeJson(
      file({
        Result: [
          // What the server manager writes for car 38 after three drivers used it.
          result(A, "Alice, Bob, Cara", { BestLap: 93_000, CarId: 38 }),
          result(B, "Alice, Bob, Cara", { BestLap: 93_000, CarId: 38 }),
          result(C, "Cara, Alice, Bob", { BestLap: 93_000, CarId: 38 }),
        ],
        Laps: [
          lap(A, 93_000, [29_000, 32_000, 32_000], 0, { DriverName: "Alice" }),
          lap(B, 96_000, [30_000, 33_000, 33_000], 0, { DriverName: "Bob" }),
          // Cara only ever cut: no clean lap, no time — not the car's 1:33.
          lap(C, 92_000, [28_500, 31_500, 32_000], 1, { DriverName: "Cara" }),
        ],
      })
    );
    expect(p.laps.map((l) => [l.name, l.lapTimeMs])).toEqual([["Alice", 93_000], ["Bob", 96_000]]);
    expect(p.entrants).toBe(3);
  });

  // What the live board shows beside the best lap, answered from the file so
  // a carried row reads like a live one.
  it("reads the rest of the row: best of each sector, laps, last lap, tyre", () => {
    const p = parsePracticeJson(
      file({
        Laps: [
          lap(A, 96_000, [30_000, 33_000, 33_000], 0, { Timestamp: 100, Tyre: "M" }),
          lap(A, 93_000, [29_000, 32_000, 32_000], 0, { Timestamp: 200, Tyre: "SS" }), // the best lap
          lap(A, 95_000, [28_500, 33_000, 33_500], 0, { Timestamp: 300, Tyre: "SS" }), // best S1 on a slower lap
          lap(A, 101_000, [40_000, 30_000, 31_000], 2, { Timestamp: 400, Tyre: "SS" }), // cut: counts as a lap, not as sectors
        ],
      })
    );
    const [a] = p.laps;
    expect(a.lapTimeMs).toBe(93_000);
    expect(a.sectorsMs).toEqual([29_000, 32_000, 32_000]);
    expect(a.tyre).toBe("SS"); // the best lap's tyre, not the first lap's
    expect(a.bestSectorsMs).toEqual([28_500, 32_000, 32_000]); // S1 from the 1:35, the cut lap's 30.0 not counted
    expect(a.lapCount).toBe(4); // every completed lap, cut or not, as the live board counts
    expect(a.lastLapMs).toBe(101_000); // the last one completed, whatever it was
  });

  it("the car is the one the lap was driven in, not the one the classification ended on", () => {
    const p = parsePracticeJson(file({ Laps: [lap(A, 93_000, [29_000, 32_000, 32_000], 0, { CarModel: "reserve_car" })] }));
    expect(p.laps[0].car).toBe("reserve_car");
  });

  it("a lap row whose name is itself a comma list is not a driver", () => {
    const p = parsePracticeJson(file({ Laps: [lap(A, 93_000, [29_000, 32_000, 32_000], 0, { DriverName: "Alice, Bob" })] }));
    expect(p.laps).toEqual([]);
  });

  it("the layout is part of the track key, as it is in the recorder's store", () => {
    expect(parsePracticeJson(file({ TrackConfig: "gp" })).trackKey).toBe("ks-monza--gp");
  });

  it("refuses what is not a session file, with a reason the admin can read", () => {
    expect(() => parsePracticeJson({ hello: 1 })).toThrow(/Result/);
    expect(() => parsePracticeJson({ Result: [] })).toThrow(/TrackName/);
    expect(() => parsePracticeJson(null)).toThrow();
  });
});
