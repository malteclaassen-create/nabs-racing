// ---------------------------------------------------------------------------
// The real outline of a track, and the arithmetic that puts a world position on
// it.
//
// Assetto Corsa ships every track with an overhead map — `map.png` — and a
// `map.ini` that says how to place a world coordinate on it:
//
//     px = (x + X_OFFSET) / SCALE_FACTOR
//     py = (z + Z_OFFSET) / SCALE_FACTOR
//
// The league's server manager serves both publicly, and the live page already
// draws the cars on them (services/liveTiming.js). The telemetry laps record
// the same world coordinates the live page uses for the cars, so the same two
// files turn two recorded laps into two racing lines inside the real track
// edges — where they are, rather than floating in white space.
//
// The live page fetches these per RUNNING session and holds them in memory.
// This is the other half: any track that has laps, whether or not a server is
// on it right now, cached on disk beside the other things the league keeps
// (results archive, telemetry laps). A track map is 100-200 KB and never
// changes, so it is fetched once and kept.
//
// A track without a published map is a normal outcome, not a failure: the
// comparison falls back to drawing the lap's own outline, which is what it did
// before any of this existed. The miss is remembered for a while so a track
// nobody serves is not re-fetched on every page load.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { DATA_ROOT } from "./dataDirs.js";
import { LIVE_SERVERS } from "./liveServers.js";

// ---------------------------------------------------------------------------
// The map.png is NOT the road. Assetto Corsa renders it from the track's AI
// line drawn as one constant-width stroke (measured: 14.8 m everywhere at Spa,
// hairpin and Kemmel straight alike), so a lap drawn "inside" it always looks
// centred and nothing about the real kerbs can be read off it.
//
// The real edges are in the same track folder: `ai/fast_lane.ai` holds the AI
// line as a list of world points and, for every point, the distance to the
// left and right edge of the tarmac. The server manager serves it beside the
// map. Offsetting each point sideways by those two distances gives the road as
// a polygon in the very coordinates the laps are recorded in, so the lines sit
// on the tarmac they actually drove on — no calibration in between.
//
// Binary layout (version 7, the one every track ships):
//   int32 version, int32 count, int32, int32
//   count × { float x, y, z, length; int32 id }            (20 bytes)
//   int32 count
//   count × 18 floats: speed, gas, brake, latG, radius, sideLeft, sideRight,
//     camber, direction, normal×3, length, forward×3, tag, grade  (72 bytes)
// ---------------------------------------------------------------------------

export const TRACK_MAPS_DIR = join(DATA_ROOT, "track-maps");

const PNG_SIG = "89504e47";
const FETCH_MS = 8000;
// How long a track that answered with nothing is left alone. Long enough that
// a page can be opened repeatedly without hammering the server manager, short
// enough that a track added upstream today is picked up today.
const MISS_TTL_MS = 60 * 60 * 1000;
const misses = new Map(); // key -> at

const safe = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

function dirFor(track, layout) {
  return join(TRACK_MAPS_DIR, layout ? `${safe(track)}--${safe(layout)}` : safe(track));
}

// The same fields the live page's parser takes, from the same ini.
export function parseMapIni(text) {
  if (!text) return null;
  const num = (re) => {
    const m = text.match(re);
    return m ? parseFloat(m[1]) : null;
  };
  const width = num(/WIDTH\s*=\s*([\d.]+)/i);
  const height = num(/HEIGHT\s*=\s*([\d.]+)/i);
  const scaleFactor = num(/SCALE_FACTOR\s*=\s*([\d.]+)/i);
  if (!width || !height || !scaleFactor) return null;
  return {
    width,
    height,
    scaleFactor,
    xOffset: num(/X_OFFSET\s*=\s*(-?[\d.]+)/i) ?? 0,
    zOffset: num(/Z_OFFSET\s*=\s*(-?[\d.]+)/i) ?? 0,
    padding: num(/PADDING\s*=\s*(-?[\d.]+)/i) ?? 0,
  };
}

async function get(url, kind) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return kind === "buf" ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

// What is already on disk for this track, or null.
export function readTrackMap(track, layout) {
  const dir = dirFor(track, layout);
  const ini = join(dir, "map.ini");
  const png = join(dir, "map.png");
  if (!existsSync(ini) || !existsSync(png)) return null;
  try {
    const calib = JSON.parse(readFileSync(ini, "utf8"));
    return calib?.scaleFactor ? { calib, png } : null;
  } catch {
    return null;
  }
}

// Fetch it if we do not have it. Tries every server the league runs and both
// spellings of the path, the way the live page does — the same track can sit
// under its config folder or beside it depending on how it was installed.
export async function ensureTrackMap(track, layout) {
  const have = readTrackMap(track, layout);
  if (have) return have;

  const key = `${track}|${layout || ""}`;
  const missedAt = misses.get(key);
  if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null;

  const enc = encodeURIComponent;
  for (const server of LIVE_SERVERS) {
    const base = `${String(server.origin).replace(/\/+$/, "")}/content/tracks`;
    const cfg = layout ? `${base}/${enc(track)}/${enc(layout)}` : `${base}/${enc(track)}`;
    const plain = `${base}/${enc(track)}`;

    let calib = null;
    for (const u of [`${cfg}/data/map.ini`, `${cfg}/map.ini`, `${plain}/data/map.ini`, `${plain}/map.ini`]) {
      calib = parseMapIni(await get(u, "text"));
      if (calib) break;
    }
    if (!calib) continue;

    let png = null;
    for (const u of [`${cfg}/map.png`, `${cfg}/data/map.png`, `${plain}/map.png`]) {
      const buf = await get(u, "buf");
      if (buf && buf.length > 1000 && buf.slice(0, 4).toString("hex") === PNG_SIG) {
        png = buf;
        break;
      }
    }
    if (!png) continue;

    const dir = dirFor(track, layout);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "map.png"), png);
    writeFileSync(join(dir, "map.ini"), JSON.stringify(calib));
    misses.delete(key);
    return { calib, png: join(dir, "map.png") };
  }

  misses.set(key, Date.now());
  return null;
}

