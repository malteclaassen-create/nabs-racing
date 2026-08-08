import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendPitEvent, loadPitStops, pitTrackKey } from "./pitEventsStore.js";

// The live pit recording (services/pitRecorder.js writes, acJsonParser reads).
// The invariants here are the ones the import relies on — several of them were
// carved out by an adversarial review of the first version: reconnect epochs,
// in-place restart bursts, double-header chain picking, post-flag exclusion.

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pits-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const G = "76561198000000001";
const G2 = "76561198000000002";
const G3 = "76561198000000003";
const G4 = "76561198000000004";

const session = (f, uid, at = "2026-08-07T18:56:00Z") =>
  appendPitEvent(f, { v: 2, t: "session", uid, at, sessionKey: "hock|2|Race" });
const seed = (f, uid, guid, numPits = 0, lap = 1) =>
  appendPitEvent(f, { v: 2, t: "seed", uid, guid, lap, numPits });
const stop = (f, uid, guid, numPits, lap, extra = {}) =>
  appendPitEvent(f, { v: 2, t: "stop", uid, guid, numPits, lap, lapPrecise: true, ...extra });

describe("pitEventsStore", () => {
  it("round-trips stops into per-driver lap lists", () => {
    const f = join(dir, "a.jsonl");
    session(f, "s1");
    seed(f, "s1", G);
    stop(f, "s1", G, 1, 10);
    stop(f, "s1", G, 2, 28);
    expect(loadPitStops(f).get(G)).toMatchObject({ stops: [10, 28], totalPits: 2 });
  });

  it("a seeded driver with no stops reads as zero stops, not as unknown", () => {
    const f = join(dir, "a.jsonl");
    session(f, "s1");
    seed(f, "s1", G);
    const d = loadPitStops(f).get(G);
    expect(d).toBeTruthy();
    expect(d.stops).toEqual([]);
    expect(d.totalPits).toBe(0);
  });

  it("post-flag returns to the pit lane are not race stops", () => {
    const f = join(dir, "a.jsonl");
    session(f, "s1");
    seed(f, "s1", G);
    stop(f, "s1", G, 1, 10);
    appendPitEvent(f, { v: 2, t: "flag", uid: "s1", lap: 49 });
    stop(f, "s1", G, 2, 48, { postFlag: true });
    expect(loadPitStops(f).get(G)).toMatchObject({ stops: [10], totalPits: 1 });
  });

  it("a reconnect (single counter regression) keeps earlier stops and counts later ones", () => {
    const f = join(dir, "a.jsonl");
    session(f, "s1");
    seed(f, "s1", G);
    stop(f, "s1", G, 1, 5);
    // driver disconnects, rejoins: per-connection counter starts over
    seed(f, "s1", G, 0, 12);
    stop(f, "s1", G, 1, 15); // raw counter 1 again — must NOT collide with lap 5
    expect(loadPitStops(f).get(G)).toMatchObject({ stops: [5, 15], totalPits: 2 });
  });

  it("an in-place race restart (regression burst) wipes the aborted running", () => {
    const f = join(dir, "a.jsonl");
    session(f, "s1");
    for (const g of [G, G2, G3, G4]) seed(f, "s1", g);
    stop(f, "s1", G, 1, 2); // lap-1 pileup repairs
    stop(f, "s1", G2, 1, 2);
    for (const g of [G, G2, G3, G4]) appendPitEvent(f, { v: 2, t: "regress", uid: "s1", guid: g, from: g === G3 || g === G4 ? 0 : 1, to: 0 });
    stop(f, "s1", G, 1, 20); // the real race's only stop
    const d = loadPitStops(f);
    expect(d.get(G)).toMatchObject({ stops: [20], totalPits: 1 });
    expect(d.get(G2)).toMatchObject({ stops: [], totalPits: 0 });
  });

  it("a backend restart mid-race (counters continue): the chunks merge", () => {
    const f = join(dir, "a.jsonl");
    session(f, "s1");
    seed(f, "s1", G);
    stop(f, "s1", G, 1, 10);
    // new process, counters carry on; driver pitted AGAIN (unwatched) before the seed
    session(f, "s2");
    seed(f, "s2", G, 2, 25);
    stop(f, "s2", G, 3, 40);
    const d = loadPitStops(f).get(G);
    expect(d.stops).toEqual([10, 40]); // lap-known stops from both chunks
    expect(d.totalPits).toBe(3); // the unwatched stop keeps the count honest
  });

  it("a restarted race across groups (seeds regress): the last running wins", () => {
    const f = join(dir, "a.jsonl");
    session(f, "s1");
    seed(f, "s1", G);
    stop(f, "s1", G, 1, 3);
    session(f, "s2");
    seed(f, "s2", G, 0, 1); // grid reset: counter back at 0
    stop(f, "s2", G, 1, 12);
    expect(loadPitStops(f).get(G)).toMatchObject({ stops: [12], totalPits: 1 });
  });

  it("a double-header shares the file: the caller's timestamp picks the running", () => {
    const f = join(dir, "a.jsonl");
    session(f, "r1", "2026-08-07T18:00:00Z");
    seed(f, "r1", G);
    stop(f, "r1", G, 1, 8);
    session(f, "r2", "2026-08-07T21:00:00Z");
    seed(f, "r2", G, 0, 1); // fresh race, counters reset -> new chain
    stop(f, "r2", G, 1, 30);
    expect(loadPitStops(f, { aroundIso: "2026-08-07T18:05:00Z" }).get(G).stops).toEqual([8]);
    expect(loadPitStops(f, { aroundIso: "2026-08-07T21:02:00Z" }).get(G).stops).toEqual([30]);
    // no timestamp: last running, matching the server's own result file
    expect(loadPitStops(f).get(G).stops).toEqual([30]);
  });

  it("survives a torn final line", () => {
    const f = join(dir, "a.jsonl");
    session(f, "s1");
    seed(f, "s1", G);
    stop(f, "s1", G, 1, 10);
    writeFileSync(f, '{"v":2,"t":"stop","uid":"s1","gui', { flag: "a" }); // crash mid-write
    expect(loadPitStops(f).get(G).stops).toEqual([10]);
  });

  it("resolves league track configs and falls back to a normalised key", () => {
    expect(pitTrackKey("nabs_hockenheim", "vhe_hockenheim")).toBeTruthy();
    expect(pitTrackKey("", "some_unknown_mod_track")).toBeTruthy();
  });
});
