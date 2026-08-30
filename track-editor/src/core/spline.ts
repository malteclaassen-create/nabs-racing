import * as THREE from 'three';
import type { PathData, TrackNode } from '../types';

/**
 * One cross section of the track: a point on the centre line plus a full
 * orthonormal frame and all per point attributes interpolated to that spot.
 * Everything downstream (road mesh, markers, AI line, map image) is built
 * from an array of these, so all parts of the editor agree geometrically.
 */
export interface Frame {
  pos: THREE.Vector3;
  /** Unit tangent, points in driving direction. */
  fwd: THREE.Vector3;
  /** Unit vector pointing to the right hand side of the road. */
  right: THREE.Vector3;
  /** Unit surface normal, already banked. */
  up: THREE.Vector3;
  widthL: number;
  widthR: number;
  wallL: boolean;
  wallR: boolean;
  /** Run off factor per side, 0..2, multiplied with the global width. */
  runoffL: number;
  runoffR: number;
  /** How far the barrier stands beyond the outer edge of the run off. */
  wallGapL: number;
  wallGapR: number;
  aiOffset: number;
  /**
   * Signed curvature in 1/m, measured in the ground plane.
   * Positive means the track turns towards its own right hand side, so the
   * right is the inside of the bend. The radius is 1 / |curvature|.
   */
  curvature: number;
  /** Arc length from the first frame, in metres. */
  dist: number;
  /** Curve parameter 0..1. */
  t: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export function makeCurve(path: PathData): THREE.CatmullRomCurve3 | null {
  if (path.nodes.length < 2) return null;
  const closed = path.closed && path.nodes.length >= 3;
  const pts = path.nodes.map((n) => new THREE.Vector3(n.p[0], n.p[1], n.p[2]));
  return new THREE.CatmullRomCurve3(pts, closed, 'centripetal', 0.5);
}

/**
 * Catmull-Rom interpolation of a scalar attribute using exactly the same
 * segment mapping three.js uses for CatmullRomCurve3.getPoint(t), so scalar
 * values line up with positions.
 */
function catmullScalar(values: number[], closed: boolean, t: number): number {
  const l = values.length;
  if (l === 0) return 0;
  if (l === 1) return values[0];

  const p = (l - (closed ? 0 : 1)) * t;
  let intPoint = Math.floor(p);
  let weight = p - intPoint;

  if (closed) {
    intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l;
  } else if (weight === 0 && intPoint === l - 1) {
    intPoint = l - 2;
    weight = 1;
  }

  const at = (i: number) => {
    if (closed) return values[((i % l) + l) % l];
    return values[Math.min(Math.max(i, 0), l - 1)];
  };

  const v0 = at(intPoint - 1);
  const v1 = at(intPoint);
  const v2 = at(intPoint + 1);
  const v3 = at(intPoint + 2);

  // Uniform Catmull-Rom. Good enough and very predictable for attributes.
  const t2 = weight * weight;
  const t3 = t2 * weight;
  return (
    0.5 *
    ((2 * v1) +
      (-v0 + v2) * weight +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
      (-v0 + 3 * v1 - 3 * v2 + v3) * t3)
  );
}

/** Nearest-node lookup for boolean attributes (kerb on / off). */
function nearestBool(nodes: TrackNode[], closed: boolean, t: number, pick: (n: TrackNode) => boolean): boolean {
  const l = nodes.length;
  const p = (l - (closed ? 0 : 1)) * t;
  let idx = Math.floor(p);
  if (closed) idx = ((idx % l) + l) % l;
  else idx = Math.min(Math.max(idx, 0), l - 1);
  return pick(nodes[idx]);
}

/**
 * How many cross sections a path actually gets per segment.
 *
 * Deliberately independent of the geometry. Deriving it from the curve's
 * length -- which is what a "plate no longer than N metres" rule needs --
 * changes the vertex count whenever a point moves, and a changed vertex count
 * means the road's buffers cannot be reused: every frame of a drag then
 * reallocates the entire road. Measured at 37 fresh geometries over 40 frames
 * of dragging, against a budget of nine. So the resolution stays the author's
 * setting, and `plateLength` below tells them what it buys in metres.
 *
 * `samplesPerSegment` on its own is not a resolution: a segment is the stretch
 * between two control points, so the plate length it produces depends on how
 * far apart the author happened to click -- a factor of 1.7 even on the
 * regular demo oval, and far worse on a track drawn with points 120 m apart.
 * So it is a floor, and the real count also has to satisfy MAX_PLATE.
 *
 * It stays a whole number of samples PER SEGMENT. Frames are addressed as
 * `segment * thisNumber + offset` by anything that maps a cross section back
 * to the control point it belongs to, so a count that is not a multiple of the
 * segment count detaches banking, widths and every barrier handle from their
 * point. Callers that index frames that way must ask here rather than assume
 * `samplesPerSegment`.
 */
export function samplesFor(_path: PathData, samplesPerSegment: number): number {
  return Math.max(2, Math.round(samplesPerSegment));
}

/**
 * How long a plate of road comes out at a given setting, in metres.
 *
 * The number the author actually cares about, and the one the setting hides:
 * `samplesPerSegment` divides a SEGMENT, so the plate length depends on how
 * far apart the points were clicked. Shown beside the setting so the choice
 * can be made on the metre rather than on a unitless count.
 */
export function plateLength(path: PathData, samplesPerSegment: number): number {
  const curve = makeCurve(path);
  if (!curve) return 0;
  const nodes = path.nodes;
  const closed = path.closed && nodes.length >= 3;
  const segCount = Math.max(1, closed ? nodes.length : nodes.length - 1);
  return curve.getLength() / (segCount * samplesFor(path, samplesPerSegment));
}

/**
 * Build the cross section frames of a path.
 *
 * The up vector is parallel transported along the curve so the road does not
 * twist randomly, then rotated by the interpolated banking angle.
 */
export function computeFrames(path: PathData, samplesPerSegment: number): Frame[] {
  const curve = makeCurve(path);
  if (!curve) return [];

  const nodes = path.nodes;
  const closed = path.closed && nodes.length >= 3;
  const segCount = closed ? nodes.length : nodes.length - 1;

  const steps = Math.max(2, segCount * samplesFor(path, samplesPerSegment));
  const count = closed ? steps : steps + 1;

  const widthL = nodes.map((n) => n.widthL);
  const widthR = nodes.map((n) => n.widthR);
  const bank = nodes.map((n) => n.bank);
  const aiOff = nodes.map((n) => n.aiOffset);
  const runoffL = nodes.map((n) => n.runoffL);
  const runoffR = nodes.map((n) => n.runoffR);
  const wallGapL = nodes.map((n) => n.wallGapL);
  const wallGapR = nodes.map((n) => n.wallGapR);

  const frames: Frame[] = [];
  const positions: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];

