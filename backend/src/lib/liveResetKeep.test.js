import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { LIVE_RESET_KEEP_DIR } from "./dataDirs.js";
import { trackKeyOf } from "./telemetryLaps.js";
import { parkLaps, listPending, pendingFor, take, discard } from "./liveResetKeep.js";

// The waiting room for the times a server reset took off the board. What it has
// to get right: nothing reaches the board on its own, the question knows
// whether the track changed, and a second reset does not leave two questions
// about the same board.

const SERVER = "test";
const SERIES = "friday-f1";
const SEASON = 8;
const SCOPES = [{ series: SERIES, season: SEASON }];
const A = "76561198000000001";
const B = "76561198000000002";

const lap = (steamId, lapTimeMs, name) => ({
  steamId,
  name,
  car: "rss_f1",
  lapTimeMs,
  sectorsMs: [30_000, 32_000, lapTimeMs - 62_000],
  lapStamps: [1_700_000_000],
});

const side = (track, layout) => ({ track, layout, trackKey: trackKeyOf(track, layout) });

const park = (opts = {}) =>
  parkLaps({
    serverKey: SERVER,
    scopes: SCOPES,
    before: side("nabs_baku", "nabs_baku_2025"),
    after: side("nabs_baku", "nabs_baku_2025"),
    laps: [lap(A, 95_000, "Alice"), lap(B, 93_500, "Bob")],
    ...opts,
  });

function wipe() {
  rmSync(LIVE_RESET_KEEP_DIR, { recursive: true, force: true });
}
beforeEach(wipe);
afterEach(wipe);

describe("liveResetKeep", () => {
  it("parks a session's laps and hands them back once", () => {
    expect(park()).toBeTruthy();

    const waiting = listPending();
    expect(waiting.length).toBe(1);
    expect(waiting[0].laps.length).toBe(2);
    // Fastest first, exactly as the store files them.
    expect(waiting[0].laps[0].name).toBe("Bob");

    const got = take(waiting[0].id);
    expect(got.laps.length).toBe(2);
    // Answered is gone: the same reset must not be offered twice.
    expect(listPending()).toEqual([]);
    expect(take(waiting[0].id)).toBe(null);
  });

  it("says the track changed when the layout name is a new one", () => {
    park({ after: side("nabs_baku", "nabs_baku") });
    expect(listPending()[0].trackChanged).toBe(true);
  });

  it("a plain restart is not a track change", () => {
    park();
    expect(listPending()[0].trackChanged).toBe(false);
  });

  it("a server that went off air claims no verdict", () => {
    // Nothing came back, so there is nothing to compare: "unchanged" would be
    // a guess and the card would quietly recommend keeping.
    park({ after: { track: "", layout: "", trackKey: "" } });
    expect(listPending()[0].trackChanged).toBe(false);
    expect(listPending()[0].after.track).toBe("");
  });

  it("a second reset replaces the first question for that board", () => {
    park({ endedAt: new Date(Date.now() - 60_000).toISOString() });
    park({ laps: [lap(A, 94_000, "Alice")] });
    const waiting = listPending();
    expect(waiting.length).toBe(1);
    expect(waiting[0].laps.length).toBe(1); // the newer session's times
  });

  it("holds laps to the same bar a file's are held to", () => {
    const parked = park({
      laps: [
        lap(A, 95_000, "Alice"),
        { steamId: "not-a-steam-id", name: "Nobody", lapTimeMs: 90_000 },
        { steamId: B, name: "", lapTimeMs: 90_000 }, // no name, no row
        { steamId: B, name: "Bob", lapTimeMs: 12 }, // not a lap time
      ],
    });
    expect(parked.laps.length).toBe(1);
    expect(parked.laps[0].name).toBe("Alice");
  });

  it("parks nothing when there is nothing to ask about", () => {
    expect(park({ laps: [] })).toBe(null);
    // No series following this server: keeping them could not put them anywhere.
    expect(park({ scopes: [] })).toBe(null);
    expect(listPending()).toEqual([]);
  });

  it("only answers to the series the times belong to", () => {
    park();
    expect(pendingFor(SERIES, SEASON).length).toBe(1);
    expect(pendingFor(SERIES, SEASON + 1)).toEqual([]);
    expect(pendingFor("gt-sunday", SEASON)).toEqual([]);
  });

  it("keeps two race servers apart", () => {
    // The league runs a series per server (F1 on Friday, GT on Sunday), each
    // with its own live page. A reset on one board must not touch the other's
    // question, and answering one must leave the other waiting.
    park();
    parkLaps({
      serverKey: "test2",
      scopes: [{ series: "gt-sunday", season: 3 }],
      before: side("nabs_spa", "nabs_spa_2026"),
      after: side("nabs_spa", "nabs_spa_2026"),
      laps: [lap(A, 104_000, "Alice")],
    });

    expect(listPending().length).toBe(2);
    // Each card only ever sees its own.
    expect(pendingFor(SERIES, SEASON).length).toBe(1);
    expect(pendingFor("gt-sunday", 3).length).toBe(1);
    expect(pendingFor(SERIES, SEASON)[0].before.track).toBe("nabs_baku");
    expect(pendingFor("gt-sunday", 3)[0].before.track).toBe("nabs_spa");

    // Answering Friday's leaves Sunday's alone.
    take(pendingFor(SERIES, SEASON)[0].id);
    expect(pendingFor(SERIES, SEASON)).toEqual([]);
    expect(pendingFor("gt-sunday", 3).length).toBe(1);
  });

  it("a second reset on ONE board replaces only that board's question", () => {
    parkLaps({
      serverKey: "test2",
      scopes: [{ series: "gt-sunday", season: 3 }],
      before: side("nabs_spa", "nabs_spa_2026"),
      after: side("nabs_spa", "nabs_spa_2026"),
      laps: [lap(A, 104_000, "Alice")],
    });
    park({ endedAt: new Date(Date.now() - 60_000).toISOString() });
    park(); // Friday resets again before anybody answered
    expect(pendingFor(SERIES, SEASON).length).toBe(1);
    expect(pendingFor("gt-sunday", 3).length).toBe(1);
  });

  it("a board two series follow files for both of them", () => {
    // Nothing stops the Live tab pointing two series at one race server, and
    // the board reads the training laps of both. So the question carries both.
    parkLaps({
      serverKey: "shared",
      scopes: [{ series: SERIES, season: SEASON }, { series: "gt-sunday", season: 3 }],
      before: side("nabs_baku", "nabs_baku_2025"),
      after: side("nabs_baku", "nabs_baku_2025"),
      laps: [lap(A, 95_000, "Alice")],
    });
    expect(pendingFor(SERIES, SEASON).length).toBe(1);
    expect(pendingFor("gt-sunday", 3).length).toBe(1);
    // And it is ONE question, not two: the same id on both cards.
    expect(pendingFor(SERIES, SEASON)[0].id).toBe(pendingFor("gt-sunday", 3)[0].id);
  });

  it("forgets a question nobody answered for a fortnight", () => {
    park({ endedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() });
    expect(listPending()).toEqual([]);
  });

  it("discarding leaves nothing behind", () => {
    park();
    const id = listPending()[0].id;
    expect(discard(id)).toBe(true);
    expect(discard(id)).toBe(false);
    expect(listPending()).toEqual([]);
  });
});
