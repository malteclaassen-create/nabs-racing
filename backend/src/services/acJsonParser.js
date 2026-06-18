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

// Parse the AC JSON and return a structured, matchable result set.
// `drivers` = all registered drivers (with team) for fuzzy matching.
export function parseAcRaceJson(json, drivers) {
  if (!json || json.Type !== "RACE" || !Array.isArray(json.Result)) {
    throw new Error("Invalid AC race JSON: expected Type=RACE with Result[]");
  }

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
        carModel: r.CarModel,
        totalTime: r.TotalTime,
        bestLap: r.BestLap,
        numLaps: r.NumLaps ?? null,
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
