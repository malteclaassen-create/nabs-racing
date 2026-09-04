// ---------------------------------------------------------------------------
// Pit events recorded LIVE, per race session, as append-only JSONL.
//
// Why this exists: the race server's stored result JSON carries no pit
// information of any kind (verified across the manager's entire API surface —
// the regex /pit/i finds zero matches in a full race file). Pit state lives
// ONLY on the live feed (IsInPits / NumPits per car) and only for the session
// in progress. So the one way the site can ever know a driver's stops for
// certain is to write them down while the race runs; services/pitRecorder.js
// does the observing, this module does the disk half, and the importer
// (acJsonParser) reads it back to turn heuristic stint guesses into fact.
//
// File identity is UTC-day + track key — deliberately the same late-binding
// identity scripts/recompute-stints.mjs uses to bind archive JSONs to stored
// races, because at record time neither the season nor the round number is
// knowable (the feed doesn't carry them, and the round may not even exist in
// the database yet on race night).
//
// Format: one JSON object per line.
//   {v:1, t:"session", uid, at, sessionKey, track, trackConfig, trackName, server}
//   {v:1, t:"entry",  uid, guid, name, at, lap, numPits}   pit lane entered
//   {v:1, t:"exit",   uid, guid, at, numPits, pitLaneMs}   pit lane left
//   {v:2, t:"tyre",   uid, guid, at, lap, tyre}          compound change seen
//   {v:1, t:"count",  uid, guid, name, at, lap, numPits}   counter rose with no
//                     observed edge (backend restart, feed gap) — the absolute
//                     counter makes these safe to reconcile after the fact.
// Append-only and write-through: a race is a few dozen lines, so there is no
// buffering to lose in a crash, and a torn final line costs one event that the
// absolute counter recovers anyway.
// ---------------------------------------------------------------------------
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { LIVE_PITS_DIR } from "./dataDirs.js";
import { trackKeyFor, normKey } from "./trackKeys.js";

// The track key a session records under. trackKeyFor resolves league circuits;
// normKey keeps unknown mod tracks groupable rather than dropping them.
export function pitTrackKey(trackConfig, track) {
  return trackKeyFor(trackConfig || track || "") || normKey(trackConfig || track || "") || "unknown";
}

export function pitFileFor(serverKey, dayIso, trackKey) {
  return join(LIVE_PITS_DIR, String(serverKey || "server"), `${dayIso}-${trackKey}.jsonl`);
}

export function appendPitEvent(filePath, obj) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, JSON.stringify(obj) + "\n");
  } catch (e) {
    // Recording must never take the relay down with it — a full disk on race
    // night degrades to "no recording", which is exactly yesterday's behaviour.
    console.error("[pits] append failed:", e.message);
  }
}

