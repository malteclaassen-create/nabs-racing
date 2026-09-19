import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { trackKeyOf } from "./telemetryLaps.js";
import { parkLaps, listPending, pendingFor, take, discard, markNotified } from "./liveResetKeep.js";

// The waiting room for the times a server reset took off the board. What it has
// to get right: nothing reaches the board on its own, the question knows
// whether the track changed, and a second reset does not leave two questions
// about the same board.

const SERVER = "keepunit";
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

// Every test file shares one DATA_DIR (see vitest.config.js) and vitest runs
// them side by side, so this one owns its records by NAME rather than by
// emptying the folder: wiping the directory pulled the relay's own reset tests
// out from under them, which on Windows also means the odd EPERM as two
// workers touch the same path. Everything here is filed under a "keep…"
// server, and nothing else is looked at or thrown away.
const isMine = (p) => p.serverKey.startsWith("keep");
const mine = () => listPending().filter(isMine);
const mineFor = (series, season) => pendingFor(series, season).filter(isMine);

function wipe() {
  for (const p of mine()) discard(p.id);
}
beforeEach(wipe);
afterEach(wipe);

describe("liveResetKeep", () => {
  it("parks a session's laps and hands them back once", () => {
    expect(park()).toBeTruthy();

    const waiting = mine();
    expect(waiting.length).toBe(1);
    expect(waiting[0].laps.length).toBe(2);
    // Fastest first, exactly as the store files them.
    expect(waiting[0].laps[0].name).toBe("Bob");

    const got = take(waiting[0].id);
    expect(got.laps.length).toBe(2);
    // Answered is gone: the same reset must not be offered twice.
    expect(mine()).toEqual([]);
    expect(take(waiting[0].id)).toBe(null);
  });

  it("says the track changed when the layout name is a new one", () => {
    park({ after: side("nabs_baku", "nabs_baku") });
    expect(mine()[0].trackChanged).toBe(true);
  });

  it("a plain restart is not a track change", () => {
    park();
    expect(mine()[0].trackChanged).toBe(false);
  });

  it("a server that went off air claims no verdict", () => {
    // Nothing came back, so there is nothing to compare: "unchanged" would be
    // a guess and the card would quietly recommend keeping.
    park({ after: { track: "", layout: "", trackKey: "" } });
    expect(mine()[0].trackChanged).toBe(false);
    expect(mine()[0].after.track).toBe("");
  });

  it("a second reset replaces the first question for that board", () => {
    park({ endedAt: new Date(Date.now() - 60_000).toISOString() });
    park({ laps: [lap(A, 94_000, "Alice")] });
    const waiting = mine();
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
    expect(mine()).toEqual([]);
  });

  it("only answers to the series the times belong to", () => {
    park();
    expect(mineFor(SERIES, SEASON).length).toBe(1);
    expect(mineFor(SERIES, SEASON + 1)).toEqual([]);
    expect(mineFor("gt-sunday", SEASON)).toEqual([]);
  });

  it("keeps two race servers apart", () => {
    // The league runs a series per server (F1 on Friday, GT on Sunday), each
    // with its own live page. A reset on one board must not touch the other's
    // question, and answering one must leave the other waiting.
    park();
    parkLaps({
      serverKey: "keepunit2",
      scopes: [{ series: "gt-sunday", season: 3 }],
      before: side("nabs_spa", "nabs_spa_2026"),
      after: side("nabs_spa", "nabs_spa_2026"),
      laps: [lap(A, 104_000, "Alice")],
    });

    expect(mine().length).toBe(2);
    // Each card only ever sees its own.
    expect(mineFor(SERIES, SEASON).length).toBe(1);
    expect(mineFor("gt-sunday", 3).length).toBe(1);
    expect(mineFor(SERIES, SEASON)[0].before.track).toBe("nabs_baku");
    expect(mineFor("gt-sunday", 3)[0].before.track).toBe("nabs_spa");

    // Answering Friday's leaves Sunday's alone.
    take(mineFor(SERIES, SEASON)[0].id);
    expect(mineFor(SERIES, SEASON)).toEqual([]);
    expect(mineFor("gt-sunday", 3).length).toBe(1);
  });

  it("a second reset on ONE board replaces only that board's question", () => {
    parkLaps({
      serverKey: "keepunit2",
      scopes: [{ series: "gt-sunday", season: 3 }],
      before: side("nabs_spa", "nabs_spa_2026"),
      after: side("nabs_spa", "nabs_spa_2026"),
      laps: [lap(A, 104_000, "Alice")],
    });
    park({ endedAt: new Date(Date.now() - 60_000).toISOString() });
    park(); // Friday resets again before anybody answered
    expect(mineFor(SERIES, SEASON).length).toBe(1);
    expect(mineFor("gt-sunday", 3).length).toBe(1);
  });

  it("a board two series follow files for both of them", () => {
    // Nothing stops the Live tab pointing two series at one race server, and
    // the board reads the training laps of both. So the question carries both.
    parkLaps({
      serverKey: "keepshared",
      scopes: [{ series: SERIES, season: SEASON }, { series: "gt-sunday", season: 3 }],
      before: side("nabs_baku", "nabs_baku_2025"),
      after: side("nabs_baku", "nabs_baku_2025"),
      laps: [lap(A, 95_000, "Alice")],
    });
    expect(mineFor(SERIES, SEASON).length).toBe(1);
    expect(mineFor("gt-sunday", 3).length).toBe(1);
    // And it is ONE question, not two: the same id on both cards.
    expect(mineFor(SERIES, SEASON)[0].id).toBe(mineFor("gt-sunday", 3)[0].id);
  });

  it("a replacement inherits that the admins were already told", () => {
    // An admin swapping a track version restarts the server a few times over a
    // few minutes. The question keeps up with them; the bell does not ring
    // again for the same piece of work (services/liveTiming.js reads this).
    park();
    const first = mine()[0];
    expect(first.notifiedAt).toBe(null);
    markNotified(first.id);
    expect(mine()[0].notifiedAt).toBeTruthy();

    park({ laps: [lap(A, 94_000, "Alice")] }); // restarted again
    const second = mine()[0];
    expect(second.id).not.toBe(first.id); // a new question, the newer times
    expect(second.notifiedAt).toBeTruthy(); // but not a new announcement
  });

  it("a question answered and a new reset after it is worth telling again", () => {
    park();
    markNotified(mine()[0].id);
    take(mine()[0].id); // answered

    park();
    expect(mine()[0].notifiedAt).toBe(null);
  });

  it("forgets a question nobody answered for a fortnight", () => {
    park({ endedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() });
    expect(mine()).toEqual([]);
  });

  it("discarding leaves nothing behind", () => {
    park();
    const id = mine()[0].id;
    expect(discard(id)).toBe(true);
    expect(discard(id)).toBe(false);
    expect(mine()).toEqual([]);
  });
});
