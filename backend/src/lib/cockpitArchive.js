// ---------------------------------------------------------------------------
// Lap-level race analysis for the private Cockpit, read straight from the raw
// AC result JSONs kept by lib/resultsArchive.js. The DB only stores distilled
// per-race numbers (telemetryRead.js); the archive still has every single lap
// with its three sector times, tyre and timestamp — so the Cockpit's charts
// (lap times, position per lap, pace comparison, theoretical best) are built
// on demand from the file, with a small in-memory cache, and the DB schema
// stays untouched.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, readdirSync, readFileSync } from "fs";
import { RESULTS_ARCHIVE_DIR } from "./resultsArchive.js";

// Laps beyond 30 minutes are import artefacts (pit-through outliers included
// by AC on session joins), same guard as driverProfileService.
const MAX_LAP_MS = 1_800_000;

// --- archive file lookup -----------------------------------------------------

// parsed-file cache: path -> { mtime-ish key, data }. The archive is
// write-once per round, so caching by path alone is safe; capped small.
const fileCache = new Map();
const FILE_CACHE_MAX = 12;

function readArchiveFile(path) {
  const hit = fileCache.get(path);
  if (hit) return hit;
  const data = JSON.parse(readFileSync(path, "utf8"));
  fileCache.set(path, data);
  if (fileCache.size > FILE_CACHE_MAX) {
    fileCache.delete(fileCache.keys().next().value); // drop the oldest entry
  }
  return data;
}

// Find the archived raw JSON for one round: season folder + rNN prefix. Two
// files can share a round number (a track rename re-archived under a new
// slug) — the one whose lap count is largest wins, as re-imports overwrite
// content but old names may linger.
export function findArchiveFor(seasonNumber, raceNumber) {
  const dir = join(RESULTS_ARCHIVE_DIR, `season${seasonNumber}`);
  if (!existsSync(dir)) return null;
  const prefix = `r${String(Number(raceNumber)).padStart(2, "0")}-`;
  const names = readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith(".json"));
  if (!names.length) return null;
  let best = null;
  for (const name of names) {
    try {
      const data = readArchiveFile(join(dir, name));
      const laps = Array.isArray(data?.Laps) ? data.Laps.length : 0;
      if (!best || laps > best.laps) best = { data, laps, name };
    } catch {
      /* unreadable file — try the next candidate */
    }
  }
  return best?.data ?? null;
}

// --- lap-level extraction ------------------------------------------------------

// All laps of the race grouped per driver GUID, in the order driven, with the
// cumulative race time each lap (the basis for position-per-lap).
function lapsByGuid(json) {
  const byGuid = new Map();
  for (const lap of json?.Laps || []) {
    if (!lap?.DriverGuid) continue;
    if (!byGuid.has(lap.DriverGuid)) byGuid.set(lap.DriverGuid, []);
    byGuid.get(lap.DriverGuid).push(lap);
  }
  for (const laps of byGuid.values()) {
    let cum = 0;
    laps.forEach((lap, i) => {
      cum += lap.LapTime || 0;
      lap._lapNo = i + 1;
      lap._cumMs = cum;
    });
  }
  return byGuid;
}

// Position of every driver at the end of every lap, from cumulative race
// times: at lap n, everyone who has completed n laps is ranked by their
// cumulative time; drivers already out keep no slot (they simply stop
// appearing — the classification below is what the results page shows).
function positionsPerLap(byGuid) {
  const maxLaps = Math.max(0, ...[...byGuid.values()].map((l) => l.length));
  const posByGuid = new Map([...byGuid.keys()].map((g) => [g, []]));
  for (let n = 1; n <= maxLaps; n++) {
    const finishers = [];
    for (const [guid, laps] of byGuid) {
      if (laps.length >= n) finishers.push({ guid, cum: laps[n - 1]._cumMs });
    }
    finishers.sort((a, b) => a.cum - b.cum);
    finishers.forEach((f, i) => posByGuid.get(f.guid).push({ lap: n, position: i + 1 }));
  }
  return posByGuid;
}

