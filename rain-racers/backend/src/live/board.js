// Turns what the AC Server Manager sends into the timing board the live page
// shows. Pure functions, so they can be tested without a server.
//
// The server manager streams JSON over its /api/race-control WebSocket:
//   EventType 200  a full snapshot: SessionInfo, TrackInfo, ConnectedDrivers
//                  and DisconnectedDrivers, each driver with CarInfo and
//                  Cars[<model>] (BestLap, LastLap, NumLaps, ... in NANOseconds)
//   EventType 53   one car's position update, many times a second
//                  (CarID, RacePosition, NormalisedSplinePos, IsInPits, ...)

import { createHash } from "node:crypto";

export const SESSION_TYPES = { 0: "Booking", 1: "Practice", 2: "Qualifying", 3: "Race" };

// The server manager keys drivers by their SteamID64. That never goes out to
// the public board: a Steam profile often carries the real name. The page
// only needs a stable key per driver.
const publicId = (guid) => createHash("sha256").update(`rr-live:${guid}`).digest("hex").slice(0, 12);

const nsToMs = (ns) => {
  const n = Number(ns);
  return Number.isFinite(n) && n > 0 ? Math.round(n / 1e6) : null;
};

// Split records come as an object keyed "0","1","2" or as a list.
function splitTimes(splits) {
  if (!splits) return [];
  const list = Array.isArray(splits) ? splits : Object.keys(splits).sort().map((k) => splits[k]);
  return list.map((sp) => nsToMs(sp?.SplitTime));
}

// Lap-progress keeper for the race gaps. The snapshot's lap count only comes
// every few seconds; the position updates in between say where on the lap a
// car is. A wrap of the spline from the end to the start of the lap counts
// one lap until the next snapshot brings the server's own count.
export function createProgress() {
  const cars = new Map(); // guid -> { laps, extra, spline }
  return {
    snapshot(guid, laps) {
      const c = cars.get(guid) || { laps: 0, extra: 0, spline: 0 };
      c.laps = laps;
      c.extra = 0;
      cars.set(guid, c);
    },
    update(guid, spline) {
      if (!Number.isFinite(spline)) return;
      const c = cars.get(guid) || { laps: 0, extra: 0, spline };
      if (c.spline > 0.9 && spline < 0.1) c.extra++;
      c.spline = spline;
      cars.set(guid, c);
    },
    of(guid) {
      const c = cars.get(guid);
      return c ? c.laps + c.extra + c.spline : 0;
    },
    clear() {
      cars.clear();
    },
  };
}

export function buildBoard({ status, liveByCar = new Map(), progress, connected, snapshotAt }) {
  if (!status) return { connected: !!connected, session: null, rows: [] };
  const si = status.SessionInfo || {};
  const type = Number(si.Type) || 0;
  const isRace = type === 3;

  const rows = [];
  const add = (guid, d, online) => {
    const ci = d?.CarInfo || {};
    if (ci.IsSpectator) return;
    const car = (d.Cars && ci.CarModel && d.Cars[ci.CarModel]) || Object.values(d.Cars || {})[0] || null;
    const live = online ? liveByCar.get(ci.CarID) || {} : {};
    rows.push({
      id: publicId(guid),
      name: ci.DriverName || "Driver",
      number: ci.RaceNumber || null,
      car: ci.CarName || ci.CarModel || "",
      online,
      inPits: online ? !!(live.IsInPits ?? d.IsInPits) : false,
      laps: Number(car?.NumLaps ?? d.TotalNumLaps ?? 0) || 0,
      bestLapMs: nsToMs(car?.BestLap),
      lastLapMs: nsToMs(car?.LastLap),
      bestSectors: splitTimes(car?.BestLapSplits),
      racePosition: Number(live.RacePosition ?? d.RacePosition) || null,
      progress: progress ? progress.of(guid) : 0,
    });
  };
  for (const [guid, d] of Object.entries(status.ConnectedDrivers?.Drivers || {})) add(guid, d, true);
  for (const [guid, d] of Object.entries(status.DisconnectedDrivers?.Drivers || {})) {
    if (!status.ConnectedDrivers?.Drivers?.[guid]) add(guid, d, false);
  }

  if (isRace) {
    // The server's own race order where it has one, else the distance driven.
    rows.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.racePosition && b.racePosition) return a.racePosition - b.racePosition;
      return b.progress - a.progress || b.laps - a.laps;
    });
    const leader = rows[0];
    for (const r of rows) {
      if (r === leader || !r.online) {
        r.gap = null;
        continue;
      }
      const behind = Math.max(0, (leader.progress || leader.laps) - (r.progress || r.laps));
      if (behind >= 1) r.gap = { laps: Math.floor(behind) };
      else {
        const lapMs = r.lastLapMs || r.bestLapMs || leader.lastLapMs || leader.bestLapMs;
        r.gap = lapMs ? { ms: Math.round(behind * lapMs) } : null;
      }
    }
  } else {
    rows.sort((a, b) => (a.bestLapMs ?? Infinity) - (b.bestLapMs ?? Infinity) || a.name.localeCompare(b.name));
    const best = rows[0]?.bestLapMs;
    for (const r of rows) r.gap = best && r.bestLapMs && r.bestLapMs !== best ? { ms: r.bestLapMs - best } : null;
  }

  // The fastest lap of the session, for the purple mark.
  const fastest = rows.reduce((m, r) => (r.bestLapMs && (!m || r.bestLapMs < m) ? r.bestLapMs : m), null);

  return {
    connected: !!connected,
    session: {
      name: si.Name || SESSION_TYPES[type] || "Session",
      type: SESSION_TYPES[type] || "Session",
      track: [si.Track, si.TrackConfig].filter(Boolean).join(" "),
      laps: Number(si.Laps) || 0,
      durationMin: Number(si.Time) || 0,
      elapsedMs: Number(si.ElapsedMilliseconds) || 0,
      ambientC: si.AmbientTemp ?? null,
      roadC: si.RoadTemp ?? null,
      snapshotAt: snapshotAt || null,
    },
    fastestLapMs: fastest,
    rows: rows.map((r, i) => {
      const { racePosition, progress: _p, ...rest } = r;
      return { ...rest, position: i + 1 };
    }),
  };
}
