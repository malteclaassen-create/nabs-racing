import * as THREE from 'three';
import type { PropInstance } from '../types';
import { LIBRARY_BY_KEY, PAD_SIZE, propTileBox, type PropFootprint } from './library';
import { prefabOf } from './prefabs';
import type { Frame } from './spline';
import type { PointIndex } from './spatial';

/**
 * Deciding where a dropped object actually lands.
 *
 * Lining a garage block up with the one beside it by dragging is hopeless: a
 * few centimetres out and there is either a stripe of grass between them or the
 * two roofs are inside each other, and neither is visible until you fly down to
 * ground level. So when an object is dropped close to a neighbour of the same
 * sort, it is placed flush against it instead.
 *
 * Everything goes through one resolver. The previous arrangement rounded the
 * cursor onto the grid FIRST and then let the neighbour rule overwrite the
 * result, which had two consequences: the flush position was never re-checked
 * against the grid (so a snapped building sat off-grid and the error piled up
 * along a row), and the capture radius was silently eaten by the rounding --
 * 2 - snap/2*sqrt(2), which is nothing at all once the step reaches 5 m, so at
 * those settings flush snapping simply stopped working with no sign of it.
 * Scoring every candidate against the CURSOR removes both.
 *
 * Pure: no store, no scene. That keeps the rule testable on its own and lets
 * the ghost preview, the click and the gizmo drag share one answer.
 */

/** How an object tiles, or null for "put it wherever I clicked". */
export type TileRule = 'grid' | 'row';

/**
 * How far an object is stretched, per axis.
 *
 * One number was enough while everything in the library was scaled evenly.
 * Ground patches are not: width and length are separate settings in metres --
 * a 40 x 25 m slab of concrete is stored as s = [4, 1, 2.5] against a 10 m
 * square. Putting a single number into both half extents made every rule below
 * reason about a square that does not exist, so two patches could not be made
 * to meet however carefully they were aimed. Both axes travel together now.
 */
export interface Scale2 {
  x: number;
  z: number;
}

/** Shared, so the common "not stretched at all" case allocates nothing. */
export const UNIT_SCALE: Scale2 = Object.freeze({ x: 1, z: 1 });

/**
 * The scale a ground patch of `w` x `l` metres is stored at. Anything else
 * ignores the two numbers and stays unstretched, so a caller can hand the
 * current patch size in without first asking what kind of object it has.
 */
export function padScale(kind: string, w: number, l: number): Scale2 {
  if (LIBRARY_BY_KEY.get(kind)?.category !== 'Ground') return UNIT_SCALE;
  return { x: w / PAD_SIZE, z: l / PAD_SIZE };
}

/**
 * Buildings and ground patches tile in both directions -- a terrace along the
 * fronts, a paddock back to back. A barrier is a length of fence, so the only
 * thing that makes sense is carrying on where the last one stopped. A tree has
 * no edges worth aligning.
 *
 * An imported model is measurable now, but nothing says whether it is a hall
 * or a hedge, and guessing wrong is worse than not snapping: a model that
 * latches onto a neighbour it has nothing to do with cannot be put where it
 * was aimed at all. So it stays free, and the measurements it does have go to
 * the preview, the duplicate offset and the inspector.
 */
export function tileRuleOf(kind: string): TileRule | null {
  if (prefabOf(kind)) return 'grid';
  const def = LIBRARY_BY_KEY.get(kind);
  if (!def) return null;
  if (def.category === 'Buildings' || def.category === 'Ground') return 'grid';
  // Parking bay paint tiles like the pads it is painted on: a second row laid
  // next to the first latches flush, so a long car park is rows of one stamp.
  if (def.key.startsWith('park_bays')) return 'grid';
  // The road bridge kit: ramp, deck and pier latch end to end, which is the
  // whole idea of a kit of spans.
  if (def.key.startsWith('bridge_road')) return 'grid';
  if (def.category === 'Barriers') return 'row';
  return null;
}

