// ---------------------------------------------------------------------------
// A session result file from the AC Server Manager, read for its LAPS.
//
// services/acJsonParser.js reads the same files for their classification —
// who finished where, with what penalties — and that is a race question. This
// asks a training question of them: what is the fastest clean lap each driver
// did on this track, and what were its sectors. The server manager writes one
// of these for every session it runs, practice included, so a week of
// training is a handful of them, and an admin can hand the site the ones the
// race server has since forgotten (lib/liveBestLaps.js is where they go).
//
// Fields, as the server manager writes them: Type ("PRACTICE" / "QUALIFY" /
// "RACE"), TrackName + TrackConfig, Result[] with one row per entrant
// (DriverGuid = SteamID64, DriverName, CarModel, BestLap in ms) and Laps[] in
// completion order (DriverGuid, DriverName, CarModel, LapTime in ms, Sectors[]
// in ms, Cuts). The sectors are the server's own splits — the thing the
// in-game recorder can never know — which is the whole reason this file is
// worth reading.
//
// LAPS[] IS THE TRUTH; RESULT[] IS NOT READ FOR NAMES OR TIMES. The league's
// practice server has cars that several drivers use one after another over an
// evening (the reserve and guest slots), and for those the server manager's
// Result[] row is the CAR's, dressed up as a driver's: DriverName is every
// name that sat in it joined with commas ("ricoss, woozy, ThatDudeGuest"),
// BestLap is the quickest lap anyone did in it, and DriverGuid is one of them.
// The first cut of this read names and times from there, and the board showed
// a driver credited with somebody else's lap under a list of five names. A lap
// row carries the name and the car of the one driver who drove it, so every
// row here is built from lap rows and nothing else — a driver with no clean
// lap in the file has no time to show, whatever the classification says.
// ---------------------------------------------------------------------------
import { trackKeyOf } from "./telemetryLaps.js";

// Same bar as everywhere else on the site: above 30 minutes it is not a lap.
const MAX_LAP_MS = 1_800_000;
const MIN_LAP_MS = 20_000;
const STEAM_RE = /^\d{10,20}$/;

const ms = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= MIN_LAP_MS && n <= MAX_LAP_MS ? n : null;
};

// Three sector times that add up to the lap, or null. The server writes them
// in ms and they sum to LapTime to the millisecond; a row where they do not is
// a row that was cut short (a disconnect mid-lap leaves a partial Sectors[]),
// and the board must not print splits that disagree with the time beside them.
function sectorsOf(lap, lapTimeMs) {
  const raw = Array.isArray(lap?.Sectors) ? lap.Sectors : [];
  if (raw.length !== 3) return null;
  const s = raw.map((v) => Math.round(Number(v)));
  if (s.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  // Rounding each split can put the sum a couple of ms off the whole.
  if (Math.abs(s[0] + s[1] + s[2] - lapTimeMs) > 3) return null;
  return s;
}

// Throws on anything that is not a session file; the admin sees the message.
export function parsePracticeJson(json, { fileName = "" } = {}) {
  if (!json || typeof json !== "object") throw new Error("Not a session file");
  if (!Array.isArray(json.Result)) throw new Error("Not an AC session file: no Result[]");
  const track = String(json.TrackName || "").trim();
  if (!track) throw new Error("Not an AC session file: no TrackName");
  const layout = String(json.TrackConfig || "").trim();
  const type = String(json.Type || "").toUpperCase() || "SESSION";

  // The fastest CLEAN lap per driver, from the lap rows and nothing else (see
  // the header). A lap with cuts is not a lap time — the server itself does
  // not count it towards BestLap — and a lap outside the bounds is an out lap
  // or a lap sat in the garage. A row without a Steam id is a row nobody can
  // be matched to on the live board, so it is skipped rather than shown under
  // a name that could be anybody's; a name that is a comma-joined list is the
  // server manager's shared-car row leaking into a lap row, and not a driver.
  const best = new Map();
  const entrants = new Set();
  for (const lap of Array.isArray(json.Laps) ? json.Laps : []) {
    const guid = String(lap?.DriverGuid || "");
    if (!STEAM_RE.test(guid)) continue;
    entrants.add(guid);
    const name = String(lap?.DriverName || "").trim().slice(0, 64);
    if (!name || name.includes(", ")) continue;
    if (Number(lap?.Cuts) > 0) continue;
    const lapTimeMs = ms(lap?.LapTime);
    if (lapTimeMs == null) continue;
    const seen = best.get(guid);
    if (seen && seen.lapTimeMs <= lapTimeMs) continue;
    best.set(guid, {
      steamId: guid,
      name,
      // The car THIS lap was driven in: on the practice server a driver can
      // take a different car later in the evening, and the shared cars are
      // exactly where the classification row would name the wrong one.
      car: String(lap?.CarModel || "").trim().slice(0, 80),
      lapTimeMs,
      sectorsMs: sectorsOf(lap, lapTimeMs),
      recordedAt: lap?.Timestamp ? String(lap.Timestamp).slice(0, 40) : null,
    });
  }

  return {
    type,
    track,
    layout,
    trackKey: trackKeyOf(track, layout),
    sessionName: String(json.SessionName || json.Name || "").slice(0, 80),
    fileName: String(fileName || "").slice(0, 120),
    date: json.Date ? String(json.Date).slice(0, 40) : null,
    // Everyone who completed a lap, clean or not — the number the admin card
    // can set "drivers with a time" against.
    entrants: entrants.size,
    laps: [...best.values()].sort((a, b) => a.lapTimeMs - b.lapTimeMs),
  };
}
