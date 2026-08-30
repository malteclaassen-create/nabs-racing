import * as THREE from 'three';
import type { TrackNode } from '../types';

/**
 * How the next stretch of track is worked out from one click.
 *
 * Clicking points down freehand is fine for sketching a shape, and hopeless for
 * anything that has to be straight or has to be a corner of one radius: a
 * straight drawn by eye wanders by a degree or two, and a corner drawn as five
 * clicks is five different radii. So the click says WHERE, and the mode says
 * WHAT -- the same split a city builder makes between its straight, curve and
 * freehand road tools.
 *
 * All of it is plain geometry with no editor state, so it can be checked
 * headlessly rather than by drawing a lap and looking at it.
 */

export type DrawMode = 'free' | 'straight' | 'arc' | 'freehand';

export const DRAW_MODES: ReadonlyArray<{ value: DrawMode; label: string; hint: string }> = [
  { value: 'free', label: 'Free', hint: 'A point wherever you click. Good for sketching a shape.' },
  {
    value: 'straight',
    label: 'Straight',
    hint: 'Locks the heading to whole steps, so a straight really is straight.',
  },
  {
    value: 'arc',
    label: 'Curve',
    hint: 'A constant radius bend leaving the last point in the direction it was already going.',
  },
  {
    value: 'freehand',
    label: 'Freehand',
    hint: 'Press and drag: points are dropped along the path as you go.',
  },
];

/**
 * How the height of a newly drawn point is decided.
 *
 *   'ground'  whatever the ground was under the click. What it always did.
 *   'level'   a fixed height, the same for every point. This is the one for a
 *             flat circuit, and for putting a track back onto a round number
 *             after the ground under it has been sculpted.
 *   'offset'  the ground, plus a constant. A track that follows the landscape
 *             but rides above it, on an embankment, or cut into it.
 */
export type HeightMode = 'ground' | 'level' | 'offset';

/**
 * What the draw tools put into the next point, before anything is clicked.
 *
 * Widths used to be copied from the previous point, which is fine while a track
 * is being extended and useless when the first one is being placed: there is
 * nothing to copy, so every new circuit began 12 m wide and had to be widened
 * point by point afterwards. Held per path, because a pit lane is not the width
 * of a race track and nobody wants to retype it every time they switch tools.
 */
export interface DrawCfg {
  trackWidthL: number;
  trackWidthR: number;
  pitWidthL: number;
  pitWidthR: number;
  roadWidthL: number;
  roadWidthR: number;
  heightMode: HeightMode;
  /** Absolute height for 'level', metres. */
  level: number;
  /** Height above the ground for 'offset', metres. Negative digs in. */
  offset: number;
}

export const DEFAULT_DRAW_CFG: DrawCfg = {
  // 14 m between the white lines, which is what a modern circuit measures --
  // Spa and Silverstone sit between 13 and 15. The old 12 m was a club track.
  trackWidthL: 7,
  trackWidthR: 7,
  pitWidthL: 4,
  pitWidthR: 4,
  // A two lane access road: 6 m kerb to kerb, which is what the service roads
  // around a real circuit measure.
  roadWidthL: 3,
  roadWidthR: 3,
  heightMode: 'ground',
  level: 0,
  offset: 0,
};

/** The half widths a point drawn on `path` starts with. */
export function drawWidths(cfg: DrawCfg, path: string): { widthL: number; widthR: number } {
  if (path === 'track') return { widthL: cfg.trackWidthL, widthR: cfg.trackWidthR };
  if (path === 'pit') return { widthL: cfg.pitWidthL, widthR: cfg.pitWidthR };
  return { widthL: cfg.roadWidthL, widthR: cfg.roadWidthR };
}

/** Where a point lands vertically, given the ground under it. */
export function drawHeightOf(cfg: DrawCfg, groundY: number): number {
  if (cfg.heightMode === 'level') return cfg.level;
  if (cfg.heightMode === 'offset') return groundY + cfg.offset;
  return groundY;
}

/**
 * Put a whole plan onto the configured height.
 *
 * Applied AFTER `planDraw` rather than to the click that fed it, because an arc
 * interpolates the height of its intermediate points between its two ends. In
 * 'offset' mode those points have to sample the ground they actually pass over,
 * or a bend across a hill hangs in the air over the middle of it. 'ground' is
 * left exactly alone, interpolation and all, so nothing about the old behaviour
 * moves.
 */
export function applyDrawHeight(
  points: THREE.Vector3[],
  cfg: DrawCfg,
  groundAt: (x: number, z: number) => number,
): THREE.Vector3[] {
  if (cfg.heightMode === 'ground') return points;
  for (const p of points) {
    p.y = cfg.heightMode === 'level' ? cfg.level : groundAt(p.x, p.z) + cfg.offset;
  }
  return points;
}

export interface DrawPlan {
  /** The points this click adds, in order. The last one ends the stretch. */
  points: THREE.Vector3[];
  /** How far the new stretch runs, metres, along the ground. */
  length: number;
  /** Heading of the new stretch, degrees, the same convention as an object's. */
  heading: number;
  /** Radius of the bend in metres, or 0 for a straight. */
  radius: number;
}

/** Compass heading of a ground direction, matching `rotY` on a placed object. */
function headingOf(dx: number, dz: number): number {
  return (THREE.MathUtils.radToDeg(Math.atan2(dx, dz)) + 360) % 360;
}