// ---- The road itself, from the AI line -------------------------------------

const AI_VERSION = 7;
const AI_HEADER = 16, AI_POINT = 20, AI_EXTRA = 72;
// Metres between kept points. The AI line has one every ~1.5 m; the road's
// edges bend gently enough that 3 m loses nothing a screen can show, and it
// keeps a 7 km circuit under 40 KB.
const ROAD_STEP_M = 3;
// The widest half-road worth believing. Some AI files measure the edge into
// a run-off or a paddock for a stretch (Singapore: 90 m a side for 200 m),
// which would draw a fin the size of the circuit's infield.
const MAX_SIDE_M = 20;

// The AI file as points: [x, z, sideLeft, sideRight], in metres. Null when the
// bytes are not an AI file we understand.
export function parseFastLane(buf) {
  if (!buf || buf.length < AI_HEADER + 4) return null;
  const version = buf.readInt32LE(0);
  const count = buf.readInt32LE(4);
  if (version !== AI_VERSION || count < 3 || count > 200000) return null;
  const extraAt = AI_HEADER + count * AI_POINT;
  if (buf.length < extraAt + 4) return null;
  const extraCount = buf.readInt32LE(extraAt);
  if (extraCount !== count || buf.length < extraAt + 4 + count * AI_EXTRA) return null;
  const points = new Array(count);
  for (let i = 0; i < count; i++) {
    const p = AI_HEADER + i * AI_POINT;
    const e = extraAt + 4 + i * AI_EXTRA;
    const x = buf.readFloatLE(p), z = buf.readFloatLE(p + 8);
    const left = buf.readFloatLE(e + 20), right = buf.readFloatLE(e + 24);
    if (![x, z, left, right].every(Number.isFinite)) return null;
    points[i] = [x, z, Math.max(0, left), Math.max(0, right)];
  }
  return points;
}

// The two edges of the tarmac, as polylines in world metres. Each AI point is
// pushed sideways by its two edge distances; which way is "left" was settled
// against real laps (every recorded position of two Spa laps stays between the
// edges this way round, and dozens fall off the road the other way).
//
// `closed` says whether the line is a loop (the lap) or has two ends (the pit
// lane), so the drawer knows whether to join the last point to the first.
//
// `fallbackHalfWidth` stands in where the file carries no edge distances at
// all — pit lane files ship with zeros — so the lane still draws, at a plain
// width, rather than as a hairline.
export function roadFromAi(points, { closed = true, step = ROAD_STEP_M, fallbackHalfWidth = 0 } = {}) {
  if (!points || points.length < 3) return null;
  const blank = points.every((p) => p[2] + p[3] < 0.5);
  if (blank && !fallbackHalfWidth) return null;
  const n = points.length;
  const left = [], right = [];
  let since = Infinity;
  for (let i = 0; i < n; i++) {
    const [x, z] = points[i];
    const sl = Math.min(MAX_SIDE_M, blank ? fallbackHalfWidth : points[i][2]);
    const sr = Math.min(MAX_SIDE_M, blank ? fallbackHalfWidth : points[i][3]);
    const prev = points[i === 0 ? (closed ? n - 1 : 0) : i - 1];
    const next = points[i === n - 1 ? (closed ? 0 : n - 1) : i + 1];
    if (i > 0) since += Math.hypot(x - prev[0], z - prev[1]);
    const last = !closed && i === n - 1;
    if (since < step && !last) continue;
    since = 0;
    const dx = next[0] - prev[0], dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len; // +side = sideLeft
    left.push([round1(x + nx * sl), round1(z + nz * sl)]);
    right.push([round1(x - nx * sr), round1(z - nz * sr)]);
  }
  if (left.length < 3) return null;
  return { closed, left, right };
}

const round1 = (v) => Math.round(v * 10) / 10;

export function readTrackRoad(track, layout) {
  const file = join(dirFor(track, layout), "road.json");
  if (!existsSync(file)) return null;
  try {
    const road = JSON.parse(readFileSync(file, "utf8"));
    return road?.track?.left?.length ? road : null;
  } catch {
    return null;
  }
}

// { track: {closed, left, right}, pit: {...} | null } — fetched once from the
// league's servers and kept beside the map. Same paths and the same miss
// memory as the map: a layout keeps its own ai folder when its line differs
// from the base track's, and falls back to the base track's otherwise.
export async function ensureTrackRoad(track, layout) {
  const have = readTrackRoad(track, layout);
  if (have) return have;

  const key = `road:${track}|${layout || ""}`;
  const missedAt = misses.get(key);
  if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null;

  const enc = encodeURIComponent;
  for (const server of LIVE_SERVERS) {
    const base = `${String(server.origin).replace(/\/+$/, "")}/content/tracks`;
    const folders = layout ? [`${base}/${enc(track)}/${enc(layout)}`, `${base}/${enc(track)}`] : [`${base}/${enc(track)}`];
    for (const folder of folders) {
      const lane = roadFromAi(parseFastLane(await get(`${folder}/ai/fast_lane.ai`, "buf")));
      if (!lane) continue;
      const pit = roadFromAi(parseFastLane(await get(`${folder}/ai/pit_lane.ai`, "buf")), { closed: false, fallbackHalfWidth: 3 });
      const road = { track: lane, pit };
      const dir = dirFor(track, layout);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "road.json"), JSON.stringify(road));
      misses.delete(key);
      return road;
    }
  }

  misses.set(key, Date.now());
  return null;
}
