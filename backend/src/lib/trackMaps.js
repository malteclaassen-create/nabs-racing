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
import { realRoad } from "./realTracks.js";

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
// Bumped when the road is built differently, so a road.json kept from before
// is built again rather than served (2: edges cleaned up, see cleanSides;
// 3: the real circuit where there is one, see lib/realTracks.js).
const ROAD_VERSION = 3;
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

// The edge distances as the AI file has them are not always the tarmac. For a
// stretch they can measure out into a run-off instead (Bahrain T10: the road
// is 14 m wide, then up to 42 m for 70 m, then 14 m again), a single point can
// read 0 m or 85 m, and they step by a metre or two from one point to the
// next. Drawn as they are, the road grows fins, notches and wobbles. So:
//   1. short spikes either way are taken out (median over a few metres);
//   2. the road's usual width around each point is worked out (a low share of
//      the widths within 200 m, so a long run-off does not count as road);
//   3. no side is wider than that whole road, and the road no wider than a
//      little over it. Where the file reads wider than that, the road keeps
//      the width it has just before and after the stretch, and the line its
//      place across it, with neither side further out than the file says:
//      the side that ran into the run-off is the one that comes in;
//   4. what is left is smoothed a little, so steps become gentle ramps.
// No step has a hard threshold for a point to flicker across, which would put
// back the wobble this takes out.
const SPIKE_M = 10; // either way: shorter spikes are taken out
const USUAL_REACH_M = 200; // either way: what "around there" spans
const USUAL_SHARE = 0.3; // which quantile of the widths around counts as usual
const WIDER_BY = 1.15, WIDER_SLACK_M = 1; // how much wider than usual the road may be
const SMOOTH_M = 6; // either way, the last soft pass

function quantile(values, share) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * share))] : 0;
}

