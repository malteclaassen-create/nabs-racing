// ---------------------------------------------------------------------------
// The real circuit under a track's AI line.
//
// The edge distances in a track mod's AI file say where its tarmac ends, run-
// off and all, and some say it badly: Bahrain's puts the inside edge of T10
// 11 m from a line that in reality runs along the kerb. For the circuits in
// data/real-tracks (the TUM racetrack-database: centre line from
// OpenStreetMap, widths from satellite images) the real edges are drawn
// instead.
//
// The data is in its own metres with its own origin and orientation, so it is
// laid over the AI line first: turned, moved, possibly mirrored (the game's
// x/z is the other way round from a map's x/y) and scaled, whichever fits the
// line best. It is used only when that fit is good: a mod built to scale, of
// the same layout. Anything else (another layout of the same place, a fantasy
// track, a mod that is not to scale) keeps the AI file's edges.
//
// Everything is in metres; pure functions apart from reading the CSVs.
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "real-tracks");

const LENGTH_SHARE = 0.08; // a lap this much longer or shorter is another layout
const SAMPLE_M = 4; // the AI line, a point every this many metres
const DENSE_M = 2; // the real centre line, for the nearest-point lookups
const EDGE_STEP_M = 2.5; // the drawn edges, a point every this many metres
const CELL = 10;
// What counts as a fit: the scale of a mod built to it, how close the AI line
// stays to the real centre on average (it is a racing line, so not on it),
// and how much of the AI line is on the real road (a wheel's width over the
// edge still counts).
const MAX_SCALE_OFF = 0.03;
const MAX_MEAN_M = 4;
const MIN_ON_ROAD = 0.93;
const EDGE_SLACK_M = 1.5;
const MAX_OFF_RUN_M = 70; // longer and the layout itself differs (a chicane taken out)
const NUDGE_SLACK_M = 0.3; // the AI line may be this far over the edge (kerbs)
const NUDGE_EASE_M = 40;

let cache = null;

// Every circuit in data/real-tracks: { name, centre: [[x, y]], right: [m],
// left: [m], length }.
export function loadRealTracks(dir = DIR) {
  if (cache && dir === DIR) return cache;
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".csv"));
  } catch {
    files = [];
  }
  const out = files.map((f) => parseRealTrack(f.replace(/\.csv$/, ""), readFileSync(join(dir, f), "utf8"))).filter(Boolean);
  if (dir === DIR) cache = out;
  return out;
}

export function parseRealTrack(name, text) {
  const rows = String(text)
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => l.split(",").map(Number))
    .filter((r) => r.length >= 4 && r.every(Number.isFinite));
  if (rows.length < 20) return null;
  return {
    name,
    centre: rows.map((r) => [r[0], r[1]]),
    right: rows.map((r) => r[2]),
    left: rows.map((r) => r[3]),
    length: loopLength(rows),
  };
}

function loopLength(pts) {
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

// A loop resampled to a point every `step` metres, carrying `extra` (arrays
// with one value per point) along, linearly.
function resample(pts, step, extra = []) {
  const out = [], vals = extra.map(() => []);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      extra.forEach((v, e) => vals[e].push(v[i] + (v[(i + 1) % n] - v[i]) * t));
    }
  }
  return { pts: out, vals };
}

// A loop thinned to a point every `step` metres.
function thin(pts, step) {
  const out = [pts[0]];
  let since = 0;
  for (let i = 1; i < pts.length; i++) {
    since += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (since >= step) { out.push(pts[i]); since = 0; }
  }
  return out;
}

// Nearest of `pts` to (x, y): [index, distance], or [-1, FAR_M] when none is
// within FAR_M.
const FAR_M = 50;
function nearestOf(pts) {
  const key = (i, j) => (i + 100000) * 200000 + (j + 100000);
  const cells = new Map();
  pts.forEach(([x, y], i) => {
    const k = key(Math.floor(x / CELL), Math.floor(y / CELL));
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(i);
  });
  const reach = Math.ceil(FAR_M / CELL);
  return (x, y) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    let best = -1, bestD = FAR_M * FAR_M;
    // The 3x3 cells around first; further out only when nothing is that close.
    for (const r of [1, reach]) {
      for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cy - r; j <= cy + r; j++) {
          const list = cells.get(key(i, j));
          if (!list) continue;
          for (const k of list) {
            const d = (pts[k][0] - x) ** 2 + (pts[k][1] - y) ** 2;
            if (d < bestD) { bestD = d; best = k; }
          }
        }
      }
      if (best >= 0 && bestD <= CELL * CELL) break;
    }
    return [best, Math.sqrt(bestD)];
  };
}