/** Rotate a point about +Y, matching how three.js turns an object. */
function turn(x: number, z: number, deg: number): { x: number; z: number } {
  const a = THREE.MathUtils.degToRad(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}

const prefabBoxCache = new Map<string, PropFootprint>();

/**
 * The box an object tiles by, for a library key OR a prefab key.
 *
 * A prefab's box is the union of its pieces' boxes, so a second pit complex
 * latches onto the first one instead of being eyeballed -- which is what
 * happened while this function only understood library keys and quietly
 * returned nothing for anything starting with "prefab:".
 */
export function tileBoxOf(kind: string): PropFootprint {
  const prefab = prefabOf(kind);
  if (!prefab) return propTileBox(kind);

  let box = prefabBoxCache.get(kind);
  if (!box) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const part of prefab.parts) {
      const f = propTileBox(part.kind);
      const c = turn(f.cx, f.cz, part.rotY);
      // Quarter turns swap the extents; the library only uses 0 and 180.
      const quarter = Math.abs(Math.round(part.rotY / 90) % 2) === 1;
      const hx = quarter ? f.hz : f.hx;
      const hz = quarter ? f.hx : f.hz;
      minX = Math.min(minX, part.x + c.x - hx);
      maxX = Math.max(maxX, part.x + c.x + hx);
      minZ = Math.min(minZ, part.z + c.z - hz);
      maxZ = Math.max(maxZ, part.z + c.z + hz);
    }
    box = Number.isFinite(minX)
      ? { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, hx: (maxX - minX) / 2, hz: (maxZ - minZ) / 2 }
      : { cx: 0, cz: 0, hx: 0, hz: 0 };
    prefabBoxCache.set(kind, box);
  }
  return box;
}

/**
 * The box an object presents when latching onto a neighbour.
 *
 * For a single object that is just its tile box. For a prefab it is the FIRST
 * piece, carrying the offset it sits at inside the prefab -- so dropping a
 * second pit complex lines its pit building up with the first one's, and a
 * second garage row carries on from the last bay.
 *
 * Matching the prefab's whole outline against one piece of its neighbour
 * cannot work: the union of a pit complex is not centred on the point it is
 * dropped at (the bays hang 8.5 m off the back), so aligning that centre with
 * a pit building's centre lands the copy three and a half metres out.
 */
function snapBoxOf(kind: string): PropFootprint {
  const prefab = prefabOf(kind);
  if (!prefab || prefab.parts.length === 0) return propTileBox(kind);
  const anchor = prefab.parts[0];
  const f = propTileBox(anchor.kind);
  const c = turn(f.cx, f.cz, anchor.rotY);
  const quarter = Math.abs(Math.round(anchor.rotY / 90) % 2) === 1;
  return {
    cx: anchor.x + c.x,
    cz: anchor.z + c.z,
    hx: quarter ? f.hz : f.hx,
    hz: quarter ? f.hx : f.hz,
  };
}

/**
 * Least clearance from a point to a ribbon, measured against its SEGMENTS.
 *
 * A cross section is a slice of road, not an infinite line -- and treating it
 * as one is what stopped grass going on the outside of a corner. Reading the
 * lateral offset alone, a point twenty metres beyond the end of a straight
 * still measures as "half a metre from the centre line" of every cross section
 * on that straight, because it sits dead ahead of them. On the outside of a
 * bend, where the cross sections fan out and point at you, that is most of
 * them: over half the verge of a real circuit came back as "this is tarmac".
 *
 * Projecting onto the segment between two cross sections instead asks the only
 * question that means anything -- how far is this point from the road surface
 * -- and clamping the projection to the segment ends makes the far end of an
 * open path a cap rather than a beam shining down the road.
 *
 * `halfOf` gives the built half width at (segment, t) on the named side, so the
 * caller decides what counts as built.
 */