  for (let i = 0; i < count; i++) positions.push(curve.getPoint(i / steps));

  // Tangents from the neighbouring samples rather than curve.getTangent, which
  // evaluates the spline twice more per sample for its own finite difference.
  // We already have those neighbours, so this is the same answer for a third
  // of the work.
  for (let i = 0; i < count; i++) {
    const prev = closed ? positions[(i - 1 + count) % count] : positions[Math.max(0, i - 1)];
    const next = closed ? positions[(i + 1) % count] : positions[Math.min(count - 1, i + 1)];
    const tan = next.clone().sub(prev);
    if (tan.lengthSq() < 1e-12) {
      tan.copy(curve.getTangent(i / steps));
      if (tan.lengthSq() < 1e-12) tan.set(0, 0, 1);
    }
    tangents.push(tan.normalize());
  }

  // Road frame: the up vector is world up projected perpendicular to the
  // tangent. Not parallel transport on purpose. A road going over a crest must
  // stay level, and only the banking value is allowed to roll it. Parallel
  // transport would accumulate several degrees of phantom roll on a hilly
  // track, and on a closed loop it would not even come back to where it
  // started. This construction has zero twist by definition and no seam.
  const ups: THREE.Vector3[] = [];
  let previous = new THREE.Vector3().copy(UP);
  for (let i = 0; i < count; i++) {
    const t = tangents[i];
    const up = new THREE.Vector3().copy(UP);
    if (Math.abs(up.dot(t)) > 0.999) {
      // Straight up or straight down. Keep the previous frame rather than
      // producing a zero length vector.
      up.copy(previous);
    }
    up.addScaledVector(t, -up.dot(t));
    if (up.lengthSq() < 1e-9) up.copy(previous);
    up.normalize();
    ups.push(up);
    previous = up;
  }

  let dist = 0;
  for (let i = 0; i < count; i++) {
    const t = i / steps;
    if (i > 0) dist += positions[i].distanceTo(positions[i - 1]);

    const fwd = tangents[i];
    const bankRad = THREE.MathUtils.degToRad(catmullScalar(bank, closed, t));
    // Negative because rotating the frame clockwise around fwd raises the
    // right hand edge, which is what a positive bank value should mean.
    const u = ups[i].clone().applyAxisAngle(fwd, -bankRad).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, u).normalize();

