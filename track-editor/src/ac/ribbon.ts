import * as THREE from 'three';
import type { Frame } from '../core/spline';

/**
 * Resizing something that runs along the track, without taking it off the track.
 *
 * A kerb is not a box. It is a ribbon that follows a corner, and the moment you
 * scale one along a world axis you are no longer stretching an arc, you are
 * turning it into an ellipse. Measured on the reference circuit: making one
 * kerb of Hockenheim's turn 8 two percent longer that way walks its far end
 * **1.41 metres** off the edge of the tarmac. On the straighter pieces it is
 * still 60 centimetres. That is the whole complaint, and no amount of care with
 * the multiplier fixes it, because the operation itself is wrong.
 *
 * So the resize happens in the track's own coordinates instead:
 *
 *   s        how far along the lap the vertex is
 *   lateral  how far to the side of the centre line
 *   height   how far above it
 *
 * Longer then means "cover more ARC", which keeps every vertex on the curve it
 * was on. Wider means an offset curve, which still follows the corner. Taller
 * does not touch the plan view at all. The curvature is not preserved by
 * accident -- it is never left in the first place.
 */

export interface RibbonPoint {
  /** Arc length along the centre line, metres. */
  s: number;
  /**
   * Signed distance to the side, along the cross section's right vector.
   * With an `edgeSide`, measured from THAT EDGE of the tarmac instead of from
   * the centre line -- see `edgeLateralAt`.
   */
  lateral: number;
  /** Height above the centre line at that station. */
  height: number;
}

/**
 * Which side of the road something belongs to: -1 left, 1 right.
 *
 * A kerb hugs the EDGE of the tarmac, and the tarmac is not a constant width
 * -- so a kerb slid along the lap with its distance to the CENTRE held fixed
 * drifts onto the road where it widens and off it where it narrows. Measuring
 * lateral from the edge instead pins it to the thing it actually follows.
 */
export type EdgeSide = -1 | 1;

/** Where the chosen edge sits, as a centre-line lateral, widths interpolated. */
function edgeLateral(edgeSide: EdgeSide, widthL: number, widthR: number): number {
  return edgeSide < 0 ? -(widthL || 0) : (widthR || 0);
}

/**
 * Where a world point sits in track coordinates.
 *
 * Projected onto the SEGMENT between two cross sections, not onto one section's
 * infinite line. Cross sections fan out on a corner, and measuring against an
 * unbounded one puts a point on the verge metres from where it really is --
 * a mistake this project has already paid for once.
 */
export function toRibbon(
  frames: readonly Frame[],
  p: THREE.Vector3,
  edgeSide?: EdgeSide,
): RibbonPoint | null {
  const n = frames.length;
  if (n < 2) return null;

  let bestI = 0;
  let bestT = 0;
  let bestDist = Infinity;
  const ab = new THREE.Vector3();
  const ap = new THREE.Vector3();
  const at = new THREE.Vector3();

  for (let i = 0; i < n - 1; i++) {
    const a = frames[i].pos;
    const b = frames[i + 1].pos;
    ab.subVectors(b, a);
    const len2 = ab.lengthSq();
    if (len2 < 1e-9) continue;
    ap.subVectors(p, a);
    // Clamped, so the ends of an open run are a cap rather than a ray.
    const t = Math.max(0, Math.min(1, ap.dot(ab) / len2));
    at.copy(a).addScaledVector(ab, t);
    const d = at.distanceToSquared(p);
    if (d < bestDist) { bestDist = d; bestI = i; bestT = t; }
  }

  const a = frames[bestI];
  const b = frames[bestI + 1];
  const pos = new THREE.Vector3().lerpVectors(a.pos, b.pos, bestT);
  const right = new THREE.Vector3().lerpVectors(a.right, b.right, bestT).normalize();
  const up = new THREE.Vector3().lerpVectors(a.up, b.up, bestT).normalize();
  const rel = new THREE.Vector3().subVectors(p, pos);

  let lateral = rel.dot(right);
  if (edgeSide) {
    lateral -= edgeLateral(
      edgeSide,
      a.widthL + (b.widthL - a.widthL) * bestT,
      a.widthR + (b.widthR - a.widthR) * bestT,
    );
  }

  return {
    s: a.dist + (b.dist - a.dist) * bestT,
    lateral,
    height: rel.dot(up),
  };
}