const isRealLap = (ms) => ms != null && ms > 0 && ms <= MAX_LAP_MS;

// Median of an array (empty -> null).
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Average pace over a driver's representative laps: the median of real laps
// (robust against pit stops, incidents and lap 1).
function racePace(laps) {
  return median(laps.map((l) => l.LapTime).filter(isRealLap));
}

// --- the full per-race analysis ------------------------------------------------

// Everything the Cockpit's race-analysis tab needs for ONE driver in ONE race.
// `guid` is the driver's SteamID64; `field` maps guid -> { name } labels for
// the comparison lines. Returns null when the driver has no laps in the file.
export function analyzeRaceFor(json, guid) {
  if (!json || !guid) return null;
  const byGuid = lapsByGuid(json);
  const own = byGuid.get(String(guid));
  if (!own || !own.length) return null;

  const posByGuid = positionsPerLap(byGuid);

  // Field baseline per lap (25th percentile of real laps) — the same idea the
  // pit detector uses: a lap far above the field's pace of THAT lap is a pit
  // stop or an incident, not slow driving.
  const maxLaps = Math.max(...[...byGuid.values()].map((l) => l.length));
  const fieldBaseline = [];
  for (let n = 1; n <= maxLaps; n++) {
    const times = [];
    for (const laps of byGuid.values()) {
      const lt = laps[n - 1]?.LapTime;
      if (isRealLap(lt)) times.push(lt);
    }
    times.sort((a, b) => a - b);
    fieldBaseline.push(times.length ? times[Math.floor(times.length * 0.25)] : null);
  }

  // Own laps, chart-ready. `slow` marks laps well above the field baseline
  // (pit stop / spin / traffic) so the chart can fade them out of the pace line.
  const ownBest = Math.min(...own.map((l) => l.LapTime).filter(isRealLap));
  const laps = own.map((lap, i) => ({
    lap: lap._lapNo,
    timeMs: isRealLap(lap.LapTime) ? lap.LapTime : null,
    sectors: Array.isArray(lap.Sectors) && lap.Sectors.length === 3 ? lap.Sectors : null,
    tyre: lap.Tyre || null,
    cuts: lap.Cuts || 0,
    position: posByGuid.get(String(guid))[i]?.position ?? null,
    slow: isRealLap(lap.LapTime) && fieldBaseline[i] != null && lap.LapTime > fieldBaseline[i] + 20_000,
  }));

  // Theoretical best: the three best sector times combined, vs the real best.
  const bestSectors = [0, 1, 2].map((s) => {
    const vals = own
      .filter((l) => isRealLap(l.LapTime) && Array.isArray(l.Sectors) && l.Sectors.length === 3)
      .map((l) => l.Sectors[s])
      .filter((v) => v > 0);
    return vals.length ? Math.min(...vals) : null;
  });
  const theoretical = bestSectors.every((v) => v != null) ? bestSectors.reduce((a, b) => a + b, 0) : null;

  // Pace comparison against the winner and the neighbours in the result. The
  // "Result" array is the final classification (winner first).
  const resultOrder = (json.Result || []).filter((r) => r?.DriverGuid && byGuid.has(r.DriverGuid));
  const ownIdx = resultOrder.findIndex((r) => r.DriverGuid === String(guid));
  const compareTo = [];
  const pushCmp = (r, label) => {
    if (!r || r.DriverGuid === String(guid)) return;
    const pace = racePace(byGuid.get(r.DriverGuid) || []);
    if (pace != null) compareTo.push({ label, name: r.DriverName || "?", paceMs: pace });
  };
  pushCmp(resultOrder[0], "winner");
  if (ownIdx > 0) pushCmp(resultOrder[ownIdx - 1], "ahead");
  if (ownIdx >= 0 && ownIdx < resultOrder.length - 1) pushCmp(resultOrder[ownIdx + 1], "behind");

  return {
    laps,
    lapCount: own.length,
    bestLapMs: Number.isFinite(ownBest) ? ownBest : null,
    ownPaceMs: racePace(own),
    bestSectors,
    theoreticalMs: theoretical,
    compareTo,
  };
}