function ribbonClearance(
  frames: Frame[],
  index: PointIndex,
  x: number,
  z: number,
  reach: number,
  closed: boolean,
  halfOf: (i: number, j: number, t: number, left: boolean) => number,
): number {
  const n = frames.length;
  let best = Infinity;
  if (n === 0) return best;
  if (n === 1) {
    const f = frames[0];
    return Math.hypot(x - f.pos.x, z - f.pos.z) - halfOf(0, 0, 0, false);
  }

  index.within(x, z, reach, (i) => {
    // Both segments meeting at this cross section: the nearest piece of road
    // to a point can be on either side of the section the index handed back.
    for (let k = 0; k < 2; k++) {
      const a = k === 0 ? i - 1 : i;
      if (a < 0 || (a >= n - 1 && !closed)) continue;
      const b = a + 1 < n ? a + 1 : 0;
      const pa = frames[a].pos;
      const pb = frames[b].pos;
      const ex = pb.x - pa.x;
      const ez = pb.z - pa.z;
      const len2 = ex * ex + ez * ez;
      if (len2 < 1e-12) continue;
      let t = ((x - pa.x) * ex + (z - pa.z) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = pa.x + ex * t;
      const qz = pa.z + ez * t;
      const dx = x - qx;
      const dz = z - qz;
      const dist = Math.hypot(dx, dz);
      // Which side, from the right vector of the section this lands nearest.
      const fr = t < 0.5 ? frames[a] : frames[b];
      const left = dx * fr.right.x + dz * fr.right.z < 0;
      const clear = dist - halfOf(a, b, t, left);
      if (clear < best) best = clear;
    }
  });

  return best;
}

/**
 * How much open ground there is at a point, measured out from the edge of the
 * built surface.
 *
 * Negative means the point is on the road, the kerb, the run off or the pit
 * lane. Built from the DERIVED profile rather than the road settings on
 * purpose: `sideProfile` narrows the run off through tight bends and deletes
 * the kerb outright where the pit lane comes alongside, so a caller reading
 * `road.runoffWidth` would think there was 12 m of grass in exactly the cross
 * sections where there is none -- and plant trees on the tarmac at the pit
 * entry.
 *
 * `includeRunoff` decides whether the grass verge counts as built ground.
 * For a tree it does: a run off is somewhere a car leaves the road at speed,
 * and the whole point of it is that there is nothing in it. For grass it very
 * much does not -- the run off IS grass, and keeping tufts off it leaves a
 * shaved strip up to a run off wide between the kerb and the first blade.
 * Either way the tarmac, the kerb and the coloured strip are always out.
 */
export function clearanceAt(
  x: number,
  z: number,
  trackFrames: Frame[],
  trackIndex: PointIndex,
  profile: {
    runoffL: Float32Array;
    runoffR: Float32Array;
    kerbWL: Float32Array;
    kerbWR: Float32Array;
    apronL: Float32Array;
    apronR: Float32Array;
  },
  pitFrames: Frame[],
  pitIndex: PointIndex,
  reach: number,
  includeRunoff = true,
  trackClosed = true,
): number {
  const road = ribbonClearance(trackFrames, trackIndex, x, z, reach, trackClosed, (a, b, t, left) => {
    // Interpolated across the segment: a kerb that runs out or a shoulder that
    // is being pinched changes between one cross section and the next, and the
    // point being asked about is usually between the two.
    const wa = left ? trackFrames[a].widthL : trackFrames[a].widthR;
    const wb = left ? trackFrames[b].widthL : trackFrames[b].widthR;
    const ka = left ? profile.kerbWL[a] + profile.apronL[a] : profile.kerbWR[a] + profile.apronR[a];
    const kb = left ? profile.kerbWL[b] + profile.apronL[b] : profile.kerbWR[b] + profile.apronR[b];
    const ra = includeRunoff ? (left ? profile.runoffL[a] : profile.runoffR[a]) : 0;
    const rb = includeRunoff ? (left ? profile.runoffL[b] : profile.runoffR[b]) : 0;
    return (wa + ka + ra) + ((wb + kb + rb) - (wa + ka + ra)) * t;
  });

  // The lane plus its concrete shoulder. Open, so its ends are caps: a pit
  // lane joined up end to end would fence off everything between them.
  const pit = ribbonClearance(pitFrames, pitIndex, x, z, reach, false, (a, b, t, left) => {
    const wa = (left ? pitFrames[a].widthL : pitFrames[a].widthR) + 2.5;
    const wb = (left ? pitFrames[b].widthL : pitFrames[b].widthR) + 2.5;
    return wa + (wb - wa) * t;
  });

  return Math.min(road, pit);
}

export interface Placement {
  x: number;
  z: number;
  /** Heading in degrees, squared up with the neighbour when flush. */
  rotY: number;
  /** Which rule produced this position, so the UI can say so. */
  rule: 'free' | 'grid' | 'flush';
  /** Set when rule is 'flush': the object it latched onto. */
  neighborId?: string;
}

/* Scratch, because this runs on every mouse move while the place tool is up. */
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const qN = new THREE.Quaternion();
const qNinv = new THREE.Quaternion();
const qM = new THREE.Quaternion();
const offN = new THREE.Vector3();
const offM = new THREE.Vector3();
const want = new THREE.Vector3();
const slot = new THREE.Vector3();

function yQuat(out: THREE.Quaternion, deg: number): THREE.Quaternion {
  return out.setFromAxisAngle(AXIS_Y, THREE.MathUtils.degToRad(deg));
}

/* Slot offsets, refilled per neighbour. Preallocated because this runs for
   every object in the scene on every mouse move while the place tool is up. */
const slotX = [0, 0, 0, 0];
const slotZ = [0, 0, 0, 0];

/**
 * The places a neighbour offers, as offsets of the tile box CENTRE in the
 * neighbour's own frame. Returns how many of the arrays above were filled.
 */
function fillSlots(rule: TileRule, hxN: number, hzN: number, hxM: number, hzM: number): number {
  let n = 0;
  if (rule === 'grid') {
    slotX[n] = hxN + hxM;
    slotZ[n] = 0;
    n += 1;
    slotX[n] = -(hxN + hxM);
    slotZ[n] = 0;
    n += 1;
  }
  slotX[n] = 0;
  slotZ[n] = hzN + hzM;
  n += 1;
  slotX[n] = 0;
  slotZ[n] = -(hzN + hzM);
  n += 1;
  return n;
}

export interface ResolveOptions {
  kind: string;
  /** Where the pointer is, before any rounding. */
  x: number;
  z: number;
  rotY: number;
  props: PropInstance[];
  /** Grid step in metres, 0 for off. */
  snap: number;
  /** How far the object is stretched, per axis. Unstretched by default. */
  scale?: Scale2;
  /** Alt: put it exactly where I am pointing. */
  exact?: boolean;
  excludeId?: string;
  /** How far an object may be pulled to sit flush, in metres. */
  threshold?: number;
}

/**
 * Where an object should land, given where the pointer is.
 *
 * Flush beats the grid whenever a neighbour is within reach, because the grid
 * can only be right by accident -- it knows nothing about how wide the object
 * is. Alt turns everything off.
 */
export function resolvePlacement(opts: ResolveOptions): Placement {
  const { kind, x, z, rotY, props, snap, scale = UNIT_SCALE, exact = false, excludeId } = opts;
  const threshold = opts.threshold ?? 2;

  if (exact) return { x, z, rotY, rule: 'free' };

  const flush = nearestFlush(kind, x, z, rotY, scale, props, excludeId, threshold);
  if (flush) return flush;

  if (snap > 0) {
    return {
      x: Math.round(x / snap) * snap,
      z: Math.round(z / snap) * snap,
      rotY,
      rule: 'grid',
    };
  }
  return { x, z, rotY, rule: 'free' };
}

/**
 * The nearest flush position within `threshold` of the cursor, or null.
 *
 * Exported so a caller can ask the question on its own; `resolvePlacement` is
 * what callers normally want.
 */
export function nearestFlush(
  kind: string,
  x: number,
  z: number,
  rotY: number,
  scale: Scale2,
  props: PropInstance[],
  excludeId?: string,
  threshold = 2,
): Placement | null {
  const rule = tileRuleOf(kind);
  if (!rule) return null;

  const fM = snapBoxOf(kind);
  if (fM.hx <= 0 && fM.hz <= 0) return null;
  // Both axes on their own. Squaring up with the neighbour below rounds the
  // relative heading to a multiple of 180°, so the two boxes always end up
  // axis for axis and no extent ever has to be swapped.
  const hxM = fM.hx * scale.x;
  const hzM = fM.hz * scale.z;

  let best: Placement | null = null;
  // Compared squared, so the inner loop needs no square roots at all.
  let bestDistSq = threshold * threshold;

  for (const other of props) {
    if (other.id === excludeId) continue;
    if (tileRuleOf(other.kind) !== rule) continue;

    const fN = snapBoxOf(other.kind);
    const sxN = other.s[0];
    const szN = other.s[2];
    const hxN = fN.hx * sxN;
    const hzN = fN.hz * szN;
    if (hxN <= 0 && hzN <= 0) continue;

    // Cheap reject before any trigonometry: nothing beyond the two boxes laid
    // end to end plus the threshold can possibly produce a nearby slot.
    const reach = hxN + hzN + hxM + hzM + threshold;
    const dxRaw = x - other.p[0];
    const dzRaw = z - other.p[2];
    if (dxRaw * dxRaw + dzRaw * dzRaw > reach * reach) continue;

    // Square up with the neighbour. Rounding the RELATIVE angle to a multiple
    // of 90° keeps the way the object was aimed -- crosswise included --
    // while forcing its edges parallel to the neighbour's, which is what
    // makes a slot flush. It used to round to 180°, which silently threw a
    // deliberate quarter turn away: aim a row of parking bays across the pad
    // and the ghost snapped back parallel, so the R key looked broken.
    const relative = Math.round((rotY - other.r[1]) / 90) * 90;
    const heading = other.r[1] + relative;
    // Turned crosswise, the object's width lies along the neighbour's length:
    // the slot maths runs in the neighbour's frame, so the extents swap.
    const crosswise = Math.abs(Math.round(relative / 90)) % 2 === 1;
    const mxM = crosswise ? hzM : hxM;
    const mzM = crosswise ? hxM : hzM;

    // Work in the neighbour's own frame by inverting its rotation, rather than
    // writing out sines and sign flips by hand for four separate slots.
    yQuat(qN, other.r[1]);
    qNinv.copy(qN).invert();
    yQuat(qM, heading);

    // Box centres, not origins: a body that is not centred on its own origin
    // moves the centre, and it is the centre the slots are measured from.
    offN.set(fN.cx * sxN, 0, fN.cz * szN).applyQuaternion(qN);
    const centreNX = other.p[0] + offN.x;
    const centreNZ = other.p[2] + offN.z;
    offM.set(fM.cx * scale.x, 0, fM.cz * scale.z).applyQuaternion(qM);

    // Where the cursor is asking to put this object's centre, in that frame.
    want.set(x + offM.x - centreNX, 0, z + offM.z - centreNZ).applyQuaternion(qNinv);

    const count = fillSlots(rule, hxN, hzN, mxM, mzM);
    for (let k = 0; k < count; k++) {
      const dx = want.x - slotX[k];
      const dz = want.z - slotZ[k];
      const distSq = dx * dx + dz * dz;
      if (distSq >= bestDistSq) continue;
      bestDistSq = distSq;
      // Back out to the world, then take the centre offset off again to get
      // the position the object's own origin has to sit at.
      slot.set(slotX[k], 0, slotZ[k]).applyQuaternion(qN);
      best = {
        x: centreNX + slot.x - offM.x,
        z: centreNZ + slot.z - offM.z,
        rotY: norm360(heading),
        rule: 'flush',
        neighborId: other.id,
      };
    }
  }

  return best;
}

/* ------------------------------------------------------------------ */
/* Squaring up with the road                                           */
/* ------------------------------------------------------------------ */

/** Headings are compared and stepped through, so keep them in 0..360. */
function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Which way a stretch of road runs, at the point of it nearest to x, z. */
export interface PathHeading {
  /** Heading in degrees, the way an object with rotY facing +Z would sit. */
  heading: number;
  /** Distance from the query point to that cross section, metres. */
  dist: number;
}

/**
 * The heading of a path at the point of it closest to (x, z), or null when the
 * path is empty.
 *
 * `fwd` is a unit vector in world space and rotY turns an object's local +Z
 * onto (sin, cos), so the heading that lines the two up is atan2(fwd.x, fwd.z).
 */
export function pathHeadingAt(
  x: number,
  z: number,
  frames: Frame[],
  index: PointIndex,
): PathHeading | null {
  const i = index.nearest(x, z);
  if (i < 0 || !frames[i]) return null;
  const f = frames[i];
  return {
    heading: norm360(THREE.MathUtils.radToDeg(Math.atan2(f.fwd.x, f.fwd.z))),
    dist: Math.hypot(x - f.pos.x, z - f.pos.z),
  };
}

/**
 * The heading that lays an object ALONG a stretch of road running at `heading`.
 *
 * Which of the object's own axes that is depends on the object: a length of
 * armco runs along its local Z, a pit building and a stretched slab of concrete
 * along their X. Picking the longer side is the rule that gets both right
 * without a per-object setting, and it is what "concrete along the pit lane"
 * means -- the long side follows the lane, not the short one.
 */
export function alignedHeading(kind: string, scale: Scale2, heading: number): number {
  const box = tileBoxOf(kind);
  const alongX = box.hx * scale.x > box.hz * scale.z;
  return norm360(alongX ? heading - 90 : heading);
}

/* ------------------------------------------------------------------ */
/* Dragging a patch out                                                */
/* ------------------------------------------------------------------ */

/**
 * A world point in the frame of an object turned by `heading`, and back.
 * `turn` already is the inverse of itself given the opposite angle.
 */
function toLocal(x: number, z: number, heading: number): { x: number; z: number } {
  return turn(x, z, -heading);
}

export interface CornerSnap {
  x: number;
  z: number;
  /** Set when the corner was pulled onto a neighbour's edge on that axis. */
  onEdgeX: boolean;
  onEdgeZ: boolean;
}

/**
 * Pull a corner of a patch being dragged out onto the edges of what is already
 * there.
 *
 * Dragging one out freehand and then hoping it lines up is the same losing game
 * flush snapping was written for, only worse: a patch has four edges and the
 * one you care about is usually the far one, metres away from the cursor. Each
 * axis is decided on its own, so a corner can lock onto the neighbour's side
 * while its other coordinate stays exactly where it was dragged to.
 *
 * Everything that tiles on a grid offers its edges, not just other patches:
 * running the concrete up to the front of the garages is as much the job as
 * joining it to the next slab.
 *
 * Only neighbours lying square with the drag count -- one at 30° has no edge a
 * rectangle at 0° could ever be flush against.
 */
export function snapCornerToPads(
  x: number,
  z: number,
  heading: number,
  props: PropInstance[],
  threshold = 2,
  excludeId?: string,
): CornerSnap {
  const here = toLocal(x, z, heading);
  let bestX = threshold;
  let bestZ = threshold;
  const out: CornerSnap = { x, z, onEdgeX: false, onEdgeZ: false };
  let localX = here.x;
  let localZ = here.z;

  for (const other of props) {
    if (other.id === excludeId) continue;
    if (tileRuleOf(other.kind) !== 'grid') continue;

    // Square with the drag, either way round. A quarter turn swaps the extents.
    const rel = norm360(other.r[1] - heading);
    const quarters = Math.round(rel / 90);
    if (Math.abs(rel - quarters * 90) > 1) continue;
    const quarter = quarters % 2 !== 0;

    const f = propTileBox(other.kind);
    const c = turn(f.cx * other.s[0], f.cz * other.s[2], other.r[1]);
    const centre = toLocal(other.p[0] + c.x, other.p[2] + c.z, heading);
    const hx = (quarter ? f.hz * other.s[2] : f.hx * other.s[0]);
    const hz = (quarter ? f.hx * other.s[0] : f.hz * other.s[2]);

    for (const edge of [centre.x - hx, centre.x + hx]) {
      const d = Math.abs(here.x - edge);
      if (d < bestX) {
        bestX = d;
        localX = edge;
        out.onEdgeX = true;
      }
    }
    for (const edge of [centre.z - hz, centre.z + hz]) {
      const d = Math.abs(here.z - edge);
      if (d < bestZ) {
        bestZ = d;
        localZ = edge;
        out.onEdgeZ = true;
      }
    }
  }

  // Nothing caught: hand the corner back untouched rather than the round trip
  // through two rotations, which is the same point give or take a nanometre and
  // makes "the snap did nothing" impossible to assert on.
  if (!out.onEdgeX && !out.onEdgeZ) return out;

  const back = turn(localX, localZ, heading);
  out.x = back.x;
  out.z = back.z;
  return out;
}

export interface PadRect {
  /** Centre of the patch, world. */
  x: number;
  z: number;
  /** Size in metres along the patch's own axes. */
  w: number;
  l: number;
}

/**
 * The patch two dragged corners describe, measured in the frame the drag was
 * aimed at rather than in world axes -- so a rectangle pulled out along the pit
 * lane comes out parallel to it, not to the compass.
 */
export function rectFromDrag(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  heading: number,
): PadRect {
  const a = toLocal(ax, az, heading);
  const b = toLocal(bx, bz, heading);
  const centre = turn((a.x + b.x) / 2, (a.z + b.z) / 2, heading);
  return {
    x: centre.x,
    z: centre.z,
    w: Math.abs(b.x - a.x),
    l: Math.abs(b.z - a.z),
  };
}