/** The cross section at an arc length, interpolated. */
export function frameAt(frames: readonly Frame[], s: number): {
  pos: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3;
  widthL: number; widthR: number;
} | null {
  const n = frames.length;
  if (n < 2) return null;

  // Binary search: `dist` is monotonic along the run.
  let lo = 0;
  let hi = n - 1;
  if (s <= frames[0].dist) { lo = 0; hi = 1; }
  else if (s >= frames[n - 1].dist) { lo = n - 2; hi = n - 1; }
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].dist <= s) lo = mid; else hi = mid;
    }
  }

  const a = frames[lo];
  const b = frames[hi];
  const span = b.dist - a.dist;
  // Beyond either end the last section is continued straight, which is the
  // honest extrapolation: nothing is known about track that is not there.
  const t = span > 1e-9 ? (s - a.dist) / span : 0;
  return {
    pos: new THREE.Vector3().lerpVectors(a.pos, b.pos, t),
    right: new THREE.Vector3().lerpVectors(a.right, b.right, t).normalize(),
    up: new THREE.Vector3().lerpVectors(a.up, b.up, t).normalize(),
    widthL: (a.widthL || 0) + ((b.widthL || 0) - (a.widthL || 0)) * t,
    widthR: (a.widthR || 0) + ((b.widthR || 0) - (a.widthR || 0)) * t,
  };
}

export interface RibbonResize {
  /** Multiplier along the arc. */
  length: number;
  /** Multiplier on the distance to the side. */
  width: number;
  /** Multiplier on the height. */
  height: number;
  /**
   * Which end stays put, 0..1 per axis, in the same order as the sliders:
   * [width, height, length]. 0 is the low side, 1 the high, 0.5 the middle.
   */
  anchor?: [number, number, number];
  /** Shift along the arc / sideways / up, in metres, applied after the resize. */
  move?: [number, number, number];
  /**
   * Measure lateral from THIS edge of the tarmac instead of the centre line.
   * MUST match the side the projection (`toRibbon`/`ribbonBounds`/
   * `projectPoints`) was made with, or the piece jumps by the road's width.
   */
  edgeSide?: EdgeSide;
}

export interface RibbonBounds {
  minS: number; maxS: number;
  minLateral: number; maxLateral: number;
  minHeight: number; maxHeight: number;
}

/** The extent of a set of world points in track coordinates. */
export function ribbonBounds(
  frames: readonly Frame[],
  points: readonly THREE.Vector3[],
  edgeSide?: EdgeSide,
): RibbonBounds | null {
  let minS = Infinity, maxS = -Infinity;
  let minL = Infinity, maxL = -Infinity;
  let minH = Infinity, maxH = -Infinity;
  let any = false;
  for (const p of points) {
    const r = toRibbon(frames, p, edgeSide);
    if (!r) continue;
    any = true;
    minS = Math.min(minS, r.s); maxS = Math.max(maxS, r.s);
    minL = Math.min(minL, r.lateral); maxL = Math.max(maxL, r.lateral);
    minH = Math.min(minH, r.height); maxH = Math.max(maxH, r.height);
  }
  return any
    ? { minS, maxS, minLateral: minL, maxLateral: maxL, minHeight: minH, maxHeight: maxH }
    : null;
}

function anchorValue(lo: number, hi: number, a: number): number {
  return lo + (hi - lo) * a;
}

/**
 * Every point's track coordinates, measured once.
 *
 * The projection is the expensive half of the resize -- every point against
 * every segment of the centre line -- and it never changes while a handle is
 * being dragged: only the resize parameters do. So it is computed once and the
 * drag re-evaluates just `placeRibbonPoint`, which is a binary search.
 */
export interface RibbonProjection {
  coords: RibbonPoint[];
  bounds: RibbonBounds;
}

export function projectPoints(
  frames: readonly Frame[],
  points: readonly THREE.Vector3[],
  edgeSide?: EdgeSide,
): RibbonProjection | null {
  const coords: RibbonPoint[] = [];
  let minS = Infinity, maxS = -Infinity;
  let minL = Infinity, maxL = -Infinity;
  let minH = Infinity, maxH = -Infinity;
  for (const p of points) {
    const r = toRibbon(frames, p, edgeSide);
    if (!r) return null;
    coords.push(r);
    minS = Math.min(minS, r.s); maxS = Math.max(maxS, r.s);
    minL = Math.min(minL, r.lateral); maxL = Math.max(maxL, r.lateral);
    minH = Math.min(minH, r.height); maxH = Math.max(maxH, r.height);
  }
  if (coords.length === 0) return null;
  return {
    coords,
    bounds: { minS, maxS, minLateral: minL, maxLateral: maxL, minHeight: minH, maxHeight: maxH },
  };
}

