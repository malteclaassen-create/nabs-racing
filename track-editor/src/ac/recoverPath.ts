import * as THREE from 'three';
import type { PathData, TrackNode, Vec3 } from '../types';
import { makeCurve } from '../core/spline';
import { laneBanks, laneHasWidths, laneIsClosed, type AiLane } from './aiRead';

/**
 * Turn an imported track's AI line back into a path the editor can work with.
 *
 * This is what makes an imported circuit EDITABLE. Everything the editor knows
 * how to do -- draw a kerb over a stretch, paint a line down the edge, put
 * braking boards before a corner, lay out pit boxes -- is expressed along a
 * centre line with a width either side. A track baked into a kn5 has no centre
 * line; it has a hundred thousand triangles. But `fast_lane.ai` is exactly a
 * centre line with a width either side, sampled every metre and a half, with
 * the surface normal at each point, so the banking comes back too.
 *
 * Two things are worth knowing about what comes out:
 *
 * RECENTRED. The AI line is the RACING line -- it hugs the apex, so it is not
 * in the middle of the road and it weaves. Using it directly as the centre
 * line would make every kerb and every painted line weave with it. So the
 * control points are moved to the middle of the recorded left and right
 * widths, and the racing line is preserved as `aiOffset`, which is what that
 * field is for.
 *
 * MEASURED. The result is a Catmull-Rom spline through a few hundred points,
 * not the original polyline, so it is an approximation -- and an approximation
 * nobody has measured is a guess. `deviation` says how far the spline strays
 * from the recorded line in metres, so the caller can densify or warn instead
 * of quietly painting a line half off the tarmac.
 */

export interface RecoverOptions {
  /** Target distance between control points, metres. */
  spacing?: number;
  /** Force a point whenever the road has turned this much since the last one. */
  maxTurnDeg?: number;
  /** Never put two control points closer than this. */
  minSpacing?: number;
  /** Half width used when the file records none, metres. */
  fallbackHalfWidth?: number;
  /**
   * Ceiling on control points.
   *
   * Not a nicety: open world maps exist. One installed here is 106 km of
   * New York with 59,450 AI points, and at the default spacing that is five
   * thousand control points, each multiplied by the cross section count. The
   * spacing is widened to fit instead, and a note says so.
   */
  maxNodes?: number;
}

export interface RecoveredPath {
  path: PathData;
  /** Distance from the recovered spline to the recorded line, metres. */
  deviation: { max: number; mean: number };
  /** Length of the recorded line, metres. */
  length: number;
  /** Anything the caller should tell the user about. */
  notes: string[];
}

/**
 * Control point spacing, metres.
 *
 * Measured on three real circuits, worst distance from the spline to the
 * recorded line: 40 m spacing gives 4.5-5.9 m, 20 m gives 1.2-2.3 m, 10 m
 * gives 0.5-0.9 m, and below that it stops improving. The MEAN stays around
 * 0.20 m at every density, because that is not approximation error at all --
 * it is the racing line weaving from side to side, which the spline smooths
 * out and which it is right to smooth out. So the number to choose against is
 * the maximum, and twelve metres is where that becomes smaller than the
 * painted line it might be used to place.
 */
const DEFAULTS: Required<RecoverOptions> = {
  spacing: 12,
  maxTurnDeg: 6,
  minSpacing: 5,
  fallbackHalfWidth: 6,
  maxNodes: 1500,
};

let seq = 0;
function nodeId(): string {
  seq += 1;
  return `imp${seq.toString(36)}`;
}

/**
 * Median over a window.
 *
 * The recorded widths are noisy and occasionally absurd -- one Kunos track
 * opens with a 39.9 m left width where the start straight meets the pit exit.
 * A mean would smear that over its neighbours; a median ignores it.
 */
