// ---------------------------------------------------------------------------
// Assetto Corsa race-result JSON parser + fuzzy driver matching.
// Parses Content Manager / AC Server "RACE" result files. The order of the
// Result[] array is the finishing order.
// ---------------------------------------------------------------------------

// Levenshtein distance (iterative, O(n*m)).
function levenshtein(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]/g, ""); // strip punctuation/spaces
}

// Similarity score in [0,1] combining normalized Levenshtein + substring bonus.
function similarity(acName, driver) {
  const a = normalize(acName);
  const candidates = [driver.name, driver.discordName, driver.id];
  let best = 0;
  for (const c of candidates) {
    const b = normalize(c);
    if (!a || !b) continue;
    const dist = levenshtein(a, b);
    const maxLen = Math.max(a.length, b.length);
    let score = 1 - dist / maxLen;
    if (a.includes(b) || b.includes(a)) score = Math.max(score, 0.9);
    best = Math.max(best, score);
  }
  return best;
}

// Default tuning for contact counting (shared by the live import and backfill).
export const CONTACT_DEFAULTS = { impactThreshold: 10, mergeWindowMs: 3000 };

// Count car-to-car contact INCIDENTS per driver Steam-Guid from the AC result
// `Events`. AC logs sustained contact (scraping along another car) as many rapid
// events, so we collapse repeated hits between the same pair within
// `mergeWindowMs` into one incident, and ignore light taps below
// `impactThreshold` (km/h). Counted on the reporting (`Driver`) side only, so a
// driver who merely gets hit by someone else is not blamed for it.
// Returns Map<guid, incidentCount>.
export function countCarContacts(events, opts = {}) {
  const { impactThreshold, mergeWindowMs } = { ...CONTACT_DEFAULTS, ...opts };
  const collisions = (events || [])
    .filter(
      (e) =>
        e.Type === "COLLISION_WITH_CAR" &&
        (e.ImpactSpeed || 0) >= impactThreshold &&
        e.Driver &&
        e.Driver.Guid != null
    )
    .map((e) => ({
      guid: e.Driver.Guid,
      other: e.OtherCarId ?? -1,
      // AC stamps events in Unix SECONDS; normalise to ms so the merge window is
      // in real milliseconds. (Guard: values already in ms are left as-is.)
      t: Number.isFinite(e.Timestamp) ? (e.Timestamp < 1e11 ? e.Timestamp * 1000 : e.Timestamp) : null,
    }))
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

  const lastByPair = new Map(); // `${guid}|${other}` -> last incident timestamp
  const counts = new Map();
  for (const c of collisions) {
    const key = `${c.guid}|${c.other}`;
    const last = lastByPair.get(key);
    // No timestamps -> can't merge, count each; otherwise a hit is a fresh
    // incident only once the merge window since the last one has elapsed.
    const fresh = c.t == null || last == null || c.t - last > mergeWindowMs;
    if (fresh) counts.set(c.guid, (counts.get(c.guid) || 0) + 1);
    lastByPair.set(key, c.t ?? last ?? 0);
  }
  return counts;
}

// Parse the AC JSON and return a structured, matchable result set.
// `drivers` = all registered drivers (with team) for fuzzy matching.
export function parseAcRaceJson(json, drivers) {
  if (!json || json.Type !== "RACE" || !Array.isArray(json.Result)) {
    throw new Error("Invalid AC race JSON: expected Type=RACE with Result[]");
  }

  // Car-to-car contact incidents per Steam-Guid, attached to each entry below so
  // the admin import carries cleanliness data through to the stored result.
  const contactsByGuid = countCarContacts(json.Events);

  const entries = json.Result
    // AC includes spectators / non-finishers with 0 laps & huge time; we keep
    // everyone but expose NumLaps so the admin can DNS them if needed.
    .map((r, index) => {
      const suggestions = drivers
        .map((d) => ({ driver: d, score: similarity(r.DriverName, d) }))
        .sort((x, y) => y.score - x.score)
        .slice(0, 5)
        .map((s) => ({
          driverId: s.driver.id,
          name: s.driver.name,
          discordName: s.driver.discordName,
          teamId: s.driver.teamId,
          tier: s.driver.tier,
          score: Math.round(s.score * 100) / 100,
        }));

      const best = suggestions[0];
      return {
        position: index + 1,
        acDriverName: r.DriverName,
        // Steam id — stable identity, used to attribute contacts (and a far more
        // reliable key than the display name).
        driverGuid: r.DriverGuid ?? null,
        // Car-to-car contact incidents for this driver in the race (0 when none;
        // null when the entry has no Guid to attribute by).
        contacts: r.DriverGuid != null ? contactsByGuid.get(r.DriverGuid) ?? 0 : null,
        carModel: r.CarModel,
        totalTime: r.TotalTime,
        // Total race time in ms — used to apply time penalties (re-sort the
        // field by race time + penalty seconds). null when AC has no valid time.
        totalTimeMs: Number.isFinite(r.TotalTime) && r.TotalTime > 0 ? r.TotalTime : null,
        bestLap: r.BestLap,
        numLaps: r.NumLaps ?? null,
        grid: Number.isFinite(r.GridPosition) ? r.GridPosition : null,
        disqualified: !!r.Disqualified,
        hasPenalty: !!r.HasPenalty,
        lapPenalty: r.LapPenalty ?? 0,
        // suggested mapping (auto-filled, admin can override)
        suggestedDriverId: best && best.score >= 0.55 ? best.driverId : null,
        suggestions,
      };
    });

  return {
    type: json.Type,
    track: json.TrackName,
    date: json.Date ? new Date(json.Date) : null,
    eventName: json.EventName ?? null,
    entries,
  };
}

export { levenshtein, similarity, normalize };