/** Where a resize puts one already-projected point, in the world. */
export function placeRibbonPoint(
  frames: readonly Frame[],
  bounds: RibbonBounds,
  resize: RibbonResize,
  r: RibbonPoint,
  out = new THREE.Vector3(),
): THREE.Vector3 | null {
  const anchor = resize.anchor ?? [0.5, 0, 0.5];
  const move = resize.move ?? [0, 0, 0];

  const sAnchor = anchorValue(bounds.minS, bounds.maxS, anchor[2]);
  const lAnchor = anchorValue(bounds.minLateral, bounds.maxLateral, anchor[0]);
  const hAnchor = anchorValue(bounds.minHeight, bounds.maxHeight, anchor[1]);

  const s = sAnchor + (r.s - sAnchor) * resize.length + move[2];
  let lateral = lAnchor + (r.lateral - lAnchor) * resize.width + move[0];
  const height = hAnchor + (r.height - hAnchor) * resize.height + move[1];

  const f = frameAt(frames, s);
  if (!f) return null;
  // Edge-relative lateral turns back into a centre-line one HERE, with the
  // width at the DESTINATION station: that is the whole trick -- a slide
  // follows the edge of the tarmac wherever it wanders.
  if (resize.edgeSide) lateral += edgeLateral(resize.edgeSide, f.widthL, f.widthR);
  return out.copy(f.pos).addScaledVector(f.right, lateral).addScaledVector(f.up, height);
}

/**
 * The interval of arc length a resized piece currently covers.
 *
 * This is what the end grips stand on: the images of the original extremes
 * under the same mapping the vertices go through.
 */
export function ribbonSpanOf(
  bounds: RibbonBounds,
  resize: RibbonResize,
): { from: number; to: number } {
  const anchor = resize.anchor ?? [0.5, 0, 0.5];
  const move = resize.move ?? [0, 0, 0];
  const sAnchor = anchorValue(bounds.minS, bounds.maxS, anchor[2]);
  return {
    from: sAnchor + (bounds.minS - sAnchor) * resize.length + move[2],
    to: sAnchor + (bounds.maxS - sAnchor) * resize.length + move[2],
  };
}

/**
 * Drag one end of the covered interval to `targetS`, keeping the OTHER end
 * exactly where it is.
 *
 * This is the algebra behind the end grips: solve `length` and the
 * along-the-arc move so that the far end of the mapping stays fixed while the
 * grabbed end lands under the pointer. One function, shared with the tests --
 * the viewport must not carry its own copy of this and drift.
 */
export function trimSpan(
  bounds: RibbonBounds,
  resize: RibbonResize,
  end: 'from' | 'to',
  targetS: number,
  minLength = 0.5,
): { length: number; along: number } {
  const extent = bounds.maxS - bounds.minS;
  const anchor = resize.anchor ?? [0.5, 0, 0.5];
  const sAnchor = bounds.minS + extent * anchor[2];
  const span = ribbonSpanOf(bounds, resize);
  if (end === 'to') {
    const to = Math.max(span.from + minLength, targetS);
    const length = (to - span.from) / extent;
    return { length, along: span.from - sAnchor - (bounds.minS - sAnchor) * length };
  }
  const from = Math.min(span.to - minLength, targetS);
  const length = (span.to - from) / extent;
  return { length, along: span.to - sAnchor - (bounds.maxS - sAnchor) * length };
}

/**
 * Move one world point according to a resize expressed along the track.
 *
 * Returns null when the point cannot be placed -- there is no centre line to
 * measure against -- and the caller should leave it alone rather than guess.
 */
export function resizeAlongPath(
  frames: readonly Frame[],
  bounds: RibbonBounds,
  resize: RibbonResize,
  p: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 | null {
  const r = toRibbon(frames, p, resize.edgeSide);
  if (!r) return null;
  return placeRibbonPoint(frames, bounds, resize, r, out);
}

/**
 * Which side of the road a set of points sits on, from CENTRE-based bounds.
 *
 * Undefined when it straddles or hugs the centre line -- then edge-relative
 * lateral would flip sign mid-piece and there is no edge to follow.
 */
export function ribbonSideOf(bounds: RibbonBounds): EdgeSide | undefined {
  const mid = (bounds.minLateral + bounds.maxLateral) / 2;
  if (mid <= -1) return -1;
  if (mid >= 1) return 1;
  return undefined;
}