function medianFiltered(values: Float32Array, radius: number, closed: boolean): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  const window: number[] = [];
  for (let i = 0; i < n; i++) {
    window.length = 0;
    for (let k = -radius; k <= radius; k++) {
      let j = i + k;
      if (closed) j = ((j % n) + n) % n;
      else j = Math.min(n - 1, Math.max(0, j));
      window.push(values[j]);
    }
    window.sort((a, b) => a - b);
    out[i] = window[radius];
  }
  return out;
}

/** Heading in the ground plane, radians. */
function heading(from: Vec3 | [number, number, number], to: Vec3 | [number, number, number]): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function recoverPathFromLane(lane: AiLane, options: RecoverOptions = {}): RecoveredPath {
  const opts = { ...DEFAULTS, ...options };
  const notes: string[] = [];
  const src = lane.points;
  if (src.length < 4) {
    return {
      path: { closed: false, nodes: [] },
      deviation: { max: 0, mean: 0 },
      length: 0,
      notes: ['the AI line has too few points to rebuild a track from'],
    };
  }

  const closed = laneIsClosed(lane);
  const hasWidths = laneHasWidths(lane);
  if (!hasWidths) {
    notes.push(
      `no widths recorded in this lane, using ${opts.fallbackHalfWidth} m either side`,
    );
  }

  /* --- per point attributes ---------------------------------------- */
  const n = src.length;
  const rawL = new Float32Array(n);
  const rawR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    rawL[i] = hasWidths ? src[i].sideLeft : opts.fallbackHalfWidth;
    rawR[i] = hasWidths ? src[i].sideRight : opts.fallbackHalfWidth;
  }
  const sideL = medianFiltered(rawL, 8, closed);
  const sideR = medianFiltered(rawR, 8, closed);

  // Banking gets the same treatment, and needs it: a handful of tracks carry a
  // single corrupt surface normal that reads as a wall. Le Mans has one point
  // at -64 degrees with its 1st and 99th percentiles at -4.9 and +4.1; Suzuka
  // has two at +47.8 in a field that otherwise never leaves +-4.7. One bad
  // control point would tip the road on its side for a hundred metres either
  // way, because the spline interpolates it.
  const banks = medianFiltered(laneBanks(lane), 4, closed);

  // Recentre: move each sample to the middle of its own road, and remember how
  // far the racing line sat from there.
  const centre: Array<[number, number, number]> = new Array(n);
  const halfWidth = new Float32Array(n);
  const aiOffset = new Float32Array(n);
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const prev = src[i > 0 ? i - 1 : closed ? n - 1 : 0].pos;
    const next = src[i < n - 1 ? i + 1 : closed ? 0 : n - 1].pos;
    fwd.set(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
    if (fwd.lengthSq() < 1e-9) fwd.set(0, 0, 1);
    fwd.normalize();

    const nrm = src[i].normal;
    up.set(nrm[0], nrm[1], nrm[2]);
    if (up.lengthSq() < 1e-6) up.set(0, 1, 0);
    up.normalize();
    // Same construction the editor's own frames use, so the sides agree.
    right.crossVectors(fwd, up).normalize();

    const shift = (sideR[i] - sideL[i]) / 2;
    const p = src[i].pos;
    centre[i] = [p[0] + right.x * shift, p[1] + right.y * shift, p[2] + right.z * shift];
    halfWidth[i] = (sideL[i] + sideR[i]) / 2;
    aiOffset[i] = -shift;
  }

  /* --- choose control points ---------------------------------------- */
  // Distances along the recentred line, which is what the nodes sit on.
  const step = new Float32Array(n);
  let total = 0;
  for (let i = 1; i < n; i++) {
    const a = centre[i - 1], b = centre[i];
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    step[i] = total;
  }

  let spacing = opts.spacing;
  const estimate = total / spacing;
  if (estimate > opts.maxNodes) {
    spacing = total / opts.maxNodes;
    notes.push(
      `${(total / 1000).toFixed(1)} km is a lot of track: control points every `
      + `${spacing.toFixed(0)} m instead of ${opts.spacing} m to keep it workable`,
    );
  }
  const maxTurn = (opts.maxTurnDeg * Math.PI) / 180;

  const picked: number[] = [0];
  let lastAt = 0;
  let turn = 0;
  let lastHeading = heading(centre[0], centre[Math.min(1, n - 1)]);
  for (let i = 1; i < n; i++) {
    const h = heading(centre[i - 1], centre[i]);
    turn += Math.abs(angleDelta(lastHeading, h));
    lastHeading = h;
    const since = step[i] - step[lastAt];
    if (since < opts.minSpacing) continue;
    if (since >= spacing || turn >= maxTurn) {
      picked.push(i);
      lastAt = i;
      turn = 0;
    }
  }

  if (closed) {
    // The last sample sits back on top of the first; a control point there
    // would give the closed spline a zero length segment across the seam.
    const a = centre[picked[picked.length - 1]], b = centre[0];
    if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < opts.minSpacing) picked.pop();
  } else if (picked[picked.length - 1] !== n - 1) {
    picked.push(n - 1);
  }

  const nodes: TrackNode[] = picked.map((i) => ({
    id: nodeId(),
    p: centre[i],
    widthL: Math.max(0.5, halfWidth[i]),
    widthR: Math.max(0.5, halfWidth[i]),
    bank: banks[i],
    // An imported track brings its own barriers and its own scenery. Anything
    // the editor would GENERATE beside the road is off: the run off, the
    // walls. What is wanted is a line to hang edits on, not a second track
    // built on top of the one that is already there.
    wallL: false,
    wallR: false,
    wallGapL: 0,
    wallGapR: 0,
    runoffL: 0,
    runoffR: 0,
    aiOffset: aiOffset[i],
  }));

  const path: PathData = { closed, nodes };
  const deviation = measureDeviation(path, centre);
  if (deviation.max > 1.0) {
    notes.push(
      `the rebuilt centre line is up to ${deviation.max.toFixed(2)} m off the recorded one; `
      + 'lower the control point spacing if edits land in the wrong place',
    );
  }

  return { path, deviation, length: total, notes };
}

