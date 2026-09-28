// Race control: incidents spotted live, straight off the Emperor feed.
//
// Two kinds:
//   - collisions: the server manager forwards AC's collision events on its
//     race-control socket as EventType 108 (its own live map draws them as
//     little bursts). Car vs car and car vs wall, with impact speed and world
//     position. Small taps under the threshold are dropped.
//   - stopped cars: out of the pit lane, under 8 km/h for 3 s, and only once
//     the car has been faster than 40 km/h (so the grid never trips it).
//
// Everything lands in the "Incident" table so a restart mid-race loses
// nothing. One state per race server, same as pitRecorder.
import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma.js";

// Off track, estimated from the map (lib/trackMask.js): the car's centre this
// far beyond the painted tarmac is about "four wheels out". Held a moment
// either way so a kerb or a bump of the reading does not flicker it.
export const OFF_M = 2.5;
const BACK_ON_M = 1.5;
const OFF_HOLD_MS = 800;
const ON_HOLD_MS = 1000;

export const STOP_KMH = 8;
export const STOP_HOLD_MS = 3000;
export const ARM_KMH = 40;
const MOVING_KMH = STOP_KMH + 10;
const MOVING_HOLD_MS = 3000;
const TELEPORT_M = 60;
// AC fires a contact several times while two cars lean on each other (and
// once per car), and a car sliding along a wall fires all the way along it
// (Interlagos practice: one crash, three hits over ten seconds). Anything with
// the same people inside the window, counted from their LAST hit, is one incident.
const MERGE_CAR_MS = 5000;
const MERGE_ENV_MS = 10000;

export const MIN_KMH_KEY = "race_control_min_kmh";
export const DEFAULT_MIN_KMH = 15;
let minKmhCache = { v: DEFAULT_MIN_KMH, at: 0 };

export async function getMinKmh() {
  if (Date.now() - minKmhCache.at < 30_000) return minKmhCache.v;
  try {
    const row = await prisma.setting.findUnique({ where: { key: MIN_KMH_KEY } });
    const n = Number(row?.value);
    minKmhCache = { v: Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_KMH, at: Date.now() };
  } catch {
    minKmhCache = { v: minKmhCache.v, at: Date.now() };
  }
  return minKmhCache.v;
}

export async function setMinKmh(v) {
  const n = Math.max(0, Math.min(300, Math.round(Number(v))));
  if (!Number.isFinite(n)) throw new Error("Not a number");
  await prisma.setting.upsert({
    where: { key: MIN_KMH_KEY },
    create: { key: MIN_KMH_KEY, value: String(n) },
    update: { value: String(n) },
  });
  minKmhCache = { v: n, at: Date.now() };
  return n;
}

const states = new Map(); // serverKey -> state

function fresh() {
  return {
    sessionKey: null,
    sessionType: null,
    startedAt: null,
    names: new Map(), // guid -> name
    cars: new Map(), // guid -> stop watch
    recent: new Map(), // merge key -> { id, at, kmh }
    seenIds: new Set(), // upstream collision ids, the feed repeats itself on reconnect
  };
}

function stateFor(key) {
  if (!states.has(key)) states.set(key, fresh());
  return states.get(key);
}

// Every ET200 snapshot. A new session key wipes the per-car state.
export function onSession(serverKey, { sessionKey, sessionType, startedAt, drivers }) {
  const st = stateFor(serverKey);
  if (sessionKey !== st.sessionKey) {
    st.sessionKey = sessionKey;
    st.cars.clear();
    st.recent.clear();
    st.seenIds.clear();
  }
  st.sessionType = sessionType ?? null;
  st.startedAt = startedAt ?? null;
  st.names.clear();
  for (const [guid, d] of Object.entries(drivers || {})) {
    st.names.set(guid, d?.CarInfo?.DriverName || "");
  }
  // Left the server = nothing to watch any more.
  for (const guid of [...st.cars.keys()]) if (!st.names.has(guid)) st.cars.delete(guid);
}

function raceMsOf(st, at) {
  return st.startedAt ? Math.max(0, at - st.startedAt) : null;
}