/** How far apart freehand drops its points. Control points, not cross sections. */
export const FREEHAND_SPACING = 30;

/** Vertex every this many degrees of bend, so an arc reads as an arc. */
const ARC_STEP_DEG = 18;

function plain(target: THREE.Vector3, last: THREE.Vector3 | null): DrawPlan {
  const dx = last ? target.x - last.x : 0;
  const dz = last ? target.z - last.z : 0;
  return {
    points: [target.clone()],
    length: Math.hypot(dx, dz),
    heading: headingOf(dx, dz),
    radius: 0,
  };
}

/**
 * What clicking at `target` should add to `nodes`.
 *
 * `angleStep` locks the heading of a straight; `lengthStep` its length, so a
 * straight drawn on the 5 m grid comes out a whole number of metres long
 * instead of whatever the pointer happened to be over.
 */
export function planDraw(
  mode: DrawMode,
  nodes: readonly TrackNode[],
  target: THREE.Vector3,
  angleStep = 15,
  lengthStep = 0,
): DrawPlan {
  const n = nodes.length;
  if (n === 0 || mode === 'free' || mode === 'freehand') {
    return plain(target, n > 0 ? toVec(nodes[n - 1]) : null);
  }

  const last = toVec(nodes[n - 1]);

  if (mode === 'straight') {
    let dx = target.x - last.x;
    let dz = target.z - last.z;
    let dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return plain(target, last);
    let heading = headingOf(dx, dz);
    if (angleStep > 0) heading = Math.round(heading / angleStep) * angleStep;
    if (lengthStep > 0) dist = Math.max(lengthStep, Math.round(dist / lengthStep) * lengthStep);
    const rad = THREE.MathUtils.degToRad(heading);
    dx = Math.sin(rad) * dist;
    dz = Math.cos(rad) * dist;
    return {
      points: [new THREE.Vector3(last.x + dx, target.y, last.z + dz)],
      length: dist,
      heading: (heading + 360) % 360,
      radius: 0,
    };
  }

  /* --- a bend of one radius, leaving the track the way it arrived ---- */

  // The direction the track is already going. Without it there is nothing for
  // the bend to be tangent to, so the first stretch of a new track is straight.
  if (n < 2) return plain(target, last);
  const prev = toVec(nodes[n - 2]);
  const tx = last.x - prev.x;
  const tz = last.z - prev.z;
  const tl = Math.hypot(tx, tz);
  if (tl < 1e-4) return plain(target, last);
  const ux = tx / tl;
  const uz = tz / tl;
  // Right hand normal of the direction of travel, in the ground plane.
  const nx = uz;
  const nz = -ux;

  const dx = target.x - last.x;
  const dz = target.z - last.z;
  const along = dx * ux + dz * uz;
  const across = dx * nx + dz * nz;
  const chord = Math.hypot(dx, dz);
  if (chord < 1e-4) return plain(target, last);

  /*
   * The one circle through both points that leaves the first one tangentially.
   * Its centre sits on the normal at r = |d|^2 / 2(d.n) -- the perpendicular
   * bisector of the chord meets the normal there. A target straight ahead has
   * d.n = 0 and no such circle, which is not a failure: it is a straight.
   */
  if (Math.abs(across) < 1e-3) {
    return {
      points: [new THREE.Vector3(last.x + ux * along, target.y, last.z + uz * along)],
      length: Math.abs(along),
      heading: headingOf(ux, uz),
      radius: 0,
    };
  }
  const r = (chord * chord) / (2 * across);
  const cx = last.x + nx * r;
  const cz = last.z + nz * r;

  /*
   * Which way round the circle. Not "the shorter way": the arc has to LEAVE
   * the track in the direction it was already going, so the direction of
   * travel is decided by the tangent and the sweep is then whatever it takes
   * to reach the target going that way. Clicking behind the car therefore
   * hooks all the way round rather than jumping, which is what a tangent
   * continuous bend does.
   */
  const a0 = Math.atan2(last.z - cz, last.x - cx);
  const a1 = Math.atan2(target.z - cz, target.x - cx);
  const turnSign = -Math.sin(a0) * ux + Math.cos(a0) * uz > 0 ? 1 : -1;
  let sweep = (((a1 - a0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (turnSign < 0) sweep -= Math.PI * 2;

  const radius = Math.abs(r);
  const steps = Math.max(1, Math.ceil(Math.abs(THREE.MathUtils.radToDeg(sweep)) / ARC_STEP_DEG));
  const points: THREE.Vector3[] = [];
  for (let i = 1; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    const y = last.y + ((target.y - last.y) * i) / steps;
    points.push(new THREE.Vector3(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius));
  }
  // The last point is the click itself, to the millimetre: rounding it onto the
  // arc would leave the end of a corner not quite where it was put.
  points[points.length - 1] = new THREE.Vector3(target.x, target.y, target.z);

  const endA = a0 + sweep;
  return {
    points,
    length: radius * Math.abs(sweep),
    // Tangent where the arc ends, turned back into a heading.
    heading: headingOf(-Math.sin(endA) * turnSign, Math.cos(endA) * turnSign),
    radius,
  };
}

function toVec(n: TrackNode): THREE.Vector3 {
  return new THREE.Vector3(n.p[0], n.p[1], n.p[2]);
}
