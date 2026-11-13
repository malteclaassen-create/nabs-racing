// ---------------------------------------------------------------------------
// Every driver's fastest clean lap of the practice session on air, counted by
// the relay itself.
//
// The race server keeps ONE best lap per driver for the whole session, and
// between two race weekends that session runs for a week. When an admin takes
// a lap off the board (lib/liveLapBlocks.js) the server goes on reporting it,
// and it only lets go when the driver beats it. Usually that is soon. After
// the car was changed and got slower (F1 Friday, Mugello, 2026-11-13) it is
// never: the whole field deleted their old times, drove all afternoon, and the
// board showed a dash for everyone because nobody could beat a time from the
// faster car.
//
// So the relay counts laps on its own. Every snapshot carries the lap in
// progress split by split, with the number of cuts on each split, and the
// snapshot at the line still holds the three splits of the lap just finished.
// A lap counts when:
//   - the lap counter went up by exactly one since the last snapshot,
//   - three splits add up to the server's LastLap (to the millisecond, give or
//     take a rounding), from this snapshot or the one before the line,
//   - and none of the three has a cut.
// That is the same bar the server holds its own BestLap to. A lap we cannot
// check all three of those for is not counted: a missing time is better than
// a cut one on the board.
//
// What is kept is per session: a different session, or the same one started
// again, is a fresh list. On disk under DATA_DIR/live-clean-laps/<server>.json
// with the session it belongs to, so a restart of the backend picks the list
// up again if the server is still in that session.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { LIVE_CLEAN_LAPS_DIR } from "./dataDirs.js";

// Splits are rounded to the millisecond one by one, the lap as a whole; the
// sum can be a couple of milliseconds off the lap without being a wrong lap.
const SUM_SLACK_MS = 3;

// A session found on disk is the one on air when it started at the same time,
// give or take the clock drift of a session that ran for days.
const SAME_START_MS = 10 * 60 * 1000;

const nsToMs = (ns) => (typeof ns === "number" && ns > 0 ? Math.round(ns / 1e6) : null);

// The splits of the lap in progress, in sector order, as { ms, cuts }.
function splitsOf(raw) {
  const out = [null, null, null];
  if (!raw) return out;
  const records = Array.isArray(raw) ? raw : [0, 1, 2].map((i) => raw[i] ?? raw[String(i)]);
  records.forEach((sp, pos) => {
    if (!sp) return;
    const i = typeof sp.SplitIndex === "number" ? sp.SplitIndex : pos;
    const ms = nsToMs(sp.SplitTime);
    if (i >= 0 && i < 3 && ms) out[i] = { ms, cuts: Number(sp.Cuts) || 0 };
  });
  return out;
}

// Three splits that make up a lap of `lapMs`, or false.
function makesLap(splits, lapMs) {
  if (!splits || !splits.every(Boolean)) return false;
  const sum = splits[0].ms + splits[1].ms + splits[2].ms;
  return Math.abs(sum - lapMs) <= SUM_SLACK_MS;
}

function cleanBest(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lapTimeMs = Math.round(Number(raw.lapTimeMs));
  if (!Number.isFinite(lapTimeMs) || lapTimeMs <= 0) return null;
  const three = (a) =>
    Array.isArray(a) && a.length === 3 && a.every((ms) => Number.isFinite(Number(ms)) && Number(ms) > 0)
      ? a.map((ms) => Math.round(Number(ms)))
      : null;
  const sectorsMs = three(raw.sectorsMs);
  if (!sectorsMs) return null;
  return { lapTimeMs, sectorsMs, bestSectorsMs: three(raw.bestSectorsMs) || sectorsMs };
}

export function createCleanLapWatch(serverKey, { dir = LIVE_CLEAN_LAPS_DIR } = {}) {
  const file = join(dir, `${String(serverKey).replace(/[^a-z0-9_-]/gi, "_")}.json`);
  let sessionKey = null;
  let startedAt = null;
  // guid -> { laps, splits } : what the last snapshot said, to compare with
  const seen = new Map();
  // guid -> { lapTimeMs, sectorsMs, bestSectorsMs }
  const bests = new Map();

  function save() {
    try {
      if (!bests.size) {
        if (existsSync(file)) unlinkSync(file);
        return;
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({ v: 1, session: sessionKey, startedAt, bests: Object.fromEntries(bests) })
      );
    } catch (e) {
      // The board does not depend on it; the next improvement tries again.
      console.warn(`[live:${serverKey}] clean laps not saved: ${e?.message || e}`);
    }
  }

  function load(key, start) {
    if (start == null) return;
    try {
      if (!existsSync(file)) return;
      const raw = JSON.parse(readFileSync(file, "utf8"));
      if (raw?.session !== key) return;
      if (!(Math.abs(Number(raw.startedAt) - start) <= SAME_START_MS)) return;
      for (const [guid, b] of Object.entries(raw.bests || {})) {
        const ok = cleanBest(b);
        if (ok) bests.set(guid, ok);
      }
      startedAt = Number(raw.startedAt);
    } catch {
      /* a broken file is an empty list, not an outage */
    }
  }

  return {
    // The session on air, every snapshot. `start` is when it began (ms since
    // epoch) or null when the snapshot did not say. Nothing happens unless it
    // is a different session from the last one.
    session(key, start) {
      if (key === sessionKey) {
        if (startedAt == null && start != null) startedAt = start;
        return;
      }
      sessionKey = key;
      startedAt = start ?? null;
      seen.clear();
      bests.clear();
      if (key != null) load(key, start ?? null);
    },

    // One driver's car record from a snapshot of the session on air.
    note(guid, car) {
      if (sessionKey == null || !car) return;
      const laps = Number(car.NumLaps) || 0;
      const splits = splitsOf(car.CurrentLapSplits);
      const before = seen.get(guid);
      seen.set(guid, { laps, splits });
      // First sight: whatever lap they last finished, we did not watch it.
      if (!before || laps !== before.laps + 1) return;
      const lapMs = nsToMs(car.LastLap);
      if (!lapMs) return;
      const lap = makesLap(splits, lapMs) ? splits : makesLap(before.splits, lapMs) ? before.splits : null;
      if (!lap || lap.some((s) => s.cuts > 0)) return;

      const sectorsMs = lap.map((s) => s.ms);
      const had = bests.get(guid);
      const bestSectorsMs = had
        ? had.bestSectorsMs.map((ms, i) => Math.min(ms, sectorsMs[i]))
        : sectorsMs;
      const faster = !had || lapMs < had.lapTimeMs;
      const sectorsMoved = had && bestSectorsMs.some((ms, i) => ms !== had.bestSectorsMs[i]);
      if (!faster && !sectorsMoved) return;
      bests.set(
        guid,
        faster ? { lapTimeMs: lapMs, sectorsMs, bestSectorsMs } : { ...had, bestSectorsMs }
      );
      save();
    },

    // The fastest clean lap we saw this driver set in this session, or null.
    bestOf(guid) {
      return bests.get(guid) || null;
    },

    // The same session started again in place, or the relay being reset:
    // nothing from before counts any more.
    clear() {
      seen.clear();
      bests.clear();
      // A restart in place keeps the session's name, not its start; the next
      // snapshot says when this running of it began.
      startedAt = null;
      save();
    },
  };
}