// Every ET53. `inPits` is the de-flickered pit flag from the relay.
export function onTelemetry(serverKey, { guid, carId, kmh, pos, spline, inPits, offM = null, now = Date.now() }) {
  if (!guid || kmh == null) return;
  const st = stateFor(serverKey);
  if (!st.sessionKey) return;
  let c = st.cars.get(guid);
  if (!c) {
    c = { armed: false, slowSince: null, incidentId: null, movingSince: null, last: null, off: null };
    st.cars.set(guid, c);
  }
  trackOff(c, inPits ? null : offM, now);
  // A jump across the map is a teleport (back to pits, reset): start over.
  if (pos && c.last && Math.hypot(pos.X - c.last.X, pos.Z - c.last.Z) > TELEPORT_M) {
    c.slowSince = null;
    c.incidentId = null;
    c.movingSince = null;
  }
  if (pos) c.last = { X: pos.X, Z: pos.Z };
  if (inPits) {
    c.slowSince = null;
    c.incidentId = null;
    c.movingSince = null;
    return;
  }
  if (kmh > ARM_KMH) c.armed = true;

  if (c.incidentId) {
    // Already reported. Watch for it getting going again.
    if (kmh > MOVING_KMH) {
      c.movingSince ??= now;
      if (now - c.movingSince >= MOVING_HOLD_MS) {
        const id = c.incidentId;
        c.incidentId = null;
        c.slowSince = null;
        c.movingSince = null;
        prisma
          .$executeRawUnsafe(`UPDATE "Incident" SET "endedAt" = ? WHERE "id" = ?`, now, id)
          .catch(() => {});
      }
    } else {
      c.movingSince = null;
    }
    return;
  }
  if (!c.armed) return;
  if (kmh < STOP_KMH) {
    c.slowSince ??= now;
    if (now - c.slowSince >= STOP_HOLD_MS) {
      c.incidentId = randomUUID();
      insert({
        id: c.incidentId,
        server: serverKey,
        st,
        type: "stopped",
        driverGuid: guid,
        carId,
        at: c.slowSince,
        pos,
        spline,
        kmh: null,
      });
    }
  } else {
    c.slowSince = null;
  }
}

// Collisions (ET108). Field names as the server manager's own client reads
// them; the fallbacks are there because we have not seen one on our socket
// yet and the Go side might spell a field differently.
export async function onCollision(serverKey, m, { guidForCar, splineForGuid, now = Date.now() } = {}) {
  if (!m || typeof m !== "object") return;
  const st = stateFor(serverKey);
  if (!st.sessionKey) return;
  if (m.ID != null) {
    if (st.seenIds.has(m.ID)) return;
    st.seenIds.add(m.ID);
    if (st.seenIds.size > 2000) st.seenIds.clear();
  }
  const kmh = Number(m.Speed ?? m.ImpactSpeed ?? m.RelativeSpeed) || 0;
  if (kmh < (await getMinKmh())) return;

  const typeText = String(m.Type ?? "").toLowerCase();
  const guid = m.DriverGUID || (m.CarID != null ? guidForCar?.(m.CarID) : null) || null;
  let other = m.OtherDriverGUID || (m.OtherCarID != null ? guidForCar?.(m.OtherCarID) : null) || null;
  if (other === "0" || other === "") other = null;
  const withCar = typeText.includes("car") || m.Type === 10 || !!other || !!m.OtherDriverName;
  if (!guid) return;
  const wp = m.WorldPos || m.WorldPosition || m.Pos || null;
  const pos = wp ? { X: Number(wp.X ?? wp.x) || 0, Z: Number(wp.Z ?? wp.z) || 0 } : null;
  const at = m.Time ? Date.parse(m.Time) || now : now;

  // Same pair (either way round), or the same car on the same wall, just now.
  const mergeKey = withCar ? ["car", ...[guid, other || m.OtherDriverName || "?"].sort()].join("|") : `env|${guid}`;
  const mergeMs = withCar ? MERGE_CAR_MS : MERGE_ENV_MS;
  const prev = st.recent.get(mergeKey);
  if (prev && at - prev.at < mergeMs) {
    prev.at = at;
    if (kmh > prev.kmh) {
      prev.kmh = kmh;
      prisma
        .$executeRawUnsafe(`UPDATE "Incident" SET "speedKmh" = ? WHERE "id" = ?`, round1(kmh), prev.id)
        .catch(() => {});
    }
    return;
  }
  const id = randomUUID();
  st.recent.set(mergeKey, { id, at, kmh });
  if (st.recent.size > 200) {
    for (const [k, v] of st.recent) if (at - v.at > MERGE_ENV_MS) st.recent.delete(k);
  }
  insert({
    id,
    server: serverKey,
    st,
    type: withCar ? "car" : "env",
    driverGuid: guid,
    carId: m.CarID ?? null,
    otherGuid: withCar ? other : null,
    otherName: withCar ? m.OtherDriverName || null : null,
    otherCarId: m.OtherCarID ?? null,
    at,
    pos,
    spline: splineForGuid?.(guid) ?? null,
    kmh,
  });
}

const round1 = (v) => Math.round(v * 10) / 10;

