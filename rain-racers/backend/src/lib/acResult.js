// Reads the result file the Assetto Corsa server writes after a session
// (results/<date>_RACE.json), from the plain server or from a server manager,
// which adds penalty and disqualification fields to the same layout.
//
// What comes back is the finishing order as the file has it, one row per
// driver, with the laps counted from the lap list:
//   { type, track, rows: [{ position, name, guid, team, carModel, laps,
//                           totalTimeMs, bestLapMs, status }] }

// AC's "no lap" marker for BestLap.
const NO_LAP = 999999999;

const validTime = (ms) => (Number.isFinite(ms) && ms > 0 && ms < NO_LAP ? Math.round(ms) : null);

export function parseAcResult(json, { classifiedLapShare = 0.9 } = {}) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (!data || !Array.isArray(data.Result)) {
    throw new Error("This is not an Assetto Corsa result file (no Result list).");
  }

  const laps = Array.isArray(data.Laps) ? data.Laps : [];
  const cars = Array.isArray(data.Cars) ? data.Cars : [];

  const lapCount = new Map();
  for (const lap of laps) {
    const guid = lap.DriverGuid || "";
    if (!guid) continue;
    lapCount.set(guid, (lapCount.get(guid) || 0) + 1);
  }

  // The team name sits on the entry list part (Cars[].Driver.Team).
  const teamByGuid = new Map();
  for (const car of cars) {
    const d = car?.Driver;
    if (d?.Guid && d.Team) teamByGuid.set(d.Guid, String(d.Team).trim());
  }

  // A driver who reconnected can appear twice; the first row is the one the
  // server ranked, the rest are dropped. Empty slots of the entry list
  // (no name, no guid) are dropped too.
  const seen = new Set();
  const rows = [];
  for (const r of data.Result) {
    const guid = String(r.DriverGuid || "").trim();
    const name = String(r.DriverName || "").trim();
    if (!guid && !name) continue;
    const key = guid || `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let totalTimeMs = validTime(r.TotalTime);
    // Server managers keep a time penalty apart from the race time (in
    // nanoseconds); the order in the file already has it applied.
    if (totalTimeMs && r.HasPenalty && Number(r.PenaltyTime) > 0) {
      totalTimeMs += Math.round(Number(r.PenaltyTime) / 1e6);
    }

    rows.push({
      name: name || "Unknown driver",
      guid: guid || null,
      team: teamByGuid.get(guid) || null,
      carModel: r.CarModel || null,
      laps: lapCount.get(guid) || 0,
      totalTimeMs,
      bestLapMs: validTime(r.BestLap),
      disqualified: !!r.Disqualified,
    });
  }

  const type = String(data.Type || "").toUpperCase();
  const isRace = type === "RACE";
  const winnerLaps = rows.reduce((m, r) => Math.max(m, r.laps), 0);
  const needed = Math.ceil(winnerLaps * classifiedLapShare);

  rows.forEach((row, i) => {
    row.position = i + 1;
    if (row.disqualified) row.status = "DSQ";
    else if (row.laps === 0) row.status = "DNS";
    else if (isRace && row.laps < needed) row.status = "DNF";
    else row.status = "FIN";
    delete row.disqualified;
  });

  // Finishers first, then DNF, then DSQ and DNS, each group in the server's
  // order. The server already ranks this way in nearly every file; this only
  // fixes the odd one where a disconnected driver sits above a finisher.
  const rank = { FIN: 0, DNF: 1, DSQ: 2, DNS: 3 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || a.position - b.position);
  rows.forEach((row, i) => (row.position = i + 1));

  return {
    type: type || "UNKNOWN",
    track: [data.TrackName, data.TrackConfig].filter(Boolean).join(" "),
    rows,
  };
}
