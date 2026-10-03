// ---------------------------------------------------------------------------
// Does the road from the track's AI line match the circuit the laps drove?
//
// Usually yes, to the metre. But a track mod can ship an AI line from an older
// version of its circuit: Singapore's still runs through the stadium section
// (T16-19) that the 2023 layout replaced with a straight. Drawn as it is, the
// road turns away and both racing lines carry straight on across the infield.
//
// So the road is checked against the laps before it is drawn:
//   - a long stretch of lap that is nowhere near the road gets a strip of road
//     of the circuit's usual width laid under it ("patches");
//   - a long stretch of road that no lap comes near is left out ("keep");
//   - where the two meet, only the outline of both together is drawn ("show").
// A short trip off the road is a driver in the run-off and stays as it is.
// When most of the lap is off the road, the road is not this circuit at all
// and is dropped ("useless").
//
// Everything here is in world metres, [x, z]; pure functions, tested.
// ---------------------------------------------------------------------------

const CELL = 20; // m, grid cell for nearest-point lookups
const SLACK_M = 6; // past the edge and still "on" it: kerbs, a wheel on the grass
const NEAR_M = 15; // past the edge and still "visited" by a lap
const MIN_RUN_M = 120; // shorter disagreements are driving, not a different circuit
const JOIN_M = 25; // a patch reaches this far onto the road at each end
const USELESS_SHARE = 0.4;
const INSIDE_M = 0.5; // this far inside the other surface, an edge point is not an edge