function insert({ id, server, st, type, driverGuid, carId = null, otherGuid = null, otherName = null, otherCarId = null, at, pos, spline, kmh }) {
  const name = st.names.get(driverGuid) || null;
  const oName = otherName || (otherGuid ? st.names.get(otherGuid) : null) || null;
  prisma
    .$executeRawUnsafe(
      `INSERT INTO "Incident" ("id","server","sessionKey","sessionType","sessionStart","type","driverGuid","driverName","carId","otherGuid","otherName","otherCarId","atMs","raceMs","x","z","spline","speedKmh","status","createdAtMs")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?)`,
      id,
      server,
      st.sessionKey,
      st.sessionType,
      st.startedAt,
      type,
      driverGuid,
      name,
      carId,
      otherGuid,
      oName,
      otherCarId,
      at,
      raceMsOf(st, at),
      pos ? round1(pos.X) : null,
      pos ? round1(pos.Z) : null,
      spline == null ? null : Math.round(spline * 10000) / 10000,
      kmh == null ? null : round1(kmh),
      Date.now()
    )
    .catch((e) => console.warn(`[incidents] insert failed: ${e.message}`));
}

function trackOff(c, offM, now) {
  const o = (c.off ??= { since: null, candidate: null, backSince: null, metres: 0 });
  if (offM == null) {
    // In the pits, or no map to judge by: not off.
    o.since = o.candidate = o.backSince = null;
    return;
  }
  if (o.since != null) {
    o.metres = Math.max(o.metres, offM);
    if (offM < BACK_ON_M) {
      o.backSince ??= now;
      if (now - o.backSince >= ON_HOLD_MS) o.since = o.backSince = null;
    } else {
      o.backSince = null;
    }
    return;
  }
  if (offM > OFF_M) {
    o.candidate ??= now;
    if (now - o.candidate >= OFF_HOLD_MS) {
      o.since = o.candidate;
      o.candidate = null;
      o.metres = offM;
    }
  } else {
    o.candidate = null;
  }
}

// Cars off the tarmac right now, longest out first.
export function offTrackNow(serverKey) {
  const st = states.get(serverKey);
  if (!st) return [];
  const out = [];
  for (const [guid, c] of st.cars) {
    if (c.off?.since != null) out.push({ guid, name: st.names.get(guid) || null, since: c.off.since, metres: Math.round(c.off.metres * 10) / 10 });
  }
  return out.sort((a, b) => a.since - b.since);
}

// Cars stopped on track right now (reported and not moving again).
export function stoppedNow(serverKey) {
  const st = states.get(serverKey);
  if (!st) return [];
  const out = [];
  for (const [guid, c] of st.cars) {
    if (c.incidentId) out.push({ guid, name: st.names.get(guid) || null, since: c.slowSince });
  }
  return out;
}

export function sessionOf(serverKey) {
  const st = states.get(serverKey);
  return st?.sessionKey ? { key: st.sessionKey, type: st.sessionType, startedAt: st.startedAt } : null;
}

// This session's incidents, newest first. A restart in place of the same
// session gets a new start time, so anything from before it drops out.
export async function listIncidents(serverKey, limit = 150) {
  const s = sessionOf(serverKey);
  if (!s) return [];
  const from = s.startedAt ? s.startedAt - 60_000 : Date.now() - 6 * 3600_000;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "Incident" WHERE "server" = ? AND "sessionKey" = ? AND "atMs" >= ? ORDER BY "atMs" DESC LIMIT ?`,
    serverKey,
    s.key,
    from,
    limit
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    driverGuid: r.driverGuid,
    driverName: r.driverName,
    carId: r.carId == null ? null : Number(r.carId),
    otherGuid: r.otherGuid,
    otherName: r.otherName,
    otherCarId: r.otherCarId == null ? null : Number(r.otherCarId),
    at: Number(r.atMs),
    raceMs: r.raceMs == null ? null : Number(r.raceMs),
    x: r.x == null ? null : Number(r.x),
    z: r.z == null ? null : Number(r.z),
    spline: r.spline == null ? null : Number(r.spline),
    speedKmh: r.speedKmh == null ? null : Number(r.speedKmh),
    endedAt: r.endedAt == null ? null : Number(r.endedAt),
    status: r.status,
  }));
}

export async function setIncidentStatus(id, status, by) {
  if (!["open", "done"].includes(status)) throw new Error("Unknown status");
  return prisma.$executeRawUnsafe(
    `UPDATE "Incident" SET "status" = ?, "resolvedBy" = ? WHERE "id" = ?`,
    status,
    status === "done" ? by || null : null,
    id
  );
}

export const __testing = { states, stateFor, fresh, resetMinKmhCache: () => (minKmhCache = { v: DEFAULT_MIN_KMH, at: 0 }) };