// --- career insights per race ---------------------------------------------------
// The condensed truths one race file holds about one driver — the building
// blocks of the Cockpit's Insights page (aggregated across races in
// cockpitService.getCockpitInsights). All of this is invisible on the public
// site: it only exists in the raw lap data.

// Median of a driver's CLEAN laps: within 8% of their own median real lap.
function cleanPace(laps) {
  const real = laps.map((l) => l.LapTime).filter(isRealLap);
  const med = median(real);
  if (med == null) return null;
  const clean = real.filter((t) => t <= med * 1.08);
  return median(clean);
}

export function raceInsightsFor(json, guid) {
  if (!json || !guid) return null;
  const byGuid = lapsByGuid(json);
  const own = byGuid.get(String(guid));
  if (!own || own.length < 5) return null;

  // True pace rank: everyone who ran at least 60% of the winner's laps is
  // ranked by their clean median lap. Finishing position rewards survival;
  // this number is raw speed.
  const maxLaps = Math.max(...[...byGuid.values()].map((l) => l.length));
  const paces = [];
  for (const [g, laps] of byGuid) {
    if (laps.length < maxLaps * 0.6) continue;
    const p = cleanPace(laps);
    if (p != null) paces.push({ guid: g, pace: p });
  }
  paces.sort((a, b) => a.pace - b.pace);
  const paceIdx = paces.findIndex((p) => p.guid === String(guid));
  const ownPace = paceIdx >= 0 ? paces[paceIdx].pace : cleanPace(own);

  // Position at the end of lap 1 (the start, in one number).
  const posByGuid = positionsPerLap(byGuid);
  const lap1Pos = posByGuid.get(String(guid))?.[0]?.position ?? null;

  // Tyre-stint degradation: segment the own laps on compound changes, then a
  // least-squares slope over the stint's clean laps (ms per lap). Positive =
  // the tyre fell away; needs 5+ clean laps to mean anything.
  const stints = [];
  let seg = [];
  const flush = () => {
    if (seg.length >= 5) {
      const med = median(seg.map((l) => l.LapTime).filter(isRealLap));
      const pts = seg
        .map((l, i) => ({ i, t: l.LapTime }))
        .filter((p) => isRealLap(p.t) && med != null && p.t <= med * 1.08);
      if (pts.length >= 5) {
        const n = pts.length;
        const mx = pts.reduce((s, p) => s + p.i, 0) / n;
        const my = pts.reduce((s, p) => s + p.t, 0) / n;
        const num = pts.reduce((s, p) => s + (p.i - mx) * (p.t - my), 0);
        const den = pts.reduce((s, p) => s + (p.i - mx) ** 2, 0);
        if (den > 0) stints.push({ tyre: seg[0].Tyre || "?", laps: seg.length, degMsPerLap: num / den });
      }
    }
    seg = [];
  };
  for (const lap of own) {
    if (seg.length && (lap.Tyre || "?") !== (seg[0].Tyre || "?")) flush();
    seg.push(lap);
  }
  flush();

  // Time spent clearly off your own pace: only laps 8%+ beyond your clean
  // median count (pit stops, spins, safety car), and each contributes what it
  // cost beyond a normal lap. Ordinary lap-to-lap scatter stays out.
  const offPaceMs = ownPace != null
    ? own.reduce(
        (s, l) => (isRealLap(l.LapTime) && l.LapTime > ownPace * 1.08 ? s + (l.LapTime - ownPace) : s),
        0
      )
    : null;

  return {
    paceRank: paceIdx >= 0 ? paceIdx + 1 : null,
    paceField: paces.length,
    ownPaceMs: ownPace,
    gapToBestPaceMs: paces.length && ownPace != null ? ownPace - paces[0].pace : null,
    lap1Pos,
    stints,
    offPaceMs,
    laps: own.length,
  };
}
