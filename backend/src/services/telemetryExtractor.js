// ---------------------------------------------------------------------------
// Distils per-driver telemetry out of an Assetto Corsa "RACE" result JSON:
// car-to-car contacts, wall/off hits, track cuts, an estimated on-track overtake
// count, lap-consistency, and in-game penalties. Everything is keyed by the
// driver's Steam GUID (stable identity). This module is deliberately dependency
// free so acJsonParser.js can import it without a circular reference.
//
// The overtake count is a HEURISTIC (lap-granularity position tracking), not a
// telemetry-accurate figure. See computeOvertakes for the exact rules and
// limitations; the UI surfaces it as "on-track passes (estimated)".
// ---------------------------------------------------------------------------

// Contact tuning (shared by the live import and the backfill). Light taps below
// the impact threshold (km/h) are ignored; AC logs sustained scraping as many
// rapid events, so repeated hits between the same pair within mergeWindowMs
// collapse into one incident.
export const CONTACT_DEFAULTS = { impactThreshold: 10, mergeWindowMs: 3000 };
export const ENV_CONTACT_DEFAULTS = { impactThreshold: 15, mergeWindowMs: 3000 };

// Known safety-car driver names (fallback when the skin doesn't say "safety").
const DEFAULT_SC_NAMES = ["Tyler27", "Janelko", "Samuel Foniok"];

const CLEAN_LAP_WINDOW_MS = 10000; // a lap counts as "clean" within 10s of own best
const CONSISTENCY_OUTLIER_MS = 21000; // simresults drops laps over best+21s from consistency
const PIT_LAP_EXTRA_MS = 25000; // a lap this much over the driver's median = a pit lap
const SC_LAP_FACTOR = 1.3; // a lap whose field median is 1.3x the race median = SC lap

// AC stamps event/lap times in Unix SECONDS; normalise to ms (values already in
// ms are left as-is).
function tsToMs(t) {
  if (!Number.isFinite(t)) return null;
  return t < 1e11 ? t * 1000 : t;
}