export function cleanSides(points, closed = true) {
  const n = points.length;
  // gap[i]: metres from point i to the next one (none past the end of a lane).
  const gap = points.map((p, i) => {
    if (!closed && i === n - 1) return Infinity;
    const q = points[(i + 1) % n];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  // The points within `reach` metres of point i along the line, i included.
  const half = Math.floor((n - 1) / 2);
  const near = new Map();
  const around = (reach) => {
    if (near.has(reach)) return near.get(reach);
    const all = points.map((_, i) => {
      const out = [i];
      for (let j = i, d = 0, k = 0; k < half && (closed || j < n - 1); k++) {
        d += gap[j];
        if (d > reach) break;
        j = (j + 1) % n;
        out.push(j);
      }
      for (let j = i, d = 0, k = 0; k < half && (closed || j > 0); k++) {
        const b = (j - 1 + n) % n;
        d += gap[b];
        if (d > reach) break;
        j = b;
        out.push(j);
      }
      return out;
    });
    near.set(reach, all);
    return all;
  };
  const rank = (v, reach, share) => around(reach).map((js) => quantile(js.map((j) => v[j]), share));
  const mean = (v, reach) => around(reach).map((js) => js.reduce((s, j) => s + v[j], 0) / js.length);

  // 1. Spikes.
  let left = rank(points.map((p) => Math.min(MAX_SIDE_M, p[2])), SPIKE_M, 0.5);
  let right = rank(points.map((p) => Math.min(MAX_SIDE_M, p[3])), SPIKE_M, 0.5);

  // 2. The usual width, changing gently along the lap.
  const width = left.map((l, i) => l + right[i]);
  const overall = quantile(width, 0.5);
  const usual = mean(rank(width, USUAL_REACH_M, USUAL_SHARE).map((w) => Math.min(1.5 * overall, w)), 50);

  // 3. No side wider than the road; the road no wider than a little over usual.
  left = left.map((s, i) => Math.min(s, usual[i] + WIDER_SLACK_M));
  right = right.map((s, i) => Math.min(s, usual[i] + WIDER_SLACK_M));
  // How wide to draw it: the middle of the nearby widths, so a run-off that
  // comes and goes every few metres does not make the road breathe.
  const total = mean(
    rank(left.map((s, i) => Math.min(s + right[i], usual[i] * WIDER_BY + WIDER_SLACK_M)), 30, 0.5),
    15,
  ).map((t, i) => Math.min(t, left[i] + right[i]));
  // Where the file was believed as it is ("pinned"), and for every other
  // point the nearest pinned points before and after it.
  const pinned = total.map((t, i) => width[i] - t < 0.5);
  if (pinned.some(Boolean) && !pinned.every(Boolean)) {
    const share = left.map((s, i) => (total[i] > 0 ? Math.min(1, s / total[i]) : 0.5));
    const lerp = (v, p, q, t) => v[p] + (v[q] - v[p]) * t;
    const want = [];
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      let p = i, dp = 0;
      while (p != null && !pinned[p]) {
        if (!closed && p === 0) p = null;
        else { p = (p - 1 + n) % n; dp += gap[p]; }
      }
      let q = i, dq = 0;
      while (q != null && !pinned[q]) {
        if (!closed && q === n - 1) q = null;
        else { dq += gap[q]; q = (q + 1) % n; }
      }
      if (p == null) { p = q; dp = 0; dq = 1; }
      if (q == null) { q = p; dq = 0; dp = 1; }
      const t = dp / (dp + dq || 1);
      want.push([i, lerp(total, p, q, t), lerp(share, p, q, t)]);
    }
    // Across such a stretch the road keeps the width it has either side
    // (a little more is fine), and the line its place across it.
    for (const [i, w] of want) total[i] = Math.min(total[i], w + WIDER_SLACK_M / 2);
    // The left side may be anywhere from (total - right) to left: both sides
    // within what the file says. Start from the line's place across the road
    // and smooth within those bounds.
    const lo = total.map((t, i) => Math.max(0, t - right[i]));
    const hi = total.map((t, i) => Math.min(left[i], t));
    const clamp = (v, i) => Math.min(hi[i], Math.max(lo[i], v));
    let x = left.map(clamp);
    for (const [i, , f] of want) x[i] = clamp(f * total[i], i);
    for (let k = 0; k < 20; k++) x = mean(x, 15).map(clamp);
    left = x;
  } else {
    left = left.map((s, i) => Math.min(s, total[i]));
  }

  // 4. The apexes.
  let right2 = left.map((v, i) => total[i] - v);
  if (closed) [left, right2] = apexShift(points, gap, left, right2);

  // 5. A last soft pass.
  return { left: mean(left, SMOOTH_M), right: mean(right2, SMOOTH_M) };
}

// The AI line takes the apex: on a well-made track it passes 1-2 m from the
// inside edge at every proper corner (Monza, Imola, Jeddah: never more than
// 1.8 m; Spa, Suzuka, Silverstone: never more than 4 m). Some files put the
// road somewhere else there: Bahrain's has the line 11-13 m from the inside
// at T1, T2, T10 and T14, counting the paved run-off inside those corners as
// road and drawing the cars far from an apex they really took. Where the gap
// at a corner's apex is that big, the road is slid across (same width) until
// the apex is APEX_M from the line, easing back over APEX_EASE_M either side.
const APEX_TURN = 0.12; // rad of heading change over APEX_SPAN_M either way: a proper corner
const APEX_SPAN_M = 9;
const APEX_MIN_LEN_M = 30; // shorter runs are the bend between two corners
const APEX_FAR_M = 5; // gaps up to this are left as they are
const APEX_M = 1.2;
const APEX_EASE_M = 50;

function apexShift(points, gap, left, right) {
  const n = points.length;
  const step = gap.reduce((s, g) => s + g, 0) / n || 1;
  const k = Math.max(1, Math.round(APEX_SPAN_M / step));
  if (n < 4 * k) return [left, right];
  // +1: a left-hander as the edges are laid out (the inside is `left`),
  // -1: a right-hander, 0: not a corner.
  const turn = points.map((b, i) => {
    const a = points[(i - k + n) % n], c = points[(i + k) % n];
    const d1x = b[0] - a[0], d1z = b[1] - a[1], d2x = c[0] - b[0], d2z = c[1] - b[1];
    const len = Math.hypot(d1x, d1z) * Math.hypot(d2x, d2z) || 1;
    const angle = Math.asin(Math.max(-1, Math.min(1, (d1x * d2z - d1z * d2x) / len)));
    if (Math.abs(angle) < APEX_TURN) return 0;
    // The bend points to the inside; roadFromAi pushes `left` along (dz, -dx).
    const ax = a[0] + c[0] - 2 * b[0], az = a[1] + c[1] - 2 * b[1];
    return ax * (c[1] - a[1]) - az * (c[0] - a[0]) > 0 ? 1 : -1;
  });
  if (turn.every((t) => t !== 0) || turn.every((t) => t === 0)) return [left, right];

  // Corners as runs of one sign, begun just after a straight bit.
  const start = (turn.findIndex((t) => t === 0) + 1) % n;
  // Metres to move the road towards the left (toLeft) and the right
  // (toRight). Kept apart and added at the end: where a left-hander's slide
  // eases out into a right-hander's, the two blend instead of meeting in a
  // step.
  const toLeft = new Array(n).fill(0), toRight = new Array(n).fill(0);
  const put = (i, sign, v) => {
    const arr = sign > 0 ? toLeft : toRight;
    if (v > arr[i]) arr[i] = v;
  };
  const ease = (from, to, sign, amount) => {
    for (let i = from, j = 0; j < n; j++) {
      put(i, sign, amount);
      if (i === to) break;
      i = (i + 1) % n;
    }
    for (const dir of [-1, 1]) {
      let i = dir < 0 ? from : to, d = 0;
      for (let j = 0; j < n; j++) {
        const next = (i + dir + n) % n;
        d += gap[dir < 0 ? next : i];
        if (d >= APEX_EASE_M) break;
        i = next;
        put(i, sign, amount * (1 - d / APEX_EASE_M));
      }
    }
  };
  for (let s = 0; s < n; ) {
    const i = (start + s) % n;
    if (!turn[i]) { s++; continue; }
    let len = 0, apex = i, e = s;
    while (e + 1 < n && turn[(start + e + 1) % n] === turn[i]) {
      len += gap[(start + e) % n];
      e++;
      const j = (start + e) % n;
      if ((turn[i] > 0 ? left[j] : right[j]) < (turn[i] > 0 ? left[apex] : right[apex])) apex = j;
    }
    const inside = turn[i] > 0 ? left[apex] : right[apex];
    if (len >= APEX_MIN_LEN_M && inside > APEX_FAR_M) ease(i, (start + e) % n, turn[i], inside - APEX_M);
    s = e + 1;
  }
  // Slide: what one side loses the other gains, and no side goes below 0.3 m.
  const outL = left.slice(), outR = right.slice();
  for (let i = 0; i < n; i++) {
    const want = toLeft[i] - toRight[i];
    if (!want) continue;
    const moved = want > 0 ? Math.min(want, Math.max(0, left[i] - 0.3)) : -Math.min(-want, Math.max(0, right[i] - 0.3));
    outL[i] = left[i] - moved;
    outR[i] = right[i] + moved;
  }
  return [outL, outR];
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
  const sides = blank
    ? { left: new Array(n).fill(fallbackHalfWidth), right: new Array(n).fill(fallbackHalfWidth) }
    : cleanSides(points, closed);
  const left = [], right = [];
  let since = Infinity;
  for (let i = 0; i < n; i++) {
    const [x, z] = points[i];
    const sl = sides.left[i], sr = sides.right[i];
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

// `stale`: a road.json built the old way will do too (when the server cannot be
// reached to build it again).
export function readTrackRoad(track, layout, { stale = false } = {}) {
  const file = join(dirFor(track, layout), "road.json");
  if (!existsSync(file)) return null;
  try {
    const road = JSON.parse(readFileSync(file, "utf8"));
    return (stale || road?.v === ROAD_VERSION) && road?.track?.left?.length ? road : null;
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
  if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return readTrackRoad(track, layout, { stale: true });

  const enc = encodeURIComponent;
  for (const server of LIVE_SERVERS) {
    const base = `${String(server.origin).replace(/\/+$/, "")}/content/tracks`;
    const folders = layout ? [`${base}/${enc(track)}/${enc(layout)}`, `${base}/${enc(track)}`] : [`${base}/${enc(track)}`];
    for (const folder of folders) {
      const points = parseFastLane(await get(`${folder}/ai/fast_lane.ai`, "buf"));
      // The real circuit when there is one that fits (lib/realTracks.js),
      // else the edges from the AI file.
      const lane = realRoad(points) || roadFromAi(points);
      if (!lane) continue;
      const pit = roadFromAi(parseFastLane(await get(`${folder}/ai/pit_lane.ai`, "buf")), { closed: false, fallbackHalfWidth: 3 });
      const road = { v: ROAD_VERSION, track: lane, pit };
      const dir = dirFor(track, layout);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "road.json"), JSON.stringify(road));
      misses.delete(key);
      return road;
    }
  }

  misses.set(key, Date.now());
  return readTrackRoad(track, layout, { stale: true });
}

// ---- The lap as a line, for the live map -------------------------------------
//
// The live map colours the circuit by sector, and for that it needs the lap as
// a line rather than as a picture: map.png is a stroke with no start and no
// direction. The AI line is that line, and its points run in the order
// NormalisedSplinePos counts in: the first point is the start of the lap.
//
// It is the AI line itself, NOT the middle between the road's two edges. The
// map.png is drawn as a stroke around the AI line (see above), and the AI line
// does not run down the middle of the tarmac — it hugs one side for stretches,
// a metre or three. The midpoint of the edges is the better "middle of the
// road", but it landed on the stroke's edge, a visible step beside the band the
// cars are drawn on (2026-10-11). A point every few metres is plenty for a
// stroke on a map a few hundred pixels across.
const LINE_STEP_M = 8;

// The AI points ([x, z, left, right]) as a thinned [x, z] polyline.
export function lapLine(points, step = LINE_STEP_M) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const out = [];
  let since = 0;
  let prev = null;
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    if (prev) since += Math.hypot(x - prev[0], z - prev[1]);
    prev = points[i];
    if (i > 0 && since < step) continue;
    since = 0;
    out.push([round1(x), round1(z)]);
  }
  return out.length >= 3 ? out : null;
}