// Find the recorded file for a race identified the way the importer sees it:
// the result JSON's date and track. Checks the exact UTC day and its two
// neighbours (a race can cross midnight between session start and the file's
// stamp), across every server folder.
export function findPitFile({ dayIso, trackKey }) {
  if (!dayIso || !trackKey || !existsSync(LIVE_PITS_DIR)) return null;
  const day = new Date(dayIso + "T00:00:00Z");
  const days = [0, -1, 1].map((off) => new Date(day.getTime() + off * 86400000).toISOString().slice(0, 10));
  for (const server of readdirSync(LIVE_PITS_DIR)) {
    for (const d of days) {
      const p = join(LIVE_PITS_DIR, server, `${d}-${trackKey}.jsonl`);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// Read a recorded file back into per-driver stop lists.
//
// A file can hold several session GROUPS (one per recorder process that saw a
// race on this day+track), and within a group counters can misbehave in two
// distinct ways the reader must tell apart:
//
//   - ONE driver's counter regresses: they disconnected and rejoined, and the
//     server restarted their counter. Their earlier stops still happened in
//     this race — keep them, and lift the driver onto a new counting epoch so
//     later stops don't collide with earlier ones on the raw counter value.
//   - MANY drivers regress at once: the admin restarted the race in place
//     (same session key, no new group). Everything recorded before that
//     moment belongs to an aborted running — drop it, epochs included, which
//     matches the server's own result file describing only the final running.
//
// Across groups the seed counters decide: continuing counters mean the same
// race observed in chunks (backend restart — merge), regressed seeds mean a
// fresh running (replace). When several distinct race runnings share the file
// (a double-header), the caller passes the result JSON's timestamp and the
// chain whose session line is closest wins — "last group" alone would pin
// race two's stops onto race one's import.
const RESTART_REGRESS_MIN = 3; // simultaneous regressions that mean "race restarted"

export function loadPitStops(filePath, { aroundIso } = {}) {
  let lines;
  try {
    lines = readFileSync(filePath, "utf8").split("\n");
  } catch {
    return null;
  }
  const groups = []; // [{ uid, sessionKey, at, byGuid: Map }] in file order
  const groupByUid = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // torn tail line — expected, ignore
    }
    if (!ev?.uid) continue;
    let g = groupByUid.get(ev.uid);
    if (!g) {
      g = { uid: ev.uid, sessionKey: null, at: null, byGuid: new Map(), pendingRegress: [] };
      groupByUid.set(ev.uid, g);
      groups.push(g);
    }
    if (ev.t === "session") {
      g.sessionKey = ev.sessionKey || null;
      g.at = ev.at || null;
      continue;
    }
    if (ev.t === "flag") continue; // stops after it already carry postFlag
    if (!ev.guid) continue;
    // A pending regression burst is judged the moment something ELSE arrives —
    // BEFORE that something is processed. Judging after it once wiped the
    // first real stop of the restarted race along with the aborted running.
    if (ev.t !== "regress" && g.pendingRegress.length) g = resolveRegressBurst(g, groups, groupByUid);
    if (!g.byGuid.has(ev.guid)) {
      g.byGuid.set(ev.guid, { stops: [], tyres: [], seedPits: null, maxPits: 0, epoch: 0, name: ev.name || null });
    }
    const d = g.byGuid.get(ev.guid);
    const pits = Number(ev.numPits) || 0;
    if (ev.t === "tyre") {
      if (!ev.postFlag && ev.tyre) d.tyres.push({ lap: Number(ev.lap) || 1, tyre: ev.tyre });
    } else if (ev.t === "seed") {
      if (ev.tyre && !d.tyres.length) d.tyres.push({ lap: Number(ev.lap) || 1, tyre: ev.tyre });
      if (d.seedPits == null) {
        d.seedPits = pits;
      } else if (pits < d.maxPits) {
        // Re-seeded mid-group below their own high-water mark: a reconnect
        // with a per-connection counter. New epoch; earlier stops stand.
        d.epoch = d.maxPits;
      }
      d.maxPits = Math.max(d.maxPits, d.epoch + pits);
    } else if (ev.t === "stop") {
      const effective = d.epoch + pits;
      if (!d.stops.some((x) => x.effective === effective)) {
        d.stops.push({
          lap: Number(ev.lap) || null,
          lapPrecise: !!ev.lapPrecise,
          effective,
          postFlag: !!ev.postFlag,
          at: ev.at || null,
        });
      }
      d.maxPits = Math.max(d.maxPits, effective);
    } else if (ev.t === "regress") {
      // A whole-field restart shows as a burst of these. Collect; resolved
      // when the burst is complete (next non-regress event or end of group).
      g.pendingRegress.push({ guid: ev.guid, at: ev.at || null, to: Number(ev.to) || 0 });
    }
  }
  // A burst with nothing after it is a restart that never got going (or the
  // recorder went down as the grid re-formed): nothing was recorded of the
  // new running, so there is no running to open. Judged as a reconnect at
  // most, never as a restart that would leave an empty chain at the end of
  // the file for the caller to pick by default.
  for (const g of groups) {
    if (g.pendingRegress.length >= RESTART_REGRESS_MIN) g.pendingRegress = [];
    if (g.pendingRegress.length) resolveRegressBurst(g, groups, groupByUid);
  }
  if (!groups.length) return null;

  // Chain the groups: continuation merges into the chain, a fresh running
  // starts a new chain. Then pick the chain — by the caller's timestamp when
  // given, else the last one.
  const chains = [];
  let cur = null;
  for (const g of groups) {
    let continues = !!cur && (!cur.sessionKey || !g.sessionKey || cur.sessionKey === g.sessionKey);
    if (continues) {
      for (const [guid, d] of g.byGuid) {
        const prev = cur.byGuid.get(guid);
        if (prev && d.seedPits != null && d.seedPits < prev.maxPits) {
          continues = false; // counters restarted with the grid: fresh running
          break;
        }
      }
    }
    if (!continues) {
      cur = { sessionKey: g.sessionKey, at: g.at, byGuid: new Map() };
      chains.push(cur);
    }
    for (const [guid, d] of g.byGuid) {
      const prev = cur.byGuid.get(guid);
      if (!prev) {
        cur.byGuid.set(guid, d);
        continue;
      }
      // Same race, next chunk: this group's counters continue the chain's, so
      // its epoch base is the chain's high-water mark from BEFORE the chunk.
      const base = d.seedPits != null && d.seedPits >= prev.maxPits ? 0 : prev.maxPits;
      for (const s of d.stops) {
        const effective = base + s.effective;
        if (!prev.stops.some((x) => x.effective === effective)) prev.stops.push({ ...s, effective });
      }
      // Stops made while nobody was watching (between the chunks) surface as
      // the seed sitting above the chain's high-water mark: keep the count as
      // unplaced stops — the importer places them from lap evidence.
      const seedEff = d.seedPits != null ? base + d.seedPits : null;
      if (seedEff != null && seedEff > prev.maxPits) {
        for (let p = prev.maxPits + 1; p <= seedEff; p++) {
          if (!prev.stops.some((x) => x.effective === p)) prev.stops.push({ lap: null, effective: p, postFlag: false });
        }
      }
      for (const t of d.tyres) {
        if (!prev.tyres.some((x) => x.lap === t.lap && x.tyre === t.tyre)) prev.tyres.push(t);
      }
      prev.maxPits = Math.max(prev.maxPits, base + d.maxPits);
      if (d.name && !prev.name) prev.name = d.name;
    }
  }
  let pick = chains[chains.length - 1];
  if (aroundIso && chains.length > 1) {
    const want = Date.parse(aroundIso);
    if (Number.isFinite(want)) {
      let bestGap = Infinity;
      for (const c of chains) {
        const t = c.at ? Date.parse(c.at) : NaN;
        const gap = Number.isFinite(t) ? Math.abs(t - want) : Infinity;
        if (gap < bestGap) {
          bestGap = gap;
          pick = c;
        }
      }
    }
  }
  if (!pick?.byGuid.size) return null;

  // Shape the importer consumes: guid -> { stops: [placed race-stop laps],
  // totalPits: authoritative RACE visit count (post-flag returns excluded) }.
  // A driver with a seed and no events IS included — the recorder watched
  // them make zero stops, which is exactly the fact that silences the
  // heuristic.
  const out = new Map();
  for (const [guid, d] of pick.byGuid) {
    const raceStops = d.stops.filter((x) => !x.postFlag);
    out.set(guid, {
      stops: raceStops.filter((x) => x.lap != null).map((x) => x.lap).sort((a, b) => a - b),
      totalPits: raceStops.length,
      // Compound timeline: [{lap, tyre}] in observation order, so the importer
      // can name each stint from what the car was actually seen on rather than
      // from the result file's per-lap Tyre field, which a driver's own account
      // has shown to be wrong for a whole eighteen-lap stint.
      tyres: [...d.tyres].sort((a, b) => a.lap - b.lap),
      name: d.name,
    });
  }
  return out;
}

// A burst of counter regressions: three or more drivers at once is the admin
// restarting the race in place. The running so far is CLOSED, not wiped: it
// becomes a group of its own, and a fresh group timestamped at the restart
// takes over from here. The chain step below then sees the reset counters
// and starts a second chain, which the caller's session date picks between.
//
// It used to wipe. That was written for an aborted start (lap-one pile-up,
// grid re-formed), where the first running IS worthless — and it destroyed
// the first race of a double-header run back to back in one session: both
// twenty laps long, both with results to import, and the recording of the
// first one gone the moment the second was restarted in place. Most,
// 2026-08-28. Kept as a chain, an aborted start costs nothing: its result
// file never exists, so nothing ever asks for it.
//
// One or two regressions is a reconnect: keep history, bump their epoch so
// the restarted counter cannot collide with recorded stops.
//
// Returns the group the next event belongs to.
function resolveRegressBurst(g, groups, groupByUid) {
  const burst = g.pendingRegress;
  g.pendingRegress = [];
  if (burst.length >= RESTART_REGRESS_MIN) {
    const fresh = { uid: g.uid, sessionKey: g.sessionKey, at: burst[0].at || g.at, byGuid: new Map(), pendingRegress: [] };
    // Everyone the old running knew starts the new one at zero — the ones in
    // the burst at their reported counter (zero, in practice), the rest at
    // the zero they were already on (a counter only regresses from above
    // zero, so a driver missing from the burst had nothing to lose). Watched
    // from the restart on, so a driver who makes no stop in the new running
    // is recorded as exactly that, which is what silences the heuristic.
    const to = new Map(burst.map((r) => [r.guid, r.to]));
    for (const [guid, d] of g.byGuid) {
      const pits = to.get(guid) ?? 0;
      fresh.byGuid.set(guid, { stops: [], tyres: [], seedPits: pits, maxPits: pits, epoch: 0, name: d.name || null });
    }
    groups.push(fresh);
    groupByUid.set(g.uid, fresh);
    return fresh;
  }
  for (const r of burst) {
    const d = g.byGuid.get(r.guid);
    if (!d) continue;
    d.epoch = d.maxPits;
    d.maxPits = d.epoch + r.to;
  }
  return g;
}
