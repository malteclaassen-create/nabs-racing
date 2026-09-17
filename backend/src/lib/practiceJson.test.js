import { describe, it, expect } from "vitest";
import { parsePracticeJson } from "./practiceJson.js";

// A session file read for its laps, not its classification. What matters:
// the fastest CLEAN lap per driver, its sectors only when they add up, and
// nobody on the board who cannot be matched to a Steam id.

const A = "76561198000000001";
const B = "76561198000000002";

const result = (guid, name, extra = {}) => ({ DriverGuid: guid, DriverName: name, CarModel: "rss_f1", BestLap: 0, ...extra });
const lap = (guid, LapTime, Sectors, Cuts = 0, extra = {}) => ({ DriverGuid: guid, LapTime, Sectors, Cuts, CarModel: "rss_f1", ...extra });

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

  it("falls back to the classification's BestLap for an entrant with no lap rows", () => {
    const p = parsePracticeJson(file({ Result: [result(A, "Alice", { BestLap: 94_500 })], Laps: [] }));
    expect(p.laps).toEqual([expect.objectContaining({ name: "Alice", lapTimeMs: 94_500, sectorsMs: null })]);
  });

  it("an entrant without a Steam id is nobody the board can name, and is left out", () => {
    const p = parsePracticeJson(file({ Result: [result("", "Ghost"), result(A, "Alice")] }));
    expect(p.laps.map((l) => l.name)).toEqual(["Alice"]);
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
