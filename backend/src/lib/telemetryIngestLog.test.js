// What the ingest diagnostic has to get right.
//
// The tests that matter are about the DISTINCTION the card is built on — a lap
// that arrived and was too slow to keep is the recorder working, and counting
// it as a failure is precisely the mistake that sent the league hunting a
// server problem that did not exist. The rest is bookkeeping.
import { describe, it, expect, beforeEach } from "vitest";
import { recordTelemetryEvent, readTelemetryActivity, resetTelemetryActivity, OUTCOMES } from "./telemetryIngestLog.js";

beforeEach(() => resetTelemetryActivity());

describe("counting", () => {
  it("counts a lap that was too slow to keep as a lap that arrived", () => {
    recordTelemetryEvent("lap-kept", { name: "Rashford", lapTimeMs: 62279 });
    recordTelemetryEvent("lap-slower", { name: "m.timms", lapTimeMs: 62408 });
    const a = readTelemetryActivity();
    expect(a.lapsArrived).toBe(2);
    expect(a.outcomes["lap-kept"].count).toBe(1);
    expect(a.outcomes["lap-slower"].count).toBe(1);
  });

  it("keeps script downloads apart from laps — the whole point of the panel", () => {
    recordTelemetryEvent("script-served");
    recordTelemetryEvent("script-served");
    const a = readTelemetryActivity();
    expect(a.scriptsServed).toBe(2);
    expect(a.lapsArrived).toBe(0);
  });

  it("starts at zero for every outcome, so an untouched panel reads 'nothing yet'", () => {
    const a = readTelemetryActivity();
    for (const key of Object.keys(OUTCOMES)) expect(a.outcomes[key].count).toBe(0);
    expect(a.outcomes["script-served"].lastAt).toBe(null);
  });
});

describe("the event list", () => {
  it("hands back the newest first and carries the refusal reason", () => {
    recordTelemetryEvent("bad-key");
    recordTelemetryEvent("lap-refused", { detail: "Implausible lap time" });
    const [first, second] = readTelemetryActivity().events;
    expect(first.outcome).toBe("lap-refused");
    expect(first.detail).toBe("Implausible lap time");
    expect(second.outcome).toBe("bad-key");
  });

  it("forgets the middle rather than growing without a bound", () => {
    for (let i = 0; i < 120; i++) recordTelemetryEvent("ping");
    const a = readTelemetryActivity();
    expect(a.events.length).toBeLessThanOrEqual(40);
    // The counter still knows about all of them.
    expect(a.outcomes.ping.count).toBe(120);
  });

  it("stores nothing identifying — no Steam id, no key, whatever is passed", () => {
    recordTelemetryEvent("lap-kept", { name: "Rashford", track: "fr_redbullring", steamId: "76561198000000000", key: "f55b" });
    const [e] = readTelemetryActivity().events;
    expect(JSON.stringify(e)).not.toContain("76561198000000000");
    expect(JSON.stringify(e)).not.toContain("f55b");
    expect(e.name).toBe("Rashford");
  });
});

describe("robustness", () => {
  it("ignores an outcome it does not know rather than inventing a row", () => {
    recordTelemetryEvent("something-else");
    expect(readTelemetryActivity().events).toHaveLength(0);
  });

  it("never throws on a bad payload — a diagnostic must not cost a lap", () => {
    expect(() => recordTelemetryEvent("lap-kept", null)).not.toThrow();
    expect(() => recordTelemetryEvent("lap-kept", { lapTimeMs: "not a number" })).not.toThrow();
    expect(readTelemetryActivity().events[0].lapTimeMs).toBe(null);
  });
});

// Two leagues, two keys, two admin cards. Each card is about its own league's
// evening; what arrived with no usable key belongs to nobody and shows on both.
describe("one league's card", () => {
  beforeEach(() => {
    recordTelemetryEvent("lap-kept", { series: "friday-f1", name: "Rashford", lapTimeMs: 62279 });
    recordTelemetryEvent("lap-slower", { series: "friday-f1", name: "m.timms", lapTimeMs: 62408 });
    recordTelemetryEvent("script-served", { series: "sunday-gt" });
    recordTelemetryEvent("lap-kept", { series: "sunday-gt", name: "Neesh", lapTimeMs: 125000 });
    recordTelemetryEvent("bad-key");
  });

  it("adds up its own league's events and the ones that named no league", () => {
    const f1 = readTelemetryActivity("friday-f1");
    expect(f1.series).toBe("friday-f1");
    expect(f1.lapsArrived).toBe(2);
    expect(f1.scriptsServed).toBe(0);
    expect(f1.outcomes["bad-key"].count).toBe(1);
    expect(f1.events.map((e) => [e.outcome, e.series])).toEqual([
      ["bad-key", null],
      ["lap-slower", "friday-f1"],
      ["lap-kept", "friday-f1"],
    ]);
  });

  it("shows the other league nothing of it", () => {
    const gt = readTelemetryActivity("sunday-gt");
    expect(gt.lapsArrived).toBe(1);
    expect(gt.scriptsServed).toBe(1);
    expect(gt.events.map((e) => e.name)).toEqual([null, "Neesh", null]);
    expect(gt.outcomes["lap-slower"].count).toBe(0);
  });

  it("keeps the newest stamp per league apart", () => {
    const all = readTelemetryActivity();
    expect(all.lapsArrived).toBe(3);
    expect(all.outcomes["lap-kept"].lastAt).toBe(readTelemetryActivity("sunday-gt").outcomes["lap-kept"].lastAt);
    expect(readTelemetryActivity("friday-f1").outcomes["lap-kept"].lastAt).not.toBeNull();
  });
});