function grid(points) {
  const cells = new Map();
  points.forEach(([x, z], i) => {
    const k = `${Math.floor(x / CELL)}|${Math.floor(z / CELL)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(i);
  });
  return cells;
}

// Index and distance of the nearest of `points` (gridded as `cells`) within
// `reach` metres of (x, z), or null.
function nearest(cells, points, x, z, reach) {
  const r = Math.ceil(reach / CELL);
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = null, bestD = reach;
  for (let i = cx - r; i <= cx + r; i++) {
    for (let j = cz - r; j <= cz + r; j++) {
      for (const k of cells.get(`${i}|${j}`) || []) {
        const d = Math.hypot(points[k][0] - x, points[k][1] - z);
        if (d <= bestD) { bestD = d; best = k; }
      }
    }
  }
  return best == null ? null : { i: best, d: bestD };
}

// Runs of `true` in a flag array at least `minLen` metres long along `pts`, as
// [from, to] inclusive. `closed` lets a run wrap past the end.
function runs(flags, pts, minLen, closed) {
  const n = flags.length;
  const out = [];
  if (!n) return out;
  if (flags.every(Boolean)) return [[0, n - 1]];
  // On a loop, start just after a `false` so no run is cut in two.
  const start = closed ? (flags.findIndex((f) => !f) + 1) % n : 0;
  let from = null, len = 0;
  const close = (to) => { if (from != null && len >= minLen) out.push([from, to]); from = null; len = 0; };
  for (let s = 0; s < n; s++) {
    const i = (start + s) % n;
    if (flags[i]) {
      if (from == null) { from = i; len = 0; } else {
        const p = pts[(i - 1 + n) % n];
        len += Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]);
      }
    } else close((i - 1 + n) % n);
  }
  close((start - 1 + n) % n);
  return out;
}

// Extra points so none is more than `step` metres from the next: a lap can be
// as few as 50 samples, and a stretch of road between two of them is still
// driven on.
export function densify(pts, step = 4) {
  if (!pts?.length) return [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const k = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step);
    for (let j = 1; j <= k; j++) out.push([x0 + ((x1 - x0) * j) / k, z0 + ((z1 - z0) * j) / k]);
  }
  return out;
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

// The road ({left, right, closed} in metres) against a lap's positions
// (`main`, [x, z] in metres — the patches follow this one) and any other laps
// (`others`, which only count towards "visited").
export function fitRoad(road, lap, others = []) {
  if (!road?.left?.length || !lap?.length) return null;
  const main = densify(lap);
  const n = Math.min(road.left.length, road.right.length);
  const centre = [], half = [];
  for (let i = 0; i < n; i++) {
    const [lx, lz] = road.left[i], [rx, rz] = road.right[i];
    centre.push([(lx + rx) / 2, (lz + rz) / 2]);
    half.push(Math.hypot(lx - rx, lz - rz) / 2);
  }
  const maxHalf = Math.max(...half);
  const roadCells = grid(centre);

  // Which lap samples are off the road.
  const off = main.map(([x, z]) => {
    const near = nearest(roadCells, centre, x, z, maxHalf + SLACK_M);
    return !near || near.d > half[near.i] + SLACK_M;
  });
  const offShare = off.filter(Boolean).length / main.length;
  if (offShare > USELESS_SHARE) return { useless: true, keep: null, patches: [] };

  // Which stretches of road some lap drives on.
  const laps = [main, ...others.filter((l) => l?.length).map((l) => densify(l))];
  const lapPts = laps.flat();
  const lapCells = grid(lapPts);
  const unvisited = centre.map(([x, z], i) => !nearest(lapCells, lapPts, x, z, half[i] + NEAR_M));
  const keep = new Array(n).fill(true);
  let pruned = false;
  for (const [a, b] of runs(unvisited, centre, MIN_RUN_M, road.closed !== false)) {
    for (let i = a; ; i = (i + 1) % n) { keep[i] = false; if (i === b) break; }
    pruned = true;
  }

  // A strip of the circuit's usual width under each long stretch off it.
  const width = median(half);
  const patches = runs(off, main, MIN_RUN_M, false).map(([a, b]) => ribbon(main, a, b, width));
  if (!patches.length) return { useless: false, keep: pruned ? keep : null, show: null, patches };

  // The outline of road and patches together: an edge point inside the other
  // surface is not an edge. Without this the old road's corner is drawn
  // across the patch, and the patch's sides across the road it joins.
  const keptCentre = centre.filter((_, i) => keep[i]), keptHalf = half.filter((_, i) => keep[i]);
  const keptCells = grid(keptCentre);
  const inRoad = ([x, z]) => {
    const near = nearest(keptCells, keptCentre, x, z, maxHalf);
    return !!near && near.d < keptHalf[near.i] - INSIDE_M;
  };
  const patchCentre = patches.flatMap((p) => p.centre);
  const patchCells = grid(patchCentre);
  const inPatch = ([x, z]) => {
    const near = nearest(patchCells, patchCentre, x, z, width);
    return !!near && near.d < width - INSIDE_M;
  };
  const show = {
    left: road.left.slice(0, n).map((pt) => !inPatch(pt)),
    right: road.right.slice(0, n).map((pt) => !inPatch(pt)),
  };
  for (const p of patches) {
    p.show = { left: p.left.map((pt) => !inRoad(pt)), right: p.right.map((pt) => !inRoad(pt)) };
    delete p.centre;
  }
  return { useless: false, keep: pruned ? keep : null, show, patches };
}

// The strip under main[a..b], reaching JOIN_M further each way so it runs
// into the road at both ends.
function ribbon(pts, a, b, halfWidth) {
  let from = a, to = b;
  for (let d = 0; from > 0 && d < JOIN_M; from--) d += Math.hypot(pts[from][0] - pts[from - 1][0], pts[from][1] - pts[from - 1][1]);
  for (let d = 0; to < pts.length - 1 && d < JOIN_M; to++) d += Math.hypot(pts[to + 1][0] - pts[to][0], pts[to + 1][1] - pts[to][1]);
  const left = [], right = [];
  for (let i = from; i <= to; i++) {
    const p = pts[Math.max(from, i - 1)], q = pts[Math.min(to, i + 1)];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len;
    left.push([pts[i][0] + nx * halfWidth, pts[i][1] + nz * halfWidth]);
    right.push([pts[i][0] - nx * halfWidth, pts[i][1] - nz * halfWidth]);
  }
  return { closed: false, left, right, centre: pts.slice(from, to + 1) };
}
