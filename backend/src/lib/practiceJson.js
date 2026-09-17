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
// completion order (DriverGuid, LapTime in ms, Sectors[] in ms, Cuts). The
// sectors are the server's own splits — the thing the in-game recorder can
// never know — which is the whole reason this file is worth reading.
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

  // Who was in the session, by Steam id. A row without one is a row nobody
  // can be matched to on the live board, so it is skipped rather than shown
  // under a name that could be anybody's.
  const entrants = new Map();
  for (const r of json.Result) {
    const guid = String(r?.DriverGuid || "");
    if (!STEAM_RE.test(guid)) continue;
    const name = String(r?.DriverName || "").trim().slice(0, 64);
    if (!name) continue;
    entrants.set(guid, {
      steamId: guid,
      name,
      car: String(r?.CarModel || "").trim().slice(0, 80),
      // The classification's own best, kept as the answer of last resort for
      // a file whose Laps[] was stripped — it carries no sectors.
      resultBestMs: ms(r?.BestLap),
    });
  }

  // The fastest CLEAN lap per driver from the lap list. A lap with cuts is not
  // a lap time — the server itself does not count it towards BestLap — and a
  // lap slower than the bounds is an out lap or a lap sat in the garage.
  const best = new Map();
  for (const lap of Array.isArray(json.Laps) ? json.Laps : []) {
    const guid = String(lap?.DriverGuid || "");
    const who = entrants.get(guid);
    if (!who) continue;
    if (Number(lap?.Cuts) > 0) continue;
    const lapTimeMs = ms(lap?.LapTime);
    if (lapTimeMs == null) continue;
    const seen = best.get(guid);
    if (seen && seen.lapTimeMs <= lapTimeMs) continue;
    best.set(guid, {
      steamId: guid,
      name: who.name,
      // The car this lap was driven in, which in a practice session is not
      // always the one the classification row ended the evening in.
      car: String(lap?.CarModel || who.car || "").trim().slice(0, 80),
      lapTimeMs,
      sectorsMs: sectorsOf(lap, lapTimeMs),
      recordedAt: lap?.Timestamp ? String(lap.Timestamp).slice(0, 40) : null,
    });
  }
  // Entrants with a BestLap in the classification but no usable row in Laps[]:
  // the time is real, the sectors are unknown.
  for (const who of entrants.values()) {
    if (best.has(who.steamId) || who.resultBestMs == null) continue;
    best.set(who.steamId, {
      steamId: who.steamId,
      name: who.name,
      car: who.car,
      lapTimeMs: who.resultBestMs,
      sectorsMs: null,
      recordedAt: null,
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
    entrants: entrants.size,
    laps: [...best.values()].sort((a, b) => a.lapTimeMs - b.lapTimeMs),
  };
}