    frames.push({
      pos: positions[i],
      fwd,
      up: u,
      right,
      widthL: Math.max(0.5, catmullScalar(widthL, closed, t)),
      widthR: Math.max(0.5, catmullScalar(widthR, closed, t)),
      wallL: nearestBool(nodes, closed, t, (n) => n.wallL),
      wallR: nearestBool(nodes, closed, t, (n) => n.wallR),
      runoffL: Math.max(0, catmullScalar(runoffL, closed, t)),
      runoffR: Math.max(0, catmullScalar(runoffR, closed, t)),
      wallGapL: catmullScalar(wallGapL, closed, t),
      wallGapR: catmullScalar(wallGapR, closed, t),
      aiOffset: catmullScalar(aiOff, closed, t),
      curvature: 0,
      dist,
      t,
    });
  }

  // Signed curvature, from how fast the tangent swings towards the right hand
  // side. Everything that offsets the road sideways needs this: an offset
  // bigger than the radius of the bend folds the offset line back through
  // itself, which is what puts a barrier across the middle of a hairpin.
  for (let i = 0; i < count; i++) {
    const prev = closed ? frames[(i - 1 + count) % count] : frames[Math.max(0, i - 1)];
    const next = closed ? frames[(i + 1) % count] : frames[Math.min(count - 1, i + 1)];
    if (prev === next) continue;
    const ds = prev.pos.distanceTo(frames[i].pos) + frames[i].pos.distanceTo(next.pos);
    if (ds < 1e-6) continue;
    const dx = next.fwd.x - prev.fwd.x;
    const dz = next.fwd.z - prev.fwd.z;
    const r = frames[i].right;
    const kappa = (dx * r.x + dz * r.z) / ds;
    frames[i].curvature = kappa;

    // A corner can be drawn tighter than the road is wide. The inner edge then
    // passes through the centre of the turn and out the other side, and the
    // surface folds back over itself. Pull the inner edge up short of the
    // centre instead: the road pinches at the apex, which is honest about the
    // corner being impossibly tight, rather than tying itself in a knot.
    // Done here so the mesh, the terrain, the AI line and the minimap all see
    // the same width.
    if (Math.abs(kappa) > 1e-6) {
      const room = Math.max(0.5, (1 / Math.abs(kappa)) * INNER_LIMIT);
      if (kappa > 0) frames[i].widthR = Math.min(frames[i].widthR, room);
      else frames[i].widthL = Math.min(frames[i].widthL, room);
    }
  }

  return frames;
}

/**
 * How far towards the centre of a bend anything may be offset.
 *
 * Offsetting a curve of radius R inwards by R collapses it to a point, and by
 * more than R turns it inside out. Everything that sits beside the centre line
 * respects this: the road edge, the kerb, the run off and the barrier.
 */
export const INNER_LIMIT = 0.85;

/** Total centre line length in metres. Includes the closing segment on loops. */
export function pathLength(frames: Frame[], closed: boolean): number {
  if (frames.length < 2) return 0;
  const last = frames[frames.length - 1];
  if (!closed) return last.dist;
  return last.dist + last.pos.distanceTo(frames[0].pos);
}

/**
 * Interpolate a frame at an arbitrary arc length fraction 0..1.
 * Used to place the start/finish line, sector gates and grid slots exactly.
 */
export function frameAtFraction(frames: Frame[], closed: boolean, s: number): Frame | null {
  if (frames.length === 0) return null;
  if (frames.length === 1) return frames[0];

  const total = pathLength(frames, closed);
  if (total <= 0) return frames[0];

  let target = s * total;
  if (closed) target = ((target % total) + total) % total;
  else target = Math.min(Math.max(target, 0), total);

  return frameAtDistance(frames, closed, target);
}

export function frameAtDistance(frames: Frame[], closed: boolean, distance: number): Frame {
  const total = pathLength(frames, closed);
  let d = distance;
  if (closed && total > 0) d = ((d % total) + total) % total;
  else d = Math.min(Math.max(d, 0), total);

  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].dist <= d) i++;
  return frameAtSegment(frames, closed, i, d, total);
}

/** Interpolate inside a known segment. Split out so a sweep can reuse a cursor. */
function frameAtSegment(frames: Frame[], closed: boolean, i: number, d: number, total: number): Frame {
  const n = frames.length;
  const a = frames[i];
  const b = closed ? frames[(i + 1) % n] : frames[Math.min(i + 1, n - 1)];
  const segLen = (closed && i === n - 1 ? total : b.dist) - a.dist;
  const w = segLen > 1e-6 ? (d - a.dist) / segLen : 0;
  return lerpFrame(a, b, Math.min(Math.max(w, 0), 1), d);
}

