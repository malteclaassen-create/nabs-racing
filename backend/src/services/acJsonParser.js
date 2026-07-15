// ---------------------------------------------------------------------------
// Assetto Corsa race-result JSON parser + fuzzy driver matching.
// Parses Content Manager / AC Server "RACE" result files. The order of the
// Result[] array is the finishing order. Per-driver telemetry (contacts, cuts,
// overtakes, consistency, penalties) is distilled by telemetryExtractor.js.
// ---------------------------------------------------------------------------
import { extractTelemetry, countCarContacts, CONTACT_DEFAULTS } from "./telemetryExtractor.js";

// Re-exported for callers/tests that historically imported them from here.
export { countCarContacts, CONTACT_DEFAULTS };

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

// Parse the AC JSON and return a structured, matchable result set.
// `drivers` = all registered drivers (with team) for fuzzy matching.
export function parseAcRaceJson(json, drivers) {
  if (!json || json.Type !== "RACE" || !Array.isArray(json.Result)) {
    throw new Error("Invalid AC race JSON: expected Type=RACE with Result[]");
  }

  // Full per-driver telemetry keyed by Steam GUID, attached to each entry below
  // so the admin import carries cleanliness/pace data through to the stored
  // result. safetyCarGuids lets the review UI flag and deprioritise the SC.
  const { byGuid, safetyCarGuids } = extractTelemetry(json);

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
      const guid = r.DriverGuid ?? null;
      const isSafetyCar = guid != null && safetyCarGuids.has(guid);
      // GUID-first suggestion: a Steam GUID that exactly matches a roster
      // driver's stored steamId is a certain identity (far more reliable than
      // the fuzzy display name), so it wins over any name score. Otherwise fall
      // back to the name similarity, unchanged. `matchedBy` lets the admin
      // review show whether a row was matched by Steam ID or by a name guess.
      const steamMatch = guid != null ? drivers.find((d) => d.steamId && d.steamId === guid) : null;
      let suggestedDriverId = null;
      let matchedBy = null;
      if (isSafetyCar) {
        // never auto-map the safety car
      } else if (steamMatch) {
        suggestedDriverId = steamMatch.id;
        matchedBy = "steam";
      } else if (best && best.score >= 0.55) {
        suggestedDriverId = best.driverId;
        matchedBy = "name";
      }
      // Telemetry distilled from the whole file (laps + events), keyed by GUID.
      const tel = guid != null ? byGuid.get(guid) : null;
      return {
        position: index + 1,
        acDriverName: r.DriverName,
        // Steam id — stable identity, used to attribute telemetry (and a far
        // more reliable key than the display name).
        driverGuid: guid,
        // The safety car shows up in Result[] as a normal entrant; flag it so
        // the admin review can dim it and never auto-map it to a real driver.
        isSafetyCar,
        // Car-to-car contact incidents (0 when none; null when no Guid).
        contacts: tel ? tel.contacts : null,
        // Extra AC telemetry (null when the entry has no Guid / no laps).
        envContacts: tel ? tel.envContacts : null,
        cuts: tel ? tel.cuts : null,
        overtakes: tel ? tel.overtakes : null,
        lapsLed: tel ? tel.lapsLed : null,
        laps: tel ? tel.laps : null,
        cleanLaps: tel ? tel.cleanLaps : null,
        consistencyMs: tel ? tel.consistencyMs : null,
        consistencyPct: tel ? tel.consistencyPct : null,
        gamePenalties: tel ? tel.gamePenalties : null,
        gamePenaltySeconds: tel ? tel.gamePenaltySeconds : null,
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
        // suggested mapping (auto-filled, admin can override). Steam GUID wins
        // over name; the safety car is never auto-mapped (see above).
        suggestedDriverId,
        // How the suggestion was made: "steam" (exact GUID), "name" (fuzzy) or
        // null (no confident match / safety car).
        matchedBy,
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