function medianOf(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// Population standard deviation.
function stdev(nums) {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
  const varr = nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length;
  return Math.sqrt(varr);
}

// Count collision INCIDENTS per reporting driver GUID for a given event `type`.
// Merges repeated hits between the same pair within mergeWindowMs, drops light
// taps and events flagged AfterSessionEnd (post-flag crashes must not count),
// and skips excluded guids (e.g. the safety car). Returns Map<guid, count>.
export function countIncidents(events, opts = {}) {
  const { type, impactThreshold, mergeWindowMs, excludeGuids } = {
    type: "COLLISION_WITH_CAR",
    ...CONTACT_DEFAULTS,
    excludeGuids: null,
    ...opts,
  };
  const excluded = excludeGuids || new Set();
  const hits = (events || [])
    .filter(
      (e) =>
        e &&
        e.Type === type &&
        !e.AfterSessionEnd &&
        (e.ImpactSpeed || 0) >= impactThreshold &&
        e.Driver &&
        e.Driver.Guid != null &&
        !excluded.has(e.Driver.Guid)
    )
    .map((e) => ({
      guid: e.Driver.Guid,
      // Env collisions have no other car; bucket them per driver.
      other: e.OtherCarId != null && e.OtherCarId >= 0 ? e.OtherCarId : "env",
      t: tsToMs(e.Timestamp),
    }))
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

  const lastByPair = new Map();
  const counts = new Map();
  for (const c of hits) {
    const key = `${c.guid}|${c.other}`;
    const last = lastByPair.get(key);
    const fresh = c.t == null || last == null || c.t - last > mergeWindowMs;
    if (fresh) counts.set(c.guid, (counts.get(c.guid) || 0) + 1);
    lastByPair.set(key, c.t ?? last ?? 0);
  }
  return counts;
}

// Back-compat wrapper: car-to-car contact incidents per guid.
export function countCarContacts(events, opts = {}) {
  return countIncidents(events, { type: "COLLISION_WITH_CAR", ...CONTACT_DEFAULTS, ...opts });
}

// Estimated on-track overtakes AND laps-led per driver, from lap-by-lap position
// tracking. Returns { overtakes: Map<guid,count>, lapsLed: Map<guid,count> }.
//
// Position after lap n = rank (by S/F-line crossing time, cumulative race time
// as tiebreak) among drivers who have completed >= n laps. Lap 0 = the grid.
// A pass is counted for driver D on lap n when an opponent O who was AHEAD of D
// at n-1 is BEHIND at n, provided O also completed lap n (so a retirement is not
// a "gain"), O did not pit on lap n, and lap n is not a safety-car lap.
//
// Laps led: for each lap n = 1..maxLap, the car ranked 0 (first across the S/F
// line completing that lap) led that lap. Lap 0 (the grid) does NOT count, so a
// pole sitter earns nothing before turn 1; safety-car laps DO count (the car out
// front is still leading, standard motorsport convention). Determined at the
// start/finish line once per lap by crossing time, so it inherits the same
// limitations as the overtake heuristic (pit-cycle laps, SC phases and lapped
// cars can distort it). Indicative, not FIA-exact — fine for a league stat.
//
// Overtake limitations (documented on purpose): granularity is one lap, so
// mid-lap swap-backs net out; lap-1 changes are counted from the grid (a good
// start reads as overtakes); pit under/over-cuts and SC-restart shuffles can
// leak through. It is indicative, not exact.
function computeOvertakes(lapsByGuid, results, scGuids) {
  const out = new Map();
  const lapsLed = new Map();
  const guids = [...lapsByGuid.keys()].filter((g) => !scGuids.has(g));
  if (guids.length < 2) return { overtakes: out, lapsLed };

  const info = new Map();
  for (const g of guids) {
    const arr = lapsByGuid.get(g);
    const times = arr.map((l) => Number(l.LapTime) || 0);
    const median = medianOf(times.filter((t) => t > 0));
    let cum = 0;
    const laps = arr.map((l) => {
      const lt = Number(l.LapTime) || 0;
      cum += lt;
      return { lapTime: lt, cumMs: cum, ts: tsToMs(l.Timestamp), isPit: median > 0 && lt > median + PIT_LAP_EXTRA_MS };
    });
    info.set(g, { laps });
  }

  const maxLap = Math.max(...guids.map((g) => info.get(g).laps.length));
  if (maxLap < 1) return { overtakes: out, lapsLed };

  const allLapTimes = [];
  for (const g of guids) for (const l of info.get(g).laps) if (l.lapTime > 0) allLapTimes.push(l.lapTime);
  const globalMedian = medianOf(allLapTimes);

  // Grid ranking (lap 0). Prefer Result.GridPosition; fall back to first-lap order.
  const gridByGuid = new Map();
  for (const r of results || []) {
    if (r.DriverGuid && Number(r.GridPosition) > 0) gridByGuid.set(r.DriverGuid, Number(r.GridPosition));
  }
  const grid = [...guids].sort((a, b) => {
    const ga = gridByGuid.get(a) ?? 999;
    const gb = gridByGuid.get(b) ?? 999;
    if (ga !== gb) return ga - gb;
    const ta = info.get(a).laps[0]?.ts ?? Infinity;
    const tb = info.get(b).laps[0]?.ts ?? Infinity;
    return ta - tb;
  });

  const rankAt = [new Map(grid.map((g, i) => [g, i]))];
  const scLap = [false];
  for (let n = 1; n <= maxLap; n++) {
    const runners = guids.filter((g) => info.get(g).laps.length >= n);
    runners.sort((a, b) => {
      const la = info.get(a).laps[n - 1];
      const lb = info.get(b).laps[n - 1];
      const ta = la.ts ?? Infinity;
      const tb = lb.ts ?? Infinity;
      if (ta !== tb) return ta - tb;
      return la.cumMs - lb.cumMs;
    });
    rankAt[n] = new Map(runners.map((g, i) => [g, i]));
    const lapTimes = runners.map((g) => info.get(g).laps[n - 1].lapTime).filter((t) => t > 0);
    scLap[n] = globalMedian > 0 && medianOf(lapTimes) > globalMedian * SC_LAP_FACTOR;
    // The car ranked 0 completed lap n first -> it led that lap. Safety-car laps
    // count too (the leader still leads). Lap 0 (grid) is excluded by starting at
    // n = 1, so pole alone earns nothing.
    for (const [g, rank] of rankAt[n]) {
      if (rank === 0) {
        lapsLed.set(g, (lapsLed.get(g) || 0) + 1);
        break;
      }
    }
  }

  for (const d of guids) {
    let gained = 0;
    const dLaps = info.get(d).laps.length;
    for (let n = 1; n <= dLaps; n++) {
      if (scLap[n]) continue;
      const prev = rankAt[n - 1];
      const cur = rankAt[n];
      const dPrev = prev.get(d);
      const dCur = cur.get(d);
      if (dPrev == null || dCur == null) continue;
      for (const o of guids) {
        if (o === d) continue;
        const oPrev = prev.get(o);
        const oCur = cur.get(o);
        if (oPrev == null || oCur == null) continue; // retired / not classified this lap
        if (info.get(o).laps[n - 1].isPit) continue; // pitted -> not an on-track pass
        if (oPrev < dPrev && oCur > dCur) gained++;
      }
    }
    out.set(d, gained);
  }
  return { overtakes: out, lapsLed };
}

// Main entry point. Returns { byGuid: Map<guid, metrics>, safetyCarGuids }.
export function extractTelemetry(json, opts = {}) {
  const safetyCarNames = new Set((opts.safetyCarNames || DEFAULT_SC_NAMES).map((s) => String(s).toLowerCase()));
  const cars = Array.isArray(json?.Cars) ? json.Cars : [];
  const results = Array.isArray(json?.Result) ? json.Result : [];
  const laps = Array.isArray(json?.Laps) ? json.Laps : [];
  const events = Array.isArray(json?.Events) ? json.Events : [];
  const penalties = Array.isArray(json?.Penalties) ? json.Penalties : [];

  // --- Safety car (guid-based, robust to the SC appearing in Result[] as a
  // normal entrant). A car is the SC if its skin mentions "safety" or its driver
  // name is a known SC name.
  const safetyCarGuids = new Set();
  for (const c of cars) {
    const guid = c?.Driver?.Guid;
    if (!guid) continue;
    if (/safety/i.test(String(c.Skin || "")) || safetyCarNames.has(String(c?.Driver?.Name || "").toLowerCase())) {
      safetyCarGuids.add(guid);
    }
    if (Array.isArray(c?.Driver?.GuidsList) && c.Driver.GuidsList.length > 1) {
      console.warn(`telemetry: car ${c.CarId} lists multiple GUIDs; attributing to ${guid}`);
    }
  }
  for (const r of results) {
    if (r?.DriverGuid && safetyCarNames.has(String(r.DriverName || "").toLowerCase())) safetyCarGuids.add(r.DriverGuid);
  }

  const contactsByGuid = countIncidents(events, {
    type: "COLLISION_WITH_CAR",
    ...CONTACT_DEFAULTS,
    excludeGuids: safetyCarGuids,
  });
  const envByGuid = countIncidents(events, {
    type: "COLLISION_WITH_ENV",
    ...ENV_CONTACT_DEFAULTS,
    excludeGuids: safetyCarGuids,
  });

  // Laps grouped per driver, in completion order (the file is chronological).
  const lapsByGuid = new Map();
  for (const lp of laps) {
    const guid = lp.DriverGuid;
    if (!guid || safetyCarGuids.has(guid)) continue;
    if (!lapsByGuid.has(guid)) lapsByGuid.set(guid, []);
    lapsByGuid.get(guid).push(lp);
  }

  // Validated best lap per driver (from Result) anchors the clean-lap window.
  const bestLapByGuid = new Map();
  for (const r of results) {
    if (r?.DriverGuid && Number(r.BestLap) > 0) bestLapByGuid.set(r.DriverGuid, Number(r.BestLap));
  }

  const metrics = new Map();
  for (const [guid, arr] of lapsByGuid) {
    const times = arr.map((l) => Number(l.LapTime)).filter((t) => Number.isFinite(t) && t > 0);
    const cuts = arr.reduce((s, l) => s + (Number(l.Cuts) || 0), 0);
    const best = bestLapByGuid.get(guid) || (times.length ? Math.min(...times) : null);
    const clean = best != null ? times.filter((t) => t <= best + CLEAN_LAP_WINDOW_MS) : [];
    // Consistency percentage, simresults-style (that's what the Discord result
    // posts show): average racing lap vs the driver's best lap, as a percentage
    // of the best lap. Considered laps = everything except the driver's FIRST
    // lap (standing start), the best lap itself, and outliers slower than
    // best + 21s (pit stops, incidents). 100% would be a perfect metronome.
    let consistencyPct = null;
    if (best != null && arr.length >= 3) {
      const racing = arr
        .slice(1) // skip lap 1
        .map((l) => Number(l.LapTime))
        .filter((t) => Number.isFinite(t) && t > best && t < best + CONSISTENCY_OUTLIER_MS);
      if (racing.length >= 2) {
        const avg = racing.reduce((s, t) => s + t, 0) / racing.length;
        consistencyPct = Math.round((100 - ((avg - best) / best) * 100) * 100) / 100;
      }
    }
    metrics.set(guid, {
      laps: arr.length,
      cuts,
      cleanLaps: clean.length,
      consistencyMs: clean.length >= 3 ? Math.round(stdev(clean)) : null,
      consistencyPct,
    });
  }

  const { overtakes: overtakesByGuid, lapsLed: lapsLedByGuid } = computeOvertakes(lapsByGuid, results, safetyCarGuids);

  const penByGuid = new Map();
  for (const p of penalties) {
    const guid = p.DriverGUID;
    if (!guid || safetyCarGuids.has(guid)) continue;
    const cur = penByGuid.get(guid) || { count: 0, seconds: 0 };
    cur.count += 1;
    const dur = Number(p.TimePenaltyDuration) || 0;
    cur.seconds += dur > 1e6 ? dur / 1e9 : dur; // Go nanoseconds -> seconds
    penByGuid.set(guid, cur);
  }

  const allGuids = new Set();
  for (const r of results) if (r.DriverGuid && !safetyCarGuids.has(r.DriverGuid)) allGuids.add(r.DriverGuid);
  for (const g of lapsByGuid.keys()) allGuids.add(g);

  const byGuid = new Map();
  for (const guid of allGuids) {
    const m = metrics.get(guid);
    const pen = penByGuid.get(guid) || { count: 0, seconds: 0 };
    byGuid.set(guid, {
      contacts: contactsByGuid.get(guid) ?? 0,
      envContacts: envByGuid.get(guid) ?? 0,
      cuts: m ? m.cuts : null,
      overtakes: overtakesByGuid.get(guid) ?? 0,
      // Laps led this race (null when the driver has no lap data — same
      // convention as the other lap-derived metrics).
      lapsLed: m ? (lapsLedByGuid.get(guid) ?? 0) : null,
      laps: m ? m.laps : null,
      cleanLaps: m ? m.cleanLaps : null,
      consistencyMs: m ? m.consistencyMs : null,
      consistencyPct: m ? m.consistencyPct : null,
      gamePenalties: pen.count,
      gamePenaltySeconds: Math.round(pen.seconds * 1000) / 1000,
    });
  }

  return { byGuid, safetyCarGuids };
}