// The game's point (x, z) in the real circuit's frame: mirrored (m = ±1 on z),
// turned by `angle`, scaled by `s`, moved by (tx, ty). And back.
const toReal = ({ m, angle, s, tx, ty }, [x, z]) => {
  const c = Math.cos(angle), n = Math.sin(angle), zz = m * z;
  return [s * (c * x - n * zz) + tx, s * (n * x + c * zz) + ty];
};
const toGame = ({ m, angle, s, tx, ty }, [x, y]) => {
  const c = Math.cos(angle), n = Math.sin(angle);
  const u = (x - tx) / s, v = (y - ty) / s;
  return [c * u + n * v, m * (-n * u + c * v)];
};

const mean2 = (pts) => {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
};

// How well `line` (game metres) lies on `real` under the transform `fit`:
// mean distance to the real centre (capped) and the share on the road.
function measure(fit, line, real, near) {
  let sum = 0;
  const off = line.map((p) => {
    const [x, y] = toReal(fit, p);
    const [k, d] = near(x, y);
    sum += Math.min(d, FAR_M);
    return k < 0 || d > Math.max(real.left[k], real.right[k]) + EDGE_SLACK_M;
  });
  // The longest stretch of line off the road, in points (around the lap).
  let longest = 0;
  if (off.every(Boolean)) longest = off.length;
  else {
    const start = off.indexOf(false);
    for (let s = 0, run = 0; s < off.length; s++) {
      run = off[(start + s) % off.length] ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  return { mean: sum / line.length, onRoad: 1 - off.filter(Boolean).length / line.length, offRun: longest };
}

// The best way to lay the AI line (game metres) over one real circuit.
export function fitRealTrack(line, real) {
  const dense = resample(real.centre, DENSE_M, [real.left, real.right]);
  const centre = dense.pts;
  const near = nearestOf(centre);
  const lanes = { left: dense.vals[0], right: dense.vals[1] };
  const target = mean2(centre);
  const few = line.filter((_, i) => i % 3 === 0);
  const scoreOf = (fit) => measure(fit, few, lanes, near).mean;

  // Rough: every 5 degrees, both ways round, centres together.
  let best = null;
  for (const m of [1, -1]) {
    for (let deg = 0; deg < 360; deg += 5) {
      const angle = (deg * Math.PI) / 180;
      const fit0 = { m, angle, s: 1, tx: 0, ty: 0 };
      const c = mean2(line.map((p) => toReal(fit0, p)));
      const fit = { ...fit0, tx: target[0] - c[0], ty: target[1] - c[1] };
      const score = scoreOf(fit);
      if (!best || score < best.score) best = { fit, score };
    }
  }

  // Fine: each AI point against its nearest real centre point, solved for the
  // turn, scale and shift that bring them closest (least squares).
  let fit = best.fit;
  for (let it = 0; it < 40; it++) {
    const src = [], dst = [];
    for (const p of line) {
      const q = toReal(fit, p);
      const [k, d] = near(q[0], q[1]);
      if (k >= 0 && d < 30) { src.push([p[0], fit.m * p[1]]); dst.push(centre[k]); }
    }
    if (src.length < 10) break;
    const ms = mean2(src), md = mean2(dst);
    let sxx = 0, sxy = 0, ss = 0;
    for (let i = 0; i < src.length; i++) {
      const ax = src[i][0] - ms[0], ay = src[i][1] - ms[1];
      const bx = dst[i][0] - md[0], by = dst[i][1] - md[1];
      sxx += ax * bx + ay * by;
      sxy += ax * by - ay * bx;
      ss += ax * ax + ay * ay;
    }
    const angle = Math.atan2(sxy, sxx), s = Math.hypot(sxx, sxy) / (ss || 1);
    const c = Math.cos(angle), n = Math.sin(angle);
    fit = { m: fit.m, angle, s, tx: md[0] - s * (c * ms[0] - n * ms[1]), ty: md[1] - s * (n * ms[0] + c * ms[1]) };
  }
  return { fit, ...measure(fit, line, lanes, near) };
}

// The AI points ([x, z, ...] in game metres, a closed lap) -> the real
// circuit's edges in game metres, { closed, left, right, source }, or null
// when no real circuit fits.
export function realRoad(aiPoints, tracks = loadRealTracks()) {
  if (!aiPoints || aiPoints.length < 20 || !tracks.length) return null;
  const line = thin(aiPoints.map((p) => [p[0], p[1]]), SAMPLE_M);
  if (line.length < 20) return null;
  const length = loopLength(line);
  let best = null;
  for (const real of tracks) {
    if (Math.abs(real.length - length) > LENGTH_SHARE * length) continue;
    const r = fitRealTrack(line, real);
    const good =
      Math.abs(r.fit.s - 1) <= MAX_SCALE_OFF &&
      r.mean <= MAX_MEAN_M &&
      r.onRoad >= MIN_ON_ROAD &&
      r.offRun * SAMPLE_M <= MAX_OFF_RUN_M;
    if (good && (!best || r.mean < best.mean)) best = { ...r, real };
  }
  if (!best) return null;
  return { ...edgesOf(best.real, best.fit, line), source: best.real.name };
}

// The real circuit's two edges, laid into the game's frame. The centre line is
// smooth (Catmull-Rom between its points) and the widths change linearly.
//
// The real centre line is from OpenStreetMap and the mod is its own survey, so
// they part by a few metres here and there (Spa: up to 6 m for 40 m). Where
// the AI line runs off the real road the road is moved across (same width,
// same shape) until the line is back on it, easing back over NUDGE_EASE_M: the
// laps are recorded in the mod, and a lap drawn beside the road is worse than
// a road a few metres from its surveyed place.
function edgesOf(real, fit, line) {
  const P = real.centre, n = P.length;
  const at = (i) => P[((i % n) + n) % n];
  const centre = [], left = [], right = [];
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const k = Math.max(1, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / EDGE_STEP_M));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      centre.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
      left.push(real.left[i] + (real.left[(i + 1) % n] - real.left[i]) * t);
      right.push(real.right[i] + (real.right[(i + 1) % n] - real.right[i]) * t);
    }
  }
  const m = centre.length;
  const normal = centre.map((_, i) => {
    const a = centre[(i - 1 + m) % m], b = centre[(i + 1) % m];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return [dy / len, -dx / len]; // to the right of the way the points run
  });

  // How far each point of the road has to move right (+) or left (-).
  const toRight = new Array(m).fill(0), toLeft = new Array(m).fill(0);
  if (line?.length) {
    const near = nearestOf(centre);
    const ease = Math.max(1, Math.round(NUDGE_EASE_M / EDGE_STEP_M));
    for (const p of line) {
      const q = toReal(fit, p);
      const [k] = near(q[0], q[1]);
      if (k < 0) continue;
      const o = (q[0] - centre[k][0]) * normal[k][0] + (q[1] - centre[k][1]) * normal[k][1];
      const over = o > 0 ? o - right[k] - NUDGE_SLACK_M : -o - left[k] - NUDGE_SLACK_M;
      if (over <= 0) continue;
      const arr = o > 0 ? toRight : toLeft;
      for (let d = -ease; d <= ease; d++) {
        const j = (k + d + m) % m, v = over * (1 - Math.abs(d) / (ease + 1));
        if (v > arr[j]) arr[j] = v;
      }
    }
  }

  const L = [], R = [];
  for (let i = 0; i < m; i++) {
    const [rx, ry] = normal[i];
    const shift = toRight[i] - toLeft[i];
    const c = [centre[i][0] + rx * shift, centre[i][1] + ry * shift];
    const r = toGame(fit, [c[0] + rx * right[i], c[1] + ry * right[i]]);
    const l = toGame(fit, [c[0] - rx * left[i], c[1] - ry * left[i]]);
    L.push([round1(l[0]), round1(l[1])]);
    R.push([round1(r[0]), round1(r[1])]);
  }
  return { closed: true, left: L, right: R };
}

const round1 = (v) => Math.round(v * 10) / 10;