function lerpFrame(a: Frame, b: Frame, w: number, dist: number): Frame {
  const fwd = a.fwd.clone().lerp(b.fwd, w).normalize();
  const up = a.up.clone().lerp(b.up, w).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  return {
    pos: a.pos.clone().lerp(b.pos, w),
    fwd,
    up,
    right,
    widthL: a.widthL + (b.widthL - a.widthL) * w,
    widthR: a.widthR + (b.widthR - a.widthR) * w,
    wallL: w < 0.5 ? a.wallL : b.wallL,
    wallR: w < 0.5 ? a.wallR : b.wallR,
    runoffL: a.runoffL + (b.runoffL - a.runoffL) * w,
    runoffR: a.runoffR + (b.runoffR - a.runoffR) * w,
    wallGapL: a.wallGapL + (b.wallGapL - a.wallGapL) * w,
    wallGapR: a.wallGapR + (b.wallGapR - a.wallGapR) * w,
    aiOffset: a.aiOffset + (b.aiOffset - a.aiOffset) * w,
    curvature: a.curvature + (b.curvature - a.curvature) * w,
    dist,
    t: a.t + (b.t - a.t) * w,
  };
}

/** Resample the centre line at a fixed spacing. Used for the AI line. */
export function resampleByDistance(frames: Frame[], closed: boolean, spacing: number): Frame[] {
  const total = pathLength(frames, closed);
  if (total <= 0 || frames.length < 2) return [];
  const n = Math.max(4, Math.round(total / Math.max(0.5, spacing)));
  const step = total / n;
  const out: Frame[] = [];
  const limit = closed ? n : n + 1;

  // Walk the frames once with a cursor. Calling frameAtDistance per point would
  // restart its search from the beginning every time, which is quadratic and
  // was the single most expensive part of rebuilding the AI line.
  let cursor = 0;
  for (let i = 0; i < limit; i++) {
    const d = Math.min(i * step, total);
    while (cursor < frames.length - 1 && frames[cursor + 1].dist <= d) cursor++;
    out.push(frameAtSegment(frames, closed, cursor, d, total));
  }
  return out;
}

/**
 * Which control point the spline segment a frame sits on starts at.
 *
 * Answered from the frame's own curve parameter rather than by looking for the
 * nearest node, so it is exact even where the points are unevenly spaced: `t`
 * is the very number the curve used to place that cross section. Inserting a
 * point needs this to know where in the list it belongs.
 */
export function segmentStartId(path: PathData, frame: Frame): string | null {
  const n = path.nodes.length;
  if (n === 0) return null;
  if (n === 1) return path.nodes[0].id;
  // Matches makeCurve: a loop needs three points before it closes.
  const closed = path.closed && n >= 3;
  const segCount = closed ? n : n - 1;
  let seg = Math.floor(frame.t * segCount);
  if (closed) seg = ((seg % segCount) + segCount) % segCount;
  // t === 1 at the very end of an open path would land one segment past the
  // last one, which has no start node.
  else seg = Math.min(Math.max(seg, 0), segCount - 1);
  return path.nodes[seg].id;
}

/** Axis aligned bounding box of the road surface, used to size the terrain. */
export function trackBounds(frames: Frame[], margin: number) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const f of frames) {
    const l = f.pos.clone().addScaledVector(f.right, -f.widthL);
    const r = f.pos.clone().addScaledVector(f.right, f.widthR);
    for (const p of [l, r]) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
  }
  if (!Number.isFinite(minX)) return { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
  return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
}

let nodeCounter = 0;
export function makeNode(p: Vec3Like, template?: Partial<TrackNode>): TrackNode {
  nodeCounter += 1;
  return {
    id: `n${Date.now().toString(36)}${nodeCounter.toString(36)}`,
    p: [p.x, p.y, p.z],
    widthL: template?.widthL ?? 6,
    widthR: template?.widthR ?? 6,
    bank: template?.bank ?? 0,
    // No barrier unless one is asked for. A new point copies its neighbour, so
    // extending a stretch that already has one carries it along, but drawing a
    // fresh track leaves the roadside empty for the Barrier tool to fill in.
    wallL: template?.wallL ?? false,
    wallR: template?.wallR ?? false,
    runoffL: template?.runoffL ?? 1,
    runoffR: template?.runoffR ?? 1,
    wallGapL: template?.wallGapL ?? 0,
    wallGapR: template?.wallGapR ?? 0,
    aiOffset: template?.aiOffset ?? 0,
  };
}

/** Fill in fields a project file saved by an older version does not have. */
export function normalizeNode(n: Partial<TrackNode> & { p: Vec3Like3 }): TrackNode {
  return {
    id: n.id ?? `n${Math.random().toString(36).slice(2, 9)}`,
    p: n.p as [number, number, number],
    widthL: n.widthL ?? 6,
    widthR: n.widthR ?? 6,
    bank: n.bank ?? 0,
    wallL: n.wallL ?? false,
    wallR: n.wallR ?? false,
    runoffL: n.runoffL ?? 1,
    runoffR: n.runoffR ?? 1,
    wallGapL: n.wallGapL ?? 0,
    wallGapR: n.wallGapR ?? 0,
    aiOffset: n.aiOffset ?? 0,
  };
}

type Vec3Like3 = [number, number, number];

export interface Vec3Like { x: number; y: number; z: number }