/**
 * How far the spline through the control points strays from the line it was
 * built from, in metres.
 *
 * Both sequences run along the same path in the same direction, so a marching
 * pointer with a local window finds the nearest sample without an O(n*m) sweep
 * -- which matters, because the biggest lane here has 59,450 points.
 */
export function measureDeviation(
  path: PathData,
  reference: Array<[number, number, number]>,
): { max: number; mean: number } {
  const curve = makeCurve(path);
  if (!curve || reference.length < 2) return { max: 0, mean: 0 };

  const samples = Math.min(20000, Math.max(1000, reference.length * 2));
  const pts: THREE.Vector3[] = [];
  const closed = path.closed && path.nodes.length >= 3;
  for (let i = 0; i < samples; i++) pts.push(curve.getPoint(i / (closed ? samples : samples - 1)));

  // Check a bounded number of reference points; the answer is a maximum over a
  // smooth difference, so sampling it does not hide anything.
  const stride = Math.max(1, Math.floor(reference.length / 2000));
  let max = 0, sum = 0, count = 0;
  let at = 0;
  const WINDOW = 60;

  for (let i = 0; i < reference.length; i += stride) {
    const r = reference[i];
    let best = Infinity;
    let bestAt = at;
    for (let k = -WINDOW; k <= WINDOW * 4; k++) {
      let j = at + k;
      if (closed) j = ((j % samples) + samples) % samples;
      else if (j < 0 || j >= samples) continue;
      const p = pts[j];
      const d = (p.x - r[0]) ** 2 + (p.y - r[1]) ** 2 + (p.z - r[2]) ** 2;
      if (d < best) { best = d; bestAt = j; }
    }
    at = bestAt;
    const d = Math.sqrt(best);
    if (d > max) max = d;
    sum += d;
    count += 1;
  }

  return { max, mean: count > 0 ? sum / count : 0 };
}