function readTrackLine(track, layout) {
  const file = join(dirFor(track, layout), "line.json");
  if (!existsSync(file)) return null;
  try {
    const line = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(line) && line.length >= 3 ? line : null;
  } catch {
    return null;
  }
}

// Fetched once from the league's servers and kept beside the map, from the same
// files and in the same order as the road. Its own file rather than a field of
// road.json: that one goes out whole to the telemetry page, which has no use
// for the line.
async function ensureTrackLine(track, layout) {
  const have = readTrackLine(track, layout);
  if (have) return have;

  const key = `line:${track}|${layout || ""}`;
  const missedAt = misses.get(key);
  if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null;

  const enc = encodeURIComponent;
  for (const server of LIVE_SERVERS) {
    const base = `${String(server.origin).replace(/\/+$/, "")}/content/tracks`;
    const folders = layout ? [`${base}/${enc(track)}/${enc(layout)}`, `${base}/${enc(track)}`] : [`${base}/${enc(track)}`];
    for (const folder of folders) {
      const line = lapLine(parseFastLane(await get(`${folder}/ai/fast_lane.ai`, "buf")));
      if (!line) continue;
      const dir = dirFor(track, layout);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "line.json"), JSON.stringify(line));
      misses.delete(key);
      return line;
    }
  }

  misses.set(key, Date.now());
  return null;
}

// One fetch per track however many people open the live page at once: the
// first visitor's request is shared with everyone who arrives while it runs,
// and a line once found is kept for the life of the process (it never
// changes). A miss is not kept here; ensureTrackLine remembers those itself.
const laps = new Map(); // "track|layout" -> line | Promise<line|null>

export async function liveCentreLine(track, layout) {
  if (!track) return null;
  const key = `${track}|${layout || ""}`;
  const have = laps.get(key);
  if (have) return have;
  const job = ensureTrackLine(track, layout)
    .catch(() => null)
    .then((line) => {
      if (line) laps.set(key, line);
      else laps.delete(key);
      return line;
    });
  laps.set(key, job);
  return job;
}
