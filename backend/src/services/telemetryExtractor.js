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

// People who USUALLY drive the safety car, by AC name. A fallback for files
// where the skin doesn't say "safety" — and only ever a SUSPICION, never a
// verdict: these are members of the league who also race, and in a training
// session they turn up in an ordinary car like everyone else. Treating the
// name as proof wiped their telemetry and left the import unable to map them.
const DEFAULT_SC_NAMES = ["Tyler27", "Janelko", "Samuel Foniok"];

const CLEAN_LAP_WINDOW_MS = 10000; // a lap counts as "clean" within 10s of own best
const CONSISTENCY_OUTLIER_MS = 21000; // simresults drops laps over best+21s from consistency
const PIT_LAP_EXTRA_MS = 25000; // a lap this much over the driver's median = a pit lap
// Entry-side gate of the paired pit signature: how much the in-lap must lose in
// the learned pit-entry sector. Small on purpose — braking off the racing line
// into the pit lane costs a couple of seconds, no more; the heavy loss lands on
// the out-lap. Calibrated at Hockenheim S8R1: weakest accepted clean stop lost
// 2.6s, strongest rejected crash 1.7s, so 2.5s sits in the measured gap.
const PIT_IN_SECTOR_MIN_MS = 2500;

// The recorder normalises compounds to full names (services/liveTiming.js
// tyreKey); stored stints speak the result file's short codes, which is what
// the strategy graphic renders. One map, both directions of the same rubber.
const TYRE_CODE = {
  hypersoft: "HS", ultrasoft: "US", supersoft: "SS", soft: "S",
  medium: "M", hard: "H", superhard: "SH", intermediate: "I", wet: "W",
};
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
  // ACSM writes `Penalties: null` when its automatic penalty system was not
  // active for the session. Keep that distinct from an empty array: null here
  // means "not recorded" and must come out as null per driver, never as 0 —
  // otherwise a round without penalty collection reads as everyone driving
  // penalty-free (which then skews the rating's penalty rate).
  const penalties = Array.isArray(json?.Penalties) ? json.Penalties : null;

  // --- Safety car (guid-based, robust to the SC appearing in Result[] as a
  // normal entrant). Two strengths of evidence, and they are NOT the same:
  //
  //   safetyCarGuids   — the car's SKIN says safety. That is the car itself,
  //                      so it is a fact: its telemetry is thrown away and it
  //                      is never mapped to a driver.
  //   suspectedGuids   — only the driver's NAME matches the known-SC list. The
  //                      same person races in the training sessions, in an
  //                      ordinary car, and then this is simply wrong. It is
  //                      passed on as a flag for the import to show, and
  //                      nothing else: their telemetry is kept and they can be
  //                      mapped like anybody else.
  const safetyCarGuids = new Set();
  const suspectedSafetyCarGuids = new Set();
  const knownName = (n) => safetyCarNames.has(String(n || "").toLowerCase());
  for (const c of cars) {
    const guid = c?.Driver?.Guid;
    if (!guid) continue;
    if (/safety/i.test(String(c.Skin || ""))) safetyCarGuids.add(guid);
    else if (knownName(c?.Driver?.Name)) suspectedSafetyCarGuids.add(guid);
    if (Array.isArray(c?.Driver?.GuidsList) && c.Driver.GuidsList.length > 1) {
      console.warn(`telemetry: car ${c.CarId} lists multiple GUIDs; attributing to ${guid}`);
    }
  }
  for (const r of results) {
    if (r?.DriverGuid && knownName(r.DriverName) && !safetyCarGuids.has(r.DriverGuid)) {
      suspectedSafetyCarGuids.add(r.DriverGuid);
    }
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

  // Per-lap FIELD BASELINE: the 25th percentile of everyone's lap-n time, i.e.
  // the clean pace ON THAT LAP. Under a safety car the baseline rises with the
  // field, so a car merely trundling behind the SC shows ~zero delta while a
  // car that dived into the pits still sticks out — stops made under SC (very
  // common) stay detectable, and SC laps alone never read as stops.
  const maxLapCount = Math.max(0, ...[...lapsByGuid.values()].map((a) => a.length));
  const lapBaseline = [];
  for (let n = 1; n <= maxLapCount; n++) {
    const ts = [];
    for (const a of lapsByGuid.values()) {
      const t = a[n - 1] ? Number(a[n - 1].LapTime) : 0;
      if (Number.isFinite(t) && t > 0) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    lapBaseline[n] = ts.length ? ts[Math.floor((ts.length - 1) * 0.25)] : 0;
  }

  // Calibrate what a pit stop actually costs in THIS race from the stops we
  // can see for certain — the ones with a compound change (the slower of the
  // two boundary laps vs that lap's baseline). Same-compound stops must then
  // lose a comparable amount, which keeps ordinary driver mistakes from
  // reading as pit stops. (League tracks differ a lot: ~20s at Monza, 30s+
  // elsewhere — a fixed threshold missed real stops.)
  const refFor = (ownMedian, lapNum) => Math.max(lapBaseline[lapNum] || 0, ownMedian);
  // Sector medians across the whole field, so a lap's loss can be attributed to
  // WHERE on the track it happened rather than only to how big it was.
  const sectorPool = [[], [], []];
  for (const arr of lapsByGuid.values()) {
    for (const l of arr) {
      const s = l.Sectors || [];
      for (let k = 0; k < 3; k++) if (Number(s[k]) > 0) sectorPool[k].push(Number(s[k]));
    }
  }
  const sectorMedian = sectorPool.map((v) => medianOf(v));
  // Per-lap-number sector baselines (25th percentile), the sector-level twin of
  // lapBaseline above and there for the same reason: under a safety car every
  // sector balloons for the whole field, and measured against a global median
  // an SC lap looks exactly like a pit lap. Measured against what the FIELD ran
  // in that sector ON THAT LAP, an SC lap shows ~zero delta while a car diving
  // into the pits still sticks out.
  const sectorBaseline = []; // [lapNumber][sectorIdx] -> 25th percentile ms
  for (let n = 1; n <= maxLapCount; n++) {
    const pools = [[], [], []];
    for (const a of lapsByGuid.values()) {
      const s = a[n - 1]?.Sectors || [];
      for (let k = 0; k < 3; k++) if (Number(s[k]) > 0) pools[k].push(Number(s[k]));
    }
    sectorBaseline[n] = pools.map((v) => {
      v.sort((x, y) => x - y);
      return v.length ? v[Math.floor((v.length - 1) * 0.25)] : 0;
    });
  }
  // A lap's loss in one sector, against the stricter of the two baselines. The
  // per-lap component kills safety-car phantoms; the global component stops a
  // uniformly slow field from hiding a stop. null = no usable sector data.
  const sectorDelta = (lap, lapNum, k) => {
    const s = Number(lap?.Sectors?.[k]);
    if (!(s > 0)) return null;
    const base = Math.max(sectorBaseline[lapNum]?.[k] || 0, sectorMedian[k] || 0);
    return base > 0 ? s - base : null;
  };
  // Which sector a lap lost its time in (null when the file has no sectors).
  const worstSector = (lap) => {
    const s = lap?.Sectors || [];
    if (!sectorMedian.every((m) => m > 0) || ![0, 1, 2].every((k) => Number(s[k]) > 0)) return null;
    const d = [0, 1, 2].map((k) => Number(s[k]) - sectorMedian[k]);
    return d.indexOf(Math.max(...d));
  };

  const pitLossSamples = [];
  // How often each sector carries the loss on the lap a KNOWN stop was entered
  // on, and on the lap after it. Learned per race rather than assumed: the pit
  // lane sits in a different sector at every circuit, and at Hockenheim a stop
  // straddles the line — time goes in sector 3 on the way in and sector 1 on
  // the way out, with sector 2 untouched.
  const inLapSectors = [0, 0, 0];
  const outLapSectors = [0, 0, 0];
  for (const arr of lapsByGuid.values()) {
    const med = medianOf(arr.map((l) => Number(l.LapTime)).filter((t) => Number.isFinite(t) && t > 0));
    if (!med) continue;
    for (let i = 1; i < arr.length; i++) {
      const prevT = String(arr[i - 1].Tyre || "").trim();
      const curT = String(arr[i].Tyre || "").trim();
      if (prevT && curT && prevT !== curT) {
        const dPrev = (Number(arr[i - 1].LapTime) || 0) - refFor(med, i);
        const dCur = (Number(arr[i].LapTime) || 0) - refFor(med, i + 1);
        const delta = Math.max(dPrev, dCur);
        if (delta > 5000) pitLossSamples.push(delta);
        if (dPrev > 5000) {
          const w = worstSector(arr[i - 1]);
          if (w != null) inLapSectors[w]++;
        }
        if (dCur > 5000) {
          const w = worstSector(arr[i]);
          if (w != null) outLapSectors[w]++;
        }
      }
    }
  }
  // The dominant sector on each side of a stop, learned from the stops we can
  // see for certain. At Hockenheim the pit lane straddles the line: entering
  // costs sector 3 of the in-lap, leaving costs sector 1 of the next lap, and
  // sector 2 is never touched. A driver going off costs whichever sector the
  // mistake happened in — which is exactly what makes the pair below decisive.
  // Both need enough known stops to be trustworthy; short of that they stay
  // null and the fallback path below applies.
  const domOf = (tally) => {
    const total = tally.reduce((a, b) => a + b, 0);
    if (total < 5) return null;
    const k = tally.indexOf(Math.max(...tally));
    return tally[k] / total >= 0.5 ? k : null;
  };
  const pitInSector = domOf(inLapSectors);
  const pitOutSector = domOf(outLapSectors);
  // Kept for the fallback path (no sector data in the file).
  const pitSectors = new Set();
  for (const tally of [inLapSectors, outLapSectors]) {
    const total = tally.reduce((a, b) => a + b, 0);
    if (total >= 5) tally.forEach((n, k) => { if (n / total >= 0.2) pitSectors.add(k); });
  }
  const typicalPitLoss = pitLossSamples.length ? medianOf(pitLossSamples) : null;
  // Threshold for a same-compound stop: 80% of what a stop demonstrably costs
  // in THIS race. Without calibration stops (no compound change anywhere) fall
  // back to the conservative fixed rule.
  //
  // The floor used to be 15s, and that quietly broke every short pit lane.
  // Season 8 round 1 (Hockenheim) measured a typical loss of 14s from 58 real
  // compound-change stops, so the floor sat ABOVE the cost of an actual stop
  // and no same-compound stop could ever clear it: a driver's 10 medium / 18
  // hard / 20 hard came out as "10 medium, 38 hard, one stop". Reported from
  // the league Discord, and reproducible straight off the stored result file.
  //
  // A floor is still wanted, because with no calibration a small mistake must
  // not read as a stop. It just has to sit below a real stop rather than above
  // one, so it is now expressed against the measured loss and only guards the
  // degenerate case where calibration returns something implausibly small.
  const pitDeltaMin = typicalPitLoss ? Math.max(9000, typicalPitLoss * 0.8) : PIT_LAP_EXTRA_MS;

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
    // Tyre stints, in completion order (the file is chronological). A stint
    // ends on a COMPOUND CHANGE — or on a detected same-compound stop, since
    // the file carries no pit flag (verified against the server manager's whole
    // API surface: pit state exists only live, never in stored results).
    //
    // Same-compound detection is the PAIRED sector signature, validated against
    // two driver-confirmed strategies from S8 round 1: a stop must cost time on
    // BOTH sides of it — the in-lap loses in the learned pit-entry sector (a
    // couple of seconds: braking into the lane) and the very next lap loses the
    // big money in the learned pit-exit sector (standing still + the lane's
    // speed limit). A spin, a crash or a safety-car train never produces that
    // pair: a mistake costs one sector of one lap, and an SC inflates the
    // per-lap baselines for everyone so nobody sticks out. One driver's phantom
    // "three stints on the same mediums" under SC and another's vanished
    // hard-hard stop both came down to the old single-lap rule; the pair
    // reproduces the truth on all 59 compound-change stops in that race
    // (57 with the entry gate; the 2 misses roll the entry so slowly the gate
    // sees nothing, and the tyre label still catches those).
    //
    // The split lands so the OUT-lap starts the new stint — confirmed by a
    // driver's own account (18/20 on his two hard sets, not 19/19).
    const median = medianOf(times);
    // Recorded live pit data for this driver, when a recorder file exists for
    // the session (see services/pitRecorder.js): the feed's absolute stop
    // counter is authoritative, so with it present the heuristic is DEMOTED to
    // placing the recorded stops on the lap chart rather than inventing any.
    const recorded = opts.pitStopsByGuid?.get?.(guid) || null;
    const pairEvidence = (i) => {
      // Score for a same-compound split between arr[i-1] (in) and arr[i] (out).
      const dIn = sectorDelta(arr[i - 1], i, pitInSector);
      const dOut = sectorDelta(arr[i], i + 1, pitOutSector);
      if (dIn == null || dOut == null) return null;
      return { pass: dIn >= PIT_IN_SECTOR_MIN_MS && dOut >= pitDeltaMin, score: dIn + dOut };
    };
    const tyreAt = (i) => String(arr[i]?.Tyre || "").trim();
    const compoundChangeAt = (i) => {
      const a = tyreAt(i - 1);
      const b = tyreAt(i);
      return !!(a && b && a !== b);
    };
    // Same-compound split indices (the lap index that STARTS the new stint).
    const splitAt = new Set();
    if (recorded) {
      // Truth mode: the recorder watched this driver, so the visit count is
      // fact — including the fact of ZERO visits, which must silence the
      // heuristic entirely rather than fall through to it.
      //
      // What a recorded lap NUMBER means: the feed counts laps COMPLETED, so a
      // driver confirmed stopped while the counter reads N did their in-lap as
      // lap N and their out-lap as lap N+1 — which is array index N, the index
      // that starts the new stint. The ET53 pit-entry hint can sit one lower
      // (on most layouts the lane branches off before the timing line, so the
      // counter ticks while the car is already stopped), so the split is
      // allowed on index N or N+1 and the paired sector evidence picks; with no
      // evidence either way N wins, the snapshot case being the common one.
      //
      // The window for "this stop is already expressed by a compound change"
      // must be the SAME two indices. It used to reach a third lap further,
      // which quietly deleted the earlier of two stops made close together —
      // exactly Flo's opening pair at Hockenheim, two laps apart.
      for (const entryLap of recorded.stops || []) {
        const covered = [entryLap, entryLap + 1].some((n) => n >= 1 && n < arr.length && compoundChangeAt(n));
        if (covered) continue;
        let bestIdx = null;
        let bestScore = -Infinity;
        for (const cand of [entryLap, entryLap + 1]) {
          if (cand < 1 || cand >= arr.length) continue;
          const ev = pairEvidence(cand);
          const score = ev ? ev.score : 0;
          if (score > bestScore) {
            bestScore = score;
            bestIdx = cand;
          }
        }
        if (bestIdx != null) splitAt.add(bestIdx);
      }
      // Stops the recorder counted but could not put a lap to (made while the
      // backend was down mid-race): the COUNT is still authoritative. Express
      // the difference through the best remaining pair evidence on the chart.
      const totalPits = Number(recorded.totalPits) || 0;
      let expressed = splitAt.size;
      for (let i = 1; i < arr.length; i++) if (compoundChangeAt(i)) expressed++;
      if (totalPits > expressed) {
        // Only laps that PASS the paired signature may soak up an unplaced
        // count. A recorded stop with a known lap deserves best-effort
        // placement above; an unplaced count does not license inventing a
        // split on a lap with no pit evidence at all — if the evidence isn't
        // there, the stint chart shows fewer stops than the recorder counted,
        // which is honest, visible and debuggable. The first version accepted
        // any lap with sector data (score 0 beat -Infinity) and quietly
        // sprinkled phantom one-lap stints across the field.
        const cands = [];
        for (let i = 1; i < arr.length; i++) {
          const a = tyreAt(i - 1);
          const b = tyreAt(i);
          if (!a || !b || a !== b || splitAt.has(i)) continue;
          const ev = pairEvidence(i);
          if (ev?.pass) cands.push({ i, score: ev.score });
        }
        cands.sort((x, y) => y.score - x.score);
        for (const c of cands) {
          if (expressed >= totalPits) break;
          splitAt.add(c.i);
          expressed++;
        }
      }
    } else if (pitInSector != null && pitOutSector != null) {
      // Paired-signature mode. No cooldown and no minimum stint length on
      // purpose: back-to-back pit visits are real (two drivers at Hockenheim
      // pitted on consecutive laps, both fully evidenced), and the pair itself
      // is what keeps messy phases from over-splitting. No cuts guard either —
      // a real stop can follow a car-damaging moment (that is often WHY the
      // driver stopped), and one confirmed stop carried two cuts on its in-lap.
      for (let i = 1; i < arr.length; i++) {
        const a = tyreAt(i - 1);
        const b = tyreAt(i);
        if (!a || !b || a !== b) continue; // compound changes split below anyway
        const ev = pairEvidence(i);
        if (ev?.pass) splitAt.add(i);
      }
    } else {
      // Fallback: no sector data in the file (or too few known stops to learn
      // the pit sectors from). The old single-lap rule, cooldown and cuts guard
      // included — coarse, but the only signal available. lastSplitIdx starts
      // at 0, as the original loop had it (the first stint anchors there): the
      // rewrite briefly set it to -Infinity, which let the 3-lap cooldown
      // approve a split on lap 2 of the race.
      let lastSplitIdx = 0;
      let pendingPitSplit = false;
      arr.forEach((l, i) => {
        const changed = compoundChangeAt(i);
        if (pendingPitSplit && !changed && i - lastSplitIdx >= 3 && tyreAt(i)) {
          splitAt.add(i);
          lastSplitIdx = i;
        } else if (changed) {
          lastSplitIdx = i;
        }
        const lt = Number(l.LapTime) || 0;
        const delta = median > 0 ? lt - refFor(median, i + 1) : 0;
        const looksLikeMistake = Number(l.Cuts) > 0 && (!typicalPitLoss || delta < typicalPitLoss * 1.2);
        const w = worstSector(l);
        const lostWhereStopsDo = !pitSectors.size || w == null || pitSectors.has(w);
        pendingPitSplit = delta >= pitDeltaMin && !looksLikeMistake && lostWhereStopsDo;
      });
    }
    const stints = [];
    arr.forEach((l, i) => {
      const t = tyreAt(i);
      const last = stints[stints.length - 1];
      const changed = !!(last && t && last.tyre !== "?" && t !== last.tyre);
      if (!last) {
        stints.push({ tyre: t || "?", laps: 1, from: 1 });
      } else if (changed || splitAt.has(i)) {
        stints.push({ tyre: t || last.tyre, laps: 1, from: i + 1 });
      } else {
        last.laps += 1;
        if (last.tyre === "?" && t) last.tyre = t;
      }
    });

    // Rename the stints from what the car was SEEN on, when a recording exists.
    // The file's per-lap Tyre field is not trustworthy: a driver's own account
    // of eighteen laps on mediums came back as hards on every one of those laps
    // in the stored result, while his stint boundaries were exactly right. The
    // live feed names the compound directly, so where it was watched, it wins.
    //
    // Read at each stint's MIDDLE rather than its first lap: the feed's lap
    // counter trails a snapshot, so a change observed right at a boundary can
    // be attributed a lap either side of it — the middle of a stint is never
    // ambiguous.
    if (recorded?.tyres?.length) {
      const timeline = recorded.tyres;
      for (const st of stints) {
        const mid = st.from + Math.floor((st.laps - 1) / 2);
        let seen = null;
        for (const t of timeline) {
          if (t.lap <= mid) seen = t.tyre;
          else break;
        }
        const code = seen ? TYRE_CODE[seen] || st.tyre : null;
        if (code) st.tyre = code;
      }
    }
    for (const st of stints) delete st.from;

    metrics.set(guid, {
      laps: arr.length,
      cuts,
      cleanLaps: clean.length,
      consistencyMs: clean.length >= 3 ? Math.round(stdev(clean)) : null,
      consistencyPct,
      stints,
    });
  }

  const { overtakes: overtakesByGuid, lapsLed: lapsLedByGuid } = computeOvertakes(lapsByGuid, results, safetyCarGuids);

  const penByGuid = new Map();
  for (const p of penalties || []) {
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

  // Whether the session recorded cuts at all. Some track mods have no working
  // cut detection, so every lap carries Cuts: 0 for the entire field — over a
  // full race distance that is a dead sensor, not clean driving (a session
  // with live detection always logs some cuts somewhere). In that case store
  // null for everyone rather than crediting the whole grid with a clean race.
  let anyCuts = false;
  for (const guid of allGuids) if ((metrics.get(guid)?.cuts || 0) > 0) { anyCuts = true; break; }

  const byGuid = new Map();
  for (const guid of allGuids) {
    const m = metrics.get(guid);
    const pen = penByGuid.get(guid) || { count: 0, seconds: 0 };
    byGuid.set(guid, {
      contacts: contactsByGuid.get(guid) ?? 0,
      envContacts: envByGuid.get(guid) ?? 0,
      cuts: m && anyCuts ? m.cuts : null,
      overtakes: overtakesByGuid.get(guid) ?? 0,
      // Laps led this race (null when the driver has no lap data — same
      // convention as the other lap-derived metrics).
      lapsLed: m ? (lapsLedByGuid.get(guid) ?? 0) : null,
      laps: m ? m.laps : null,
      cleanLaps: m ? m.cleanLaps : null,
      consistencyMs: m ? m.consistencyMs : null,
      consistencyPct: m ? m.consistencyPct : null,
      stints: m && m.stints?.length ? m.stints : null,
      gamePenalties: penalties ? pen.count : null,
      gamePenaltySeconds: penalties ? Math.round(pen.seconds * 1000) / 1000 : null,
    });
  }

  return { byGuid, safetyCarGuids, suspectedSafetyCarGuids };
}
