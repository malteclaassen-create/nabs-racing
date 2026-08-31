import * as THREE from 'three';
import type { PathData, TrackNode } from '../types';
import type { Frame } from './spline';
import { PointIndex } from './spatial';

/**
 * Joining the pit lane to the track.
 *
 * A pit lane that just floats next to the track looks wrong and drives worse:
 * the entry and exit have to sit on the edge of the tarmac, point the same way
 * the cars are going, and be at the same height as the track. Doing that by
 * dragging points around by hand is fiddly, so this works it out.
 */

export interface PitLinkResult {
  nodes: TrackNode[];
  /** Which side of the track the pit lane is on. -1 left, 1 right. */
  side: -1 | 1;
  entryDistance: number;
  exitDistance: number;
}

function nearestFrame(frames: Frame[], p: THREE.Vector3, index: PointIndex): Frame | null {
  const i = index.nearest(p.x, p.z, 100000);
  return i >= 0 ? frames[i] : null;
}

/** Which side of the track a point lies on, seen from the driving direction. */
function sideOf(f: Frame, p: THREE.Vector3): number {
  return (p.x - f.pos.x) * f.right.x + (p.z - f.pos.z) * f.right.z;
}

/**
 * The frame `d` metres further along the track, following the road rather than
 * flying off on its tangent.
 *
 * Walking the arc length is the whole point. Extrapolating `f.fwd` straight
 * ahead is only correct on a straight: on a lane that leaves the inside of a
 * bend, a 40 m tangent cuts the corner and drags the pit lane back across the
 * tarmac -- measured at 4.28 m inside the road edge, deep enough that the
 * lane's own centre line ended up 0.28 m inside it.
 */
function frameAlong(frames: Frame[], from: Frame, d: number): Frame {
  const total = frames[frames.length - 1].dist;
  let target = from.dist + d;
  // A closed track wraps; an open one stops at its ends.
  if (total > 1e-6) {
    while (target < 0) target += total;
    while (target > total) target -= total;
  }
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].dist <= target) lo = mid;
    else hi = mid;
  }
  return frames[target - frames[lo].dist < frames[hi].dist - target ? lo : hi];
}

/** Which side of the track the pit lane runs on. 0 when there is no pit lane. */
export function pitLaneSide(pitFrames: Frame[], trackFrames: Frame[]): -1 | 0 | 1 {
  if (pitFrames.length < 2 || trackFrames.length < 2) return 0;
  const index = new PointIndex(trackFrames.map((f) => f.pos), 30);
  let sum = 0;
  for (const pf of pitFrames) {
    const f = nearestFrame(trackFrames, pf.pos, index);
    if (f) sum += sideOf(f, pf.pos);
  }
  if (sum === 0) return 0;
  return sum < 0 ? -1 : 1;
}

/**
 * Move the first and last pit lane point onto the edge of the track, line the
 * point after each of them up with the track direction so the join is smooth,
 * and put the whole lane at the height of the track next to it.
 */
/**
 * How far the end point is pushed inside the tarmac edge, so the merge has
 * something to glue rather than leaving a stripe of grass at the join.
 */
const BURY = 0.25;

/**
 * How far along the track the second point is placed. Long enough that the
 * spline leaves smoothly, short enough that it cannot swing wide: the old
 * unbounded value was the pit lane's own node spacing, 40 m on the default
 * project.
 */
const leadIn = (spacing: number) => Math.min(Math.max(6, spacing), 25);

export function attachPitLane(
  pit: PathData,
  trackFrames: Frame[],
  levelWithTrack: boolean,
): PitLinkResult | null {
  if (pit.nodes.length < 2 || trackFrames.length < 2) return null;

  const nodes = pit.nodes.map((n) => ({ ...n, p: [...n.p] as [number, number, number] }));
  const index = new PointIndex(trackFrames.map((f) => f.pos), 30);
  const vec = (n: TrackNode) => new THREE.Vector3(n.p[0], n.p[1], n.p[2]);

  // Decide the side from the whole lane, not from a single point, so a wobbly
  // entry cannot flip it.
  let sideSum = 0;
  for (const n of nodes) {
    const f = nearestFrame(trackFrames, vec(n), index);
    if (f) sideSum += sideOf(f, vec(n));
  }
  const side: -1 | 1 = sideSum < 0 ? -1 : 1;

  const edgePoint = (f: Frame, n: TrackNode) => {
    const half = side < 0 ? f.widthL : f.widthR;
    const pitHalf = side < 0 ? n.widthR : n.widthL;
    // The end overlaps the tarmac edge by a little, so the merge glues it
    // flush onto the road instead of leaving a strip of grass at the join.
    // A quarter of a metre is enough for that: the old full metre put a metre
    // of pit surface on the racing line at both ends before the spline had
    // even started curving away.
    return f.pos.clone().addScaledVector(f.right, side * (half + pitHalf - Math.min(BURY, pitHalf)));
  };

  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const fEntry = nearestFrame(trackFrames, vec(first), index);
  const fExit = nearestFrame(trackFrames, vec(last), index);
  if (!fEntry || !fExit) return null;

  // Entry: sit on the track edge, and put the next point the same distance
  // further ALONG the track, at the same distance out from its centre, so the
  // lane leaves parallel to the road and stays off it.
  const entryPos = edgePoint(fEntry, first);
  const oldFirst = vec(first);
  first.p = [entryPos.x, entryPos.y, entryPos.z];
  if (nodes.length >= 3) {
    const second = nodes[1];
    const d = leadIn(vec(second).distanceTo(oldFirst));
    const target = edgePoint(frameAlong(trackFrames, fEntry, d), second);
    second.p = [target.x, second.p[1], target.z];
  }

  // Exit: same idea, but the alignment runs backwards from the last point.
  const exitPos = edgePoint(fExit, last);
  const oldLast = vec(last);
  last.p = [exitPos.x, exitPos.y, exitPos.z];
  if (nodes.length >= 4) {
    const penultimate = nodes[nodes.length - 2];
    const d = leadIn(vec(penultimate).distanceTo(oldLast));
    const target = edgePoint(frameAlong(trackFrames, fExit, -d), penultimate);
    penultimate.p = [target.x, penultimate.p[1], target.z];
  }

  if (levelWithTrack) {
    for (const n of nodes) {
      const f = nearestFrame(trackFrames, vec(n), index);
      if (f) n.p[1] = f.pos.y;
    }
  }

  return {
    nodes,
    side,
    entryDistance: fEntry.dist,
    exitDistance: fExit.dist,
  };
}

/**
 * How close a deco road's end has to come to the tarmac before it is counted
 * as "meant to join". Generous on purpose: the point of the automatic attach
 * is that a road ended roughly at the circuit snaps cleanly onto it.
 */
const ROAD_SNAP = 30;

/**
 * Glue whichever ENDS of a deco road lie near the circuit onto its edge.
 *
 * The same construction attachPitLane uses -- end point onto the tarmac edge,
 * the neighbour led along the track so the spline leaves parallel, heights
 * taken from the road -- but per end and non destructively: a road that starts
 * at the paddock and ends in a field keeps its far end exactly where it was
 * drawn, and the caller gets the original object back untouched when neither
 * end is near the circuit. Run inside the derived pipeline on every rebuild,
 * so the join follows the circuit automatically when the circuit moves.
 */
export function attachRoadEnds(road: PathData, trackFrames: Frame[]): PathData {
  if (road.closed || road.nodes.length < 2 || trackFrames.length < 2) return road;
  const index = new PointIndex(trackFrames.map((f) => f.pos), 30);
  const vec = (n: TrackNode) => new THREE.Vector3(n.p[0], n.p[1], n.p[2]);

  /** Distance from the point to the tarmac edge nearest it, and that frame. */
  const gapOf = (n: TrackNode): { f: Frame; gap: number; side: -1 | 1 } | null => {
    const f = nearestFrame(trackFrames, vec(n), index);
    if (!f) return null;
    const lat = sideOf(f, vec(n));
    const side: -1 | 1 = lat < 0 ? -1 : 1;
    const half = side < 0 ? f.widthL : f.widthR;
    return { f, gap: Math.abs(lat) - half, side };
  };

  const nodes = road.nodes;
  let out: TrackNode[] | null = null;
  const copy = () => out ?? (out = nodes.map((n) => ({ ...n, p: [...n.p] as [number, number, number] })));

  const attachEnd = (endIdx: number, neighbourIdx: number) => {
    const hit = gapOf(nodes[endIdx]);
    if (!hit || hit.gap > ROAD_SNAP) return;
    const list = copy();
    const end = list[endIdx];
    const edgePoint = (f: Frame, n: TrackNode) => {
      const half = hit.side < 0 ? f.widthL : f.widthR;
      const roadHalf = hit.side < 0 ? n.widthR : n.widthL;
      return f.pos.clone().addScaledVector(f.right, hit.side * (half + roadHalf - Math.min(BURY, roadHalf)));
    };
    const endPos = edgePoint(hit.f, end);
    end.p = [endPos.x, endPos.y, endPos.z];
    if (nodes.length >= 3) {
      const nb = list[neighbourIdx];
      const d = leadIn(vec(nodes[neighbourIdx]).distanceTo(vec(nodes[endIdx])));
      // Which way along the track the road leaves: towards the side its second
      // point already lies on, so the join bends as little as possible.
      const along = (vec(nb).x - hit.f.pos.x) * hit.f.fwd.x + (vec(nb).z - hit.f.pos.z) * hit.f.fwd.z;
      const sign = along >= 0 ? 1 : -1;
      const target = edgePoint(frameAlong(trackFrames, hit.f, sign * d), nb);
      // Only pulled towards the edge when the neighbour is close enough to be
      // part of the join itself; a long first leg keeps its drawn heading.
      if (vec(nb).distanceTo(endPos) < 60) nb.p = [target.x, nb.p[1], target.z];
    }
    // The last stretch takes the height of the road it joins, so the merge has
    // a surface at the right level to glue.
    const f2 = nearestFrame(trackFrames, vec(list[neighbourIdx]), index);
    if (f2 && vec(list[neighbourIdx]).distanceTo(endPos) < 60) list[neighbourIdx].p[1] = f2.pos.y;
    return;
  };

  attachEnd(0, 1);
  attachEnd(nodes.length - 1, nodes.length - 2);
  return out ? { ...road, nodes: out } : road;
}

/* ------------------------------------------------------------------ */
/* Gluing a road end onto a paved pad                                  */
/* ------------------------------------------------------------------ */

/**
 * One paved rectangle a road may end at: a ground pad, alone or as the tarmac
 * of a car park prefab. World centre, heading in degrees, half sizes along the
 * pad's own axes, and the height of its top surface.
 */
export interface PadRect {
  x: number;
  z: number;
  rotY: number;
  hx: number;
  hz: number;
  y: number;
}

/** How close a road end has to come to a pad before it means "park here". */
const PAD_SNAP = 20;

/** How far the end tucks in over the pad, so no hairline of ground shows. */
const PAD_BURY = 0.4;

/**
 * Glue free ENDS of a deco road onto the nearest pad edge.
 *
 * The same idea as attachRoadEnds, aimed at a rectangle instead of a ribbon:
 * the end lands ON the pad's edge (a little inside it), the neighbour is set
 * square to that edge so the road arrives perpendicular the way a real access
 * road meets a car park, and the end takes the pad's height so the ground
 * blend pulls the ground -- and with it the pad, which rides the ground --
 * onto the same level.
 *
 * `skipEnd` names ends another attach has already claimed: the circuit and
 * other roads take precedence over a pad standing next to them.
 */
export function attachRoadToPads(
  road: PathData,
  pads: readonly PadRect[],
  skipEnd?: { first?: boolean; last?: boolean },
): PathData {
  if (road.closed || road.nodes.length < 2 || pads.length === 0) return road;

  let out: TrackNode[] | null = null;
  const copy = () =>
    out ?? (out = road.nodes.map((n) => ({ ...n, p: [...n.p] as [number, number, number] })));

  const attachEnd = (endIdx: number, neighbourIdx: number) => {
    const p = road.nodes[endIdx].p;
    let best: { pad: PadRect; lx: number; lz: number; gap: number } | null = null;
    for (const pad of pads) {
      const a = (pad.rotY * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const dx = p[0] - pad.x;
      const dz = p[2] - pad.z;
      // Into the pad's own frame; the inverse of prefabs' `turn`.
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const ox = Math.max(0, Math.abs(lx) - pad.hx);
      const oz = Math.max(0, Math.abs(lz) - pad.hz);
      const gap = Math.hypot(ox, oz);
      if (gap < PAD_SNAP && (!best || gap < best.gap)) best = { pad, lx, lz, gap };
    }
    if (!best) return;

    const { pad, lx, lz } = best;
    // Which edge: the axis the end overshoots most, or is nearest to from the
    // inside. That is the edge the road is clearly aiming at.
    const overX = Math.abs(lx) - pad.hx;
    const overZ = Math.abs(lz) - pad.hz;
    const onXEdge = overX >= overZ;
    // The landing point on that edge, tucked PAD_BURY inside, and kept a metre
    // off the pad's corners so the whole road width lands on tarmac.
    const road2 = copy();
    const end = road2[endIdx];
    const half = Math.max(end.widthL, end.widthR);
    const along = (v: number, h: number) =>
      Math.max(-(h - half - 1), Math.min(h - half - 1, v));
    const le = onXEdge
      ? { x: Math.sign(lx || 1) * (pad.hx - PAD_BURY), z: along(lz, pad.hz) }
      : { x: along(lx, pad.hx), z: Math.sign(lz || 1) * (pad.hz - PAD_BURY) };

    const a = (pad.rotY * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const toWorld = (l: { x: number; z: number }) => ({
      x: pad.x + l.x * cos + l.z * sin,
      z: pad.z - l.x * sin + l.z * cos,
    });
    const we = toWorld(le);
    // A hair above the pad's top, so the road surface lies on the tarmac
    // rather than a millimetre under it.
    end.p = [we.x, pad.y + 0.02, we.z];

    // The neighbour goes square to the edge, outside the pad, so the spline
    // arrives perpendicular -- but only when it is close enough to be part of
    // the approach at all.
    const nb = road2[neighbourIdx];
    const nbDist = Math.hypot(nb.p[0] - we.x, nb.p[2] - we.z);
    if (road.nodes.length >= 3 && nbDist < 60) {
      const d = Math.max(8, Math.min(25, nbDist));
      const ln = onXEdge
        ? { x: Math.sign(lx || 1) * (pad.hx + d), z: le.z }
        : { x: le.x, z: Math.sign(lz || 1) * (pad.hz + d) };
      const wn = toWorld(ln);
      nb.p = [wn.x, nb.p[1], wn.z];
    }
  };

  if (!skipEnd?.first) attachEnd(0, 1);
  if (!skipEnd?.last) attachEnd(road.nodes.length - 1, road.nodes.length - 2);
  return out ? { ...road, nodes: out } : road;
}

/* ------------------------------------------------------------------ */
/* Merging the pit lane surface into the road                          */
/* ------------------------------------------------------------------ */

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / Math.max(1e-6, edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export interface PitMerge {
  frames: Frame[];
  /** 0..1 per cross section: how strongly it is glued to the road surface. */
  weight: Float32Array;
}

/**
 * How far BELOW the road surface the glued pit lane rides where the two meet.
 *
 * It used to be a lift, back when the lane was cut back to the tarmac edge and
 * the two surfaces were meant to end flush: the millimetres kept the join out
 * of the depth buffer's way. The lane now tucks a few centimetres under the
 * edge instead (see EDGE_BITE), so that sliver is genuinely stacked, and the
 * one that has to win is the road. Small enough that driving across it is not
 * a step; large enough that nothing z-fights.
 */
const MERGE_SINK = 0.004;

/**
 * Glue the pit lane onto the road surface wherever the two ribbons meet.
 *
 * The pit lane is its own spline with its own heights. At the entry and exit
 * it runs onto the tarmac, and two independently drawn surfaces through the
 * same space can only either z-fight (after "level with track" they are
 * exactly coplanar) or cut visibly through each other. Neither is fixable by
 * dragging points; the merge has to happen in the geometry.
 *
 * For every pit cross section near the road, the height and the cross slope
 * are pulled onto the road's surface plane, a hair above it, with the pull
 * easing out as the gap between the two edges opens. Past `pitGap` of open
 * ground the lane is entirely its own again, so a lane running parallel in
 * the paddock keeps whatever height the user gave it.
 */
export function mergePitFrames(
  pitFrames: Frame[],
  trackFrames: Frame[],
  pitGap: number,
  /**
   * Width of the concrete beside the lane. The glue used to ease out over the
   * gap between the two TARMACS -- but the concrete spans most of that gap,
   * and it is drawn off these very frames. On a track with an elevation
   * profile a lane 2 m of open tarmac away was only a third glued, and the
   * entry band it carries onto the road floated 16 cm off the surface it was
   * painted on. "Open ground" starts where the concrete ends.
   */
  apron = 0,
  /**
   * Which cross sections are the lane itself; the ones outside are the
   * lead-out. Those lie ON the circuit by construction -- they are the wedge
   * over the tarmac -- so the mismatch guard below must never hold them back:
   * their own heights are an extrapolation of the lane's last slope, and on a
   * track with an elevation profile that runs past the guard's half metre
   * within a few cross sections. Unglued, the wedge floated 16 cm off the
   * road it was painted on.
   */
  lead?: { from: number; to: number },
): PitMerge {
  const weight = new Float32Array(pitFrames.length);
  const none: PitMerge = { frames: pitFrames, weight };
  if (pitFrames.length < 2 || trackFrames.length < 2) return none;

  const index = new PointIndex(trackFrames.map((f) => f.pos), 30);
  const span = Math.max(1, pitGap * 0.8);

  let maxHalf = 0;
  for (const f of trackFrames) maxHalf = Math.max(maxHalf, f.widthL, f.widthR);
  let maxPitHalf = 0;
  for (const f of pitFrames) maxPitHalf = Math.max(maxPitHalf, f.widthL, f.widthR);
  const reach = maxHalf + maxPitHalf + span + 2;

  /* The weights first, for the whole lane, and SMOOTHED along it before any
     frame is touched. The gap under each one is measured to the nearest
     SAMPLED track cross section, and which section is nearest changes in
     steps -- so along a stretch where the gap sits near the easing span, the
     raw weight flickered from section to section. Everything downstream rides
     this number: the glue itself, and through it the concrete's shoulder
     fall, which flickered with it -- the apron's outer edge dipped under the
     ground on one cross section and stood on it at the next, and the seam
     read as a row of clipped triangles at the pit entry. Three passes of the
     same little filter the heights get, and the edge runs straight. */
  for (let i = 0; i < pitFrames.length; i++) {
    const pf = pitFrames[i];
    const ti = index.nearest(pf.pos.x, pf.pos.z, reach);
    if (ti < 0) continue;
    const tf = trackFrames[ti];
    const lateral = (pf.pos.x - tf.pos.x) * tf.right.x + (pf.pos.z - tf.pos.z) * tf.right.z;
    const roadHalf = lateral < 0 ? tf.widthL : tf.widthR;
    const cross = pf.right.x * tf.right.x + pf.right.z * tf.right.z;
    const nearHalf = (((lateral < 0) === (cross >= 0) ? pf.widthR : pf.widthL) + apron) * Math.abs(cross);
    const gap = Math.abs(lateral) - roadHalf - nearHalf;
    weight[i] = 1 - smoothstep(0, span, gap);
  }
  {
    const raw = weight.slice();
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < pitFrames.length - 1; i++) {
        weight[i] = (weight[i - 1] + 2 * weight[i] + weight[i + 1]) / 4;
      }
    }
    for (let i = 0; i < weight.length; i++) {
      /* The upper envelope: the flicker was DIPS in the raw weight, and a dip
         is a cross section that briefly lets go of the road -- its concrete
         drops, its neighbour's does not, and the edge saw-tooths. The peaks
         are already right (glued is glued), so the blur may only fill the
         dips, never shave a section that measured fully glued: shaved, the
         apron leaned on the tarmac 12 cm below it at the mouths, where flush
         is the whole point. */
      weight[i] = Math.max(raw[i], weight[i]);
      // And a hair of spread is no glue at all: the paddock stretch stays
      // exactly weight zero, which the identity of its frames depends on.
      if (weight[i] < 1e-3) weight[i] = 0;
    }
  }

  let frames: Frame[] | null = null;
  for (let i = 0; i < pitFrames.length; i++) {
    const pf = pitFrames[i];
    const ti = index.nearest(pf.pos.x, pf.pos.z, reach);
    if (ti < 0) continue;
    const tf = trackFrames[ti];

    const dx = pf.pos.x - tf.pos.x;
    const dz = pf.pos.z - tf.pos.z;
    const lateral = dx * tf.right.x + dz * tf.right.z;
    const roadHalf = lateral < 0 ? tf.widthL : tf.widthR;

    const w = weight[i];
    if (w <= 1e-3) continue;
    // The raw gap again, for the sink easing below -- the smoothing above is
    // only for the weight.
    const cross = pf.right.x * tf.right.x + pf.right.z * tf.right.z;
    const nearHalf = (((lateral < 0) === (cross >= 0) ? pf.widthR : pf.widthL) + apron) * Math.abs(cross);
    const gap = Math.abs(lateral) - roadHalf - nearHalf;

    /* How far the lane reaches over the tarmac. What is DONE about that is
       pitRoadClip's job -- it measures against the edge polyline itself rather
       than against one sampled cross section. All that is wanted here is a
       measure of how close the two surfaces are, so the sink below can ease in
       over the same distance. */
    const overlap = Math.max(0, -gap);
    const step = tf.dist > 0 ? tf.dist / Math.max(1, ti) : 8;
    const slack = Math.max(0.05, (step * step * Math.abs(tf.curvature ?? 0)) / 8 * 1.5);

    // The road surface plane under the pit lane: follow the bank sideways and
    // the slope forwards, held at the edge height beyond the tarmac. The same
    // construction the terrain corridor uses, so all three surfaces agree.
    // Evaluated at real world points, not by sweeping a lateral offset with
    // the along-track distance held fixed. Whenever the two ribbons are not
    // parallel, moving across the lane also moves you ALONG the track, and
    // ignoring that mis-fitted the plane by up to 0.10 m on a track with an
    // elevation profile -- so the road sheared up through the glued lane, the
    // exact failure this merge exists to prevent.
    const planeOf = (f: Frame, wx: number, wz: number) => {
      const ddx = wx - f.pos.x;
      const ddz = wz - f.pos.z;
      const lat = ddx * f.right.x + ddz * f.right.z;
      const alo = Math.max(-20, Math.min(20, ddx * f.fwd.x + ddz * f.fwd.z));
      const half = lat < 0 ? f.widthL : f.widthR;
      const c = Math.sign(lat) * Math.min(Math.abs(lat), half);
      return f.pos.y + c * f.right.y + alo * f.fwd.y;
    };

    // Blended between the two cross sections the point lies between, not
    // snapped to the nearer one. Fitting the plane to a single frame makes it
    // jump the moment the nearest frame changes, which on a track with an
    // elevation profile put a 119 mm kink into the glued lane -- a step the
    // flat default project never showed.
    const planeY = (wx: number, wz: number) => {
      const alo = (wx - tf.pos.x) * tf.fwd.x + (wz - tf.pos.z) * tf.fwd.z;
      const nj = alo >= 0 ? ti + 1 : ti - 1;
      const other = trackFrames[(nj + trackFrames.length) % trackFrames.length];
      const span = Math.hypot(other.pos.x - tf.pos.x, other.pos.z - tf.pos.z);
      const t = span > 1e-6 ? Math.min(1, Math.abs(alo) / span) : 0;
      const a = planeOf(tf, wx, wz);
      return t > 0 ? a + (planeOf(other, wx, wz) - a) * t : a;
    };
    const yC = planeY(pf.pos.x, pf.pos.z);
    const yL = planeY(pf.pos.x - pf.right.x * pf.widthL, pf.pos.z - pf.right.z * pf.widthL);
    const yR = planeY(pf.pos.x + pf.right.x * pf.widthR, pf.pos.z + pf.right.z * pf.widthR);

    // Cross slope that puts both pit edges on the road plane, so a banked road
    // cannot shear up through one half of the glued lane.
    const slope = (yR - yL) / Math.max(0.5, pf.widthL + pf.widthR);

    /* The lift only applies to the sliver that is genuinely stacked on the
       tarmac, and fades out with it. Riding it on `w` made it a plateau: `w`
       comes from the lateral gap, which is negative -- and therefore
       saturated -- everywhere the two ribbons overlap, so the easing lived
       out in the open field and the junction itself got the full step.

       If the lane was drawn at a height of its own and never levelled with
       the track, the plane fit below is not trustworthy to a millimetre, so
       keep the old separation and take that stretch off the pit surface. */
    const isLead = lead !== undefined && (i < lead.from || i > lead.to);
    const mismatch = !isLead && Math.abs(yC - pf.pos.y) > 0.5;
    const lift = mismatch ? 0.03 : -MERGE_SINK * smoothstep(0, Math.max(slack, 0.2), overlap);

    if (!frames) frames = [...pitFrames];
    const right = new THREE.Vector3(
      pf.right.x,
      pf.right.y + (slope - pf.right.y) * w,
      pf.right.z,
    ).normalize();
    frames[i] = {
      ...pf,
      pos: new THREE.Vector3(pf.pos.x, pf.pos.y + (yC + lift - pf.pos.y) * w, pf.pos.z),
      right,
    };
  }

  /* Smooth the glued height along the lane.
     The road plane is fitted per cross section from the NEAREST track frame,
     and which frame is nearest changes in steps -- so the fitted plane steps
     with it and leaves a crease the lane never had. Averaging along the lane
     removes the quantisation without moving the surface off the road: only
     frames that are actually glued take part, and the ends are held. */
  if (frames) {
    const y = frames.map((f) => f.pos.y);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < frames.length - 1; i++) {
        if (weight[i] <= 1e-3 || weight[i - 1] <= 1e-3 || weight[i + 1] <= 1e-3) continue;
        y[i] = (y[i - 1] + 2 * y[i] + y[i + 1]) / 4;
      }
    }
    for (let i = 0; i < frames.length; i++) {
      /* The smoothing exists to take out the quantisation of the plane fit,
         and those steps are centimetres. On a lead-in descending a real hill
         the profile is CURVED, and an unbounded average pulls the curve
         towards its chord -- measured at the entry of the hilly test oval,
         17 cm up off the road the wedge is painted on. The fit is the truth
         here; the average may only polish it. */
      const fitted = frames[i].pos.y;
      const clamped = Math.max(fitted - 0.04, Math.min(fitted + 0.04, y[i]));
      if (clamped === fitted) continue;
      frames[i] = {
        ...frames[i],
        pos: new THREE.Vector3(frames[i].pos.x, clamped, frames[i].pos.z),
      };
    }
  }

  return frames ? { frames, weight } : none;
}

/* ------------------------------------------------------------------ */
/* Clipping the pit lane against the edge of the track                 */
/* ------------------------------------------------------------------ */

/**
 * How wide the concrete shoulder beside the pit lane is, metres.
 *
 * The fallback only. The real figure is `pitCfg.apron` and it is passed in
 * wherever the ribbon's true width matters -- how far the lane may tuck under
 * the circuit, how far out a junction is looked for, where the lane's edge
 * line hands over to the one on the road. This is what those all fall back to
 * when nobody says, which is the tools and the tests.
 */
export const PIT_APRON = 2.5;

/**
 * The width of the concrete at each cross section of the DRAWN ribbon.
 *
 * Full width along the lane itself, faded to nothing across the lead-out at
 * either end.
 *
 * A pit complex is wider than the circuit it joins -- an 8 m lane with five
 * metres of working lane either side is 18 m against a 14 m road -- so a ribbon
 * that kept its full width all the way to the junction could not tuck under the
 * tarmac at all: the wedge never closes, the lead-out runs out of track, and
 * what is left is a notch of bare ground beside the merge.
 *
 * A real circuit does not carry the concrete to the junction either. The
 * garages stop, the apron stops with them, and the last stretch merges as
 * tarmac. Everything that measures against the ribbon reads its width from
 * here, so the clip, the run off clearance and the mesh all agree about where
 * the concrete actually is.
 */
export function pitApronWidths(
  n: number,
  lead: { from: number; to: number; apronTip?: number } | undefined,
  apron: number,
): Float32Array {
  const out = new Float32Array(n);
  const from = lead ? Math.max(0, lead.from) : 0;
  const to = lead ? Math.min(n - 1, lead.to) : n - 1;
  const tip = Math.min(apron, lead?.apronTip ?? apron);
  for (let i = 0; i < n; i++) {
    if (i >= from && i <= to) {
      out[i] = apron;
      continue;
    }
    const run = i < from ? from : n - 1 - to;
    const into = i < from ? i : n - 1 - i;
    out[i] = run > 0 ? tip + ((apron - tip) * into) / run : apron;
  }
  return out;
}

/**
 * How far the lane is allowed to tuck UNDER the track edge.
 *
 * Ending it exactly on the edge sounds right and looks wrong: both edges are
 * polylines sampled at different spacings, so on the inside of a bend the two
 * chords part company and a hairline of terrain shows through the join. A few
 * centimetres of overlap closes that, and the merge holds the lane a hair
 * below the road plane, so the road stays the surface you drive on.
 */
export const EDGE_BITE = 0.06;

/**
 * The band of a pit cross section that may be drawn, as signed offsets from
 * the lane's centre line: negative left, positive right, in the same units as
 * widthL and widthR.
 *
 * A band rather than two half widths, because at the junction the centre line
 * itself runs onto the tarmac. What is left to draw there is the wedge lying
 * BESIDE the track -- an interval that does not contain the centre at all --
 * and there is no way to say that with a pair of half widths.
 */
export interface PitClip {
  lo: Float32Array;
  hi: Float32Array;
}

/**
 * Where the pit lane has to stop so the track stays intact.
 *
 * This replaces guessing the overlap from the nearest track cross section.
 * That guess was wrong in three ways at once, all of them visible at the
 * junction: it measured the gap to one sampled frame rather than to the edge
 * itself; it divided the answer by how parallel the two ribbons run, which
 * blows up exactly where a lane joins at an angle; and it took the whole
 * correction off ONE side, chosen by a vote over the entire lane, so wherever
 * the geometry disagreed with that vote the lane kept lying on the tarmac and
 * lost a strip off its far edge instead. The concrete shoulder was not
 * corrected at all -- it was faded out by how close the two centre lines run,
 * which is why a wedge of it ended up on the racing line and why stretches of
 * it winked out in the middle of the paddock.
 *
 * What is measured here is the real thing: two rays out of the lane's centre
 * line, one each way, stopped at the first crossing of the track's own edge
 * polyline. Which way each ray crosses says whether the centre is beside the
 * track or on it, and that decides whether the drawn band keeps the centre or
 * sits entirely to one side of it.
 *
 * The edge is the tarmac plus whatever kerb survives beside it, because a kerb
 * is part of the circuit too -- and sideProfile has already taken the kerb
 * away wherever the lane needs the room, so the two agree by construction.
 */
export function pitRoadClip(
  pitFrames: Frame[],
  trackFrames: Frame[],
  trackClosed: boolean,
  /** Extra width the kerb adds beyond the tarmac, per track cross section. */
  kerbL?: Float32Array,
  kerbR?: Float32Array,
  /**
   * How far past its own half width each side of the lane reaches: one width
   * for the whole ribbon, or the tapered run pitApronWidths gives.
   */
  extra: number | Float32Array = PIT_APRON,
  /**
   * Which cross sections are the lane itself. The ones outside that range are
   * the lead-out, and they are tidied at the end: see closeLead.
   */
  lead?: { from: number; to: number },
): PitClip {
  const n = pitFrames.length;
  const lo = new Float32Array(n);
  const hi = new Float32Array(n);
  // The ribbon before the circuit takes anything, kept so the lead-out knows
  // which of its two edges the tarmac has been eating into.
  const wholeLo = new Float32Array(n);
  const wholeHi = new Float32Array(n);
  const m = trackFrames.length;
  const widths = typeof extra === 'number' ? pitApronWidths(n, lead, extra) : extra;
  for (let i = 0; i < n; i++) {
    const e = widths[i] ?? 0;
    wholeLo[i] = -(pitFrames[i].widthL + e);
    wholeHi[i] = pitFrames[i].widthR + e;
    lo[i] = wholeLo[i];
    hi[i] = wholeHi[i];
  }
  if (n === 0 || m < 2) return { lo, hi };

  /* The edge of the circuit, as two polylines: tarmac plus surviving kerb.
     Point k is the left edge at track cross section k, point m + k the right. */
  const pts: THREE.Vector3[] = new Array(m * 2);
  for (let k = 0; k < m; k++) {
    const f = trackFrames[k];
    const wl = f.widthL + (kerbL ? kerbL[k] : 0);
    const wr = f.widthR + (kerbR ? kerbR[k] : 0);
    pts[k] = new THREE.Vector3(f.pos.x - f.right.x * wl, f.pos.y, f.pos.z - f.right.z * wl);
    pts[m + k] = new THREE.Vector3(f.pos.x + f.right.x * wr, f.pos.y, f.pos.z + f.right.z * wr);
  }

  // Segments, each carrying the direction that points AWAY from the tarmac.
  // Which way the ray crosses is what tells outside from inside.
  const room = m * 2 + 2;
  const segA = new Int32Array(room);
  const segB = new Int32Array(room);
  const segNX = new Float64Array(room);
  const segNZ = new Float64Array(room);
  let segs = 0;
  const addSeg = (a: number, b: number, nx: number, nz: number) => {
    segA[segs] = a;
    segB[segs] = b;
    segNX[segs] = nx;
    segNZ[segs] = nz;
    segs += 1;
  };
  for (let k = 0; k < m; k++) {
    const next = k + 1 < m ? k + 1 : trackClosed ? 0 : -1;
    if (next < 0) continue;
    const f = trackFrames[k];
    addSeg(k, next, -f.right.x, -f.right.z);
    addSeg(m + k, m + next, f.right.x, f.right.z);
  }
  if (!trackClosed) {
    // The two open ends are edges as well, or a lane crossing the end of an
    // unfinished track would find nothing to stop at.
    const a = trackFrames[0];
    const z = trackFrames[m - 1];
    addSeg(0, m, -a.fwd.x, -a.fwd.z);
    addSeg(m - 1, m * 2 - 1, z.fwd.x, z.fwd.z);
  }

  // Which segments touch which point, so a ray only ever tests what is near
  // it. Three slots: two along a chain, plus the cap at an open end.
  const SLOTS = 3;
  const ptSeg = new Int32Array(m * 2 * SLOTS).fill(-1);
  const attach = (p: number, s: number) => {
    for (let k = 0; k < SLOTS; k++) {
      if (ptSeg[p * SLOTS + k] < 0) {
        ptSeg[p * SLOTS + k] = s;
        return;
      }
    }
  };
  let longest = 0;
  for (let s = 0; s < segs; s++) {
    attach(segA[s], s);
    attach(segB[s], s);
    const a = pts[segA[s]];
    const b = pts[segB[s]];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l > longest) longest = l;
  }

  const index = new PointIndex(pts, 20);
  const stamp = new Int32Array(segs).fill(-1);
  let run = 0;

  /* How far a ray that starts ON the tarmac can have to run before it leaves
     again. The search has to reach at least that far even when the lane is
     only allowed to be a few metres wide, or a centre line dragged into the
     middle of a wide circuit would find no edge inside its own half width and
     read as open ground. */
  let span = 0;
  for (let k = 0; k < m; k++) {
    const f = trackFrames[k];
    const w = f.widthL + f.widthR + (kerbL ? kerbL[k] : 0) + (kerbR ? kerbR[k] : 0);
    if (w > span) span = w;
  }

  /*
   * The first crossing of the circuit's edge along a ray, as a distance in the
   * ground plane and a flag saying which way it was crossed.
   *
   * dist is Infinity when the ray meets nothing. enter is true when the ray
   * went from open ground onto the tarmac, false when it left the tarmac --
   * which only happens if it started on it.
   *
   * A segment that crosses the ray within the search distance has an endpoint
   * within search + longest of the origin, so the radius cannot miss one.
   */
  const hit = { dist: Infinity, enter: true };
  const cast = (ox: number, oz: number, dx: number, dz: number, search: number) => {
    run += 1;
    hit.dist = Infinity;
    hit.enter = true;
    let outward = 0;
    index.within(ox, oz, search + longest, (j) => {
      for (let k = 0; k < SLOTS; k++) {
        const s = ptSeg[j * SLOTS + k];
        if (s < 0) break;
        if (stamp[s] === run) continue;
        stamp[s] = run;
        const a = pts[segA[s]];
        const b = pts[segB[s]];
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const denom = dx * ez - dz * ex;
        if (Math.abs(denom) < 1e-9) continue;
        const wx = a.x - ox;
        const wz = a.z - oz;
        const t = (wx * ez - wz * ex) / denom;
        if (!(t >= 0) || t >= hit.dist || t > search) continue;
        const u = (wx * dz - wz * dx) / denom;
        if (u < 0 || u > 1) continue;
        hit.dist = t;
        outward = dx * segNX[s] + dz * segNZ[s];
      }
    });
    hit.enter = outward <= 0;
  };

  /*
   * Measured BETWEEN the cross sections as well as on them.
   *
   * The ribbon's edge is a chord from one cross section to the next; the
   * tarmac's is a chord of its own polyline, sampled at a different spacing
   * entirely -- eight metres against four. Pinning the ribbon to the tarmac AT
   * the cross sections therefore says nothing about the metres of quad in
   * between, and where the two curves part company there the ground shows
   * through the join. Measured on the demo circuit before this: 0.22 m of bare
   * ground at pit s=228, with the cross sections either side of it correct.
   *
   * What is corrected is the SAG, not the distance. Between two cross sections
   * the tarmac edge mostly just moves, steadily, and the chord follows that on
   * its own; only the part the chord cannot follow -- how far the middle bows
   * away from the straight line between the ends -- has to be given back. An
   * earlier attempt handed over the whole midpoint distance and pushed the
   * ribbon two thirds of a metre out onto the racing line.
   */
  const selfL = new Float64Array(n);
  const selfR = new Float64Array(n);
  const okL = new Uint8Array(n);
  const okR = new Uint8Array(n);
  const enterL = new Uint8Array(n);
  const enterR = new Uint8Array(n);
  const hitL = new Uint8Array(n);
  const hitR = new Uint8Array(n);
  const flatOf = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const pf = pitFrames[i];
    // Widths are measured along `right`, which is banked; the casts run in the
    // ground plane. One scale factor converts between the two.
    const flat = Math.hypot(pf.right.x, pf.right.z);
    flatOf[i] = flat;
    if (flat < 1e-6) continue;
    const dx = pf.right.x / flat;
    const dz = pf.right.z / flat;
    const search = (Math.max(pf.widthL, pf.widthR) + widths[i]) * flat + span;

    cast(pf.pos.x, pf.pos.z, dx, dz, search);
    hitR[i] = hit.dist < Infinity ? 1 : 0;
    enterR[i] = hit.enter ? 1 : 0;
    selfR[i] = hit.dist / flat;
    okR[i] = hitR[i] && enterR[i] ? 1 : 0;

    cast(pf.pos.x, pf.pos.z, -dx, -dz, search);
    hitL[i] = hit.dist < Infinity ? 1 : 0;
    enterL[i] = hit.enter ? 1 : 0;
    selfL[i] = hit.dist / flat;
    okL[i] = hitL[i] && enterL[i] ? 1 : 0;
  }

  /**
   * The most a cross section may be pushed out to cover its own chord.
   *
   * A real sag is centimetres. Anything larger is not a chord bowing but the
   * geometry changing shape between two cross sections -- the tip of a
   * lead-out does exactly that -- and following it would drag the ribbon onto
   * the circuit to satisfy a neighbour.
   */
  const MAX_SAG = 0.25;
  const bulgeL = new Float64Array(n);
  const bulgeR = new Float64Array(n);

  for (let i = 0; i < n - 1; i++) {
    const a = pitFrames[i];
    const b = pitFrames[i + 1];
    let rx = (a.right.x + b.right.x) / 2;
    let rz = (a.right.z + b.right.z) / 2;
    const flat = Math.hypot(rx, rz);
    if (flat < 1e-6) continue;
    rx /= flat;
    rz /= flat;
    const px = (a.pos.x + b.pos.x) / 2;
    const pz = (a.pos.z + b.pos.z) / 2;
    const search = (Math.max(a.widthL, a.widthR) + widths[i]) * flat + span;

    if (okR[i] && okR[i + 1]) {
      cast(px, pz, rx, rz, search);
      if (hit.dist < Infinity && hit.enter) {
        const sag = hit.dist / flat - (selfR[i] + selfR[i + 1]) / 2;
        const give = Math.min(MAX_SAG, Math.max(0, sag));
        if (give > bulgeR[i]) bulgeR[i] = give;
        if (give > bulgeR[i + 1]) bulgeR[i + 1] = give;
      }
    }
    if (okL[i] && okL[i + 1]) {
      cast(px, pz, -rx, -rz, search);
      if (hit.dist < Infinity && hit.enter) {
        const sag = hit.dist / flat - (selfL[i] + selfL[i + 1]) / 2;
        const give = Math.min(MAX_SAG, Math.max(0, sag));
        if (give > bulgeL[i]) bulgeL[i] = give;
        if (give > bulgeL[i + 1]) bulgeL[i + 1] = give;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (flatOf[i] < 1e-6) continue;
    const rightHit = hitR[i] === 1;
    const leftHit = hitL[i] === 1;
    const rightEnter = enterR[i] === 1;
    const leftEnter = enterL[i] === 1;
    const rightDist = selfR[i] + bulgeR[i];
    const leftDist = selfL[i] + bulgeL[i];

    // Leaving the tarmac rather than reaching it means the centre line started
    // on the circuit -- at the junction it does so by design, and after a
    // careless drag it does so by accident. Either way the band that is left
    // lies to one side of the centre, not around it.
    const onTrack = (rightHit && !rightEnter) || (leftHit && !leftEnter);

    if (!onTrack) {
      if (rightHit) hi[i] = Math.min(hi[i], rightDist + EDGE_BITE);
      if (leftHit) lo[i] = Math.max(lo[i], -leftDist - EDGE_BITE);
      if (hi[i] < lo[i]) hi[i] = lo[i];
      continue;
    }

    /* On the tarmac: the circuit runs from the left exit to the right one, and
       what is drawable is whichever of the two leftovers is wider. Picking one
       rather than keeping both is what makes the junction a wedge: the acute
       side of the crossing carries on until it too reaches the edge, the
       obtuse side has already run out. */
    const leftEdge = leftHit ? -leftDist + EDGE_BITE : Infinity;
    const rightEdge = rightHit ? rightDist - EDGE_BITE : -Infinity;
    const leftRoom = leftHit ? leftEdge - lo[i] : -1;
    const rightRoom = rightHit ? hi[i] - rightEdge : -1;
    if (leftRoom <= 0 && rightRoom <= 0) {
      hi[i] = lo[i];
    } else if (leftRoom >= rightRoom) {
      hi[i] = leftEdge;
    } else {
      lo[i] = rightEdge;
    }
  }

  if (lead) closeLead(lo, hi, lead.from, lead.to, wholeLo, wholeHi);
  return { lo, hi };
}

/**
 * The tip of the lead-out has to come to a point and stay there.
 *
 * The lead runs along the lane's own tangent, and the circuit it is merging
 * into curves away from that tangent sooner or later. Left alone the band
 * therefore narrows to the wedge -- which is the point of it -- and then opens
 * back up on the far side of the track, which would put a slab of concrete in
 * the infield. So the band is only allowed to get narrower as it runs out, and
 * once it is down to a sliver it is closed for good.
 */
const LEAD_TIP = 0.25;

/** The hairline the wedge ends on, so it closes rather than stopping short. */
const LEAD_POINT = 0.02;

function closeLead(
  lo: Float32Array,
  hi: Float32Array,
  from: number,
  to: number,
  /** The band before the circuit took anything, per cross section. */
  wholeLo: Float32Array,
  wholeHi: Float32Array,
): void {
  const walk = (start: number, stop: number, stepDir: 1 | -1) => {
    let p = start - stepDir;
    let a = lo[p];
    let z = hi[p];
    for (let i = start; stepDir > 0 ? i <= stop : i >= stop; i += stepDir) {
      const w = hi[i] - lo[i];
      // Still a wedge: narrowing, and still touching the band before it. A
      // band that jumps clear of its neighbour is the ribbon reappearing on
      // the FAR side of the circuit, which is a slab across the infield, not a
      // junction.
      if (w > LEAD_TIP && w <= z - a + 1e-3 && hi[i] > a && lo[i] < z) {
        p = i;
        a = lo[i];
        z = hi[i];
        continue;
      }
      /* Bring the wedge to a point here and draw nothing beyond it.
         The point goes on the SEAM: the tarmac edge that has been taking the
         band back all the way along. That is where the two sides of a merge
         wedge actually meet, and the final plate then runs from the last band
         down onto the edge and covers the ground between -- closing on the
         ribbon's own outer edge instead left the tip standing wherever the
         band stopped narrowing, which on the dragged demo lane was a 0.2 m
         bare slot right beside the racing line. The seam is read off THIS
         cross section's own band, where the clip has just cut it; the band at
         `p` knows only where the seam used to be, a step earlier and up to a
         metre further onto the circuit. Where this cross section has no band
         left to read -- the clip closed it, or the ribbon jumped to the far
         side of the circuit -- the outer edge stays the safe answer. */
      const outerIsHi = Math.abs(z - wholeHi[p]) <= Math.abs(a - wholeLo[p]);
      const touching = hi[i] - lo[i] > 1e-3 && hi[i] > a && lo[i] < z;
      const mid = touching ? (outerIsHi ? lo[i] : hi[i]) : outerIsHi ? z : a;
      lo[i] = mid - LEAD_POINT / 2;
      hi[i] = mid + LEAD_POINT / 2;
      for (let k = i + stepDir; stepDir > 0 ? k <= stop : k >= stop; k += stepDir) hi[k] = lo[k];
      return;
    }
  };
  if (from > 0) walk(from - 1, 0, -1);
  if (to < lo.length - 1) walk(to + 1, lo.length - 1, 1);
}

/**
 * How far past its own ends the pit ribbon has to be drawn.
 *
 * The lane's spline stops where its CENTRE LINE meets the tarmac. Where it
 * joins at an angle -- which is every real pit lane -- the two edges do not
 * reach the tarmac there: the acute one crossed it metres earlier, the obtuse
 * one has metres still to run. Stopping the ribbon at the last cross section
 * therefore cuts the junction off square and leaves a triangle of grass
 * between the lane and the circuit, which is the notch at both ends.
 *
 * So the ribbon is carried on past the spline along its own tangent, far
 * enough for the obtuse side to reach the edge, and the clip takes back
 * everything that is over the tarmac. What survives is the wedge.
 *
 * Mesh only. The frames the AI line, the pit boxes and the ground corridor are
 * built from are untouched: the lane is exactly as long as it was drawn.
 */
export interface PitLead {
  frames: Frame[];
  /** Index of the first frame that is really the drawn lane. */
  from: number;
  /** Index of the last one. */
  to: number;
  /** Arc length of the real lane, so the limiter window keeps its meaning. */
  length: number;
  /**
   * How much of the concrete the junction can still carry, metres.
   *
   * The lead-out only closes once the whole ribbon has gone under the tarmac,
   * and a modern pit complex is wider than the circuit it joins: an 8 m lane
   * with five metres of working lane either side is 18 m against a 14 m road.
   * So the concrete narrows over the lead-out to whatever the circuit has room
   * for, which is what a real junction does -- the garages stop, the apron
   * stops with them, and the last stretch merges as tarmac.
   */
  apronTip: number;
}

/**
 * How far the tangent may be followed, and how close the lane's end has to be
 * to the circuit before there is a junction to close at all.
 *
 * The cap is generous on purpose: a lane merging at eight degrees needs ninety
 * metres before its outer edge reaches the tarmac, and cutting that short is
 * exactly the square end this exists to remove.
 */
const LEAD_MAX = 140;

/**
 * The shallowest merge that will be drawn, as metres of closing per metre run.
 *
 * A lane that ends exactly parallel to the circuit converges nowhere and its
 * wedge would be infinitely long, so below this the taper is invented rather
 * than measured. One in eight is about what a real pit exit blends at.
 */
const LEAD_MIN_RATE = 0.12;

/** One cross section part way between two others. */
function blendFrames(a: Frame, b: Frame, t: number): Frame {
  const mix = (u: THREE.Vector3, v: THREE.Vector3) =>
    new THREE.Vector3(u.x + (v.x - u.x) * t, u.y + (v.y - u.y) * t, u.z + (v.z - u.z) * t);
  return {
    ...b,
    pos: mix(a.pos, b.pos),
    fwd: mix(a.fwd, b.fwd).normalize(),
    right: mix(a.right, b.right).normalize(),
    up: mix(a.up, b.up).normalize(),
    curvature: a.curvature + (b.curvature - a.curvature) * t,
    dist: a.dist + (b.dist - a.dist) * t,
  };
}

export function pitLead(
  pitFrames: Frame[],
  trackFrames: Frame[],
  pitClosed: boolean,
  /**
   * Whether the circuit is a ring. Guessed from the distance between the first
   * and last cross section before, which was wrong for every track there is:
   * the frames stop one sample short of the seam, and one sample on a five
   * kilometre lap is fifteen metres. A lane joining anywhere near the start
   * line therefore found the end of the array and gave up, which is why the
   * entry had no lead-out at all on a generated circuit.
   */
  trackClosed = false,
  /** Width of the concrete either side of the lane. */
  apron = PIT_APRON,
): PitLead {
  const n = pitFrames.length;
  const base: PitLead = {
    frames: pitFrames,
    from: 0,
    to: Math.max(0, n - 1),
    length: n > 0 ? pitFrames[n - 1].dist : 0,
    apronTip: apron,
  };
  if (n < 2 || pitClosed || trackFrames.length < 2) return base;

  const m = trackFrames.length;
  const index = new PointIndex(trackFrames.map((f) => f.pos), 30);
  // The narrower of the two junctions: one taper for the ribbon, so the mesh,
  // the clip and the clearance do not each have their own idea of it.
  let apronTip = apron;

  /**
   * The lead-out at one end of the lane.
   *
   * `sign` is +1 at the end the lane runs towards and -1 at the one it comes
   * from, so both are built by walking in the lane's own direction of travel.
   *
   * The frames FOLLOW THE CIRCUIT rather than the lane's tangent. Running
   * straight on works only where the track does: the moment it curves away,
   * the wedge stops narrowing and opens back up on the far side, which is a
   * slab of concrete in the infield. Riding the track's own cross sections and
   * closing the lateral offset at the rate the lane was already closing it
   * gives a wedge that hugs the tarmac however the circuit bends.
   */
  const build = (end: Frame, sign: 1 | -1): Frame[] => {
    const ti = index.nearest(end.pos.x, end.pos.z, 200);
    if (ti < 0) return [];
    const tf = trackFrames[ti];
    const lateral = (end.pos.x - tf.pos.x) * tf.right.x + (end.pos.z - tf.pos.z) * tf.right.z;
    const sd = lateral < 0 ? -1 : 1;
    const roadHalf = sd < 0 ? tf.widthL : tf.widthR;
    // No junction, no lead-out: a lane that stops out in the paddock is
    // exactly as long as it was drawn. What counts as "at the circuit" is how
    // far the RIBBON reaches, not the centre line -- a lane whose shoulder is
    // already on the tarmac has a junction whatever its centre says.
    const reachOut = Math.max(end.widthL, end.widthR) + apron;
    if (Math.abs(lateral) - roadHalf > reachOut + 1) return [];

    const dir = end.fwd.x * tf.fwd.x + end.fwd.z * tf.fwd.z < 0 ? -1 : 1;
    const rate = Math.max(LEAD_MIN_RATE, Math.abs(end.fwd.x * tf.right.x + end.fwd.z * tf.right.z));
    /* How far to walk. The estimate is only there to keep the loop short: what
       actually ends the lead is the break at the bottom, where even the outer
       edge has gone under the tarmac. Trusting the estimate alone left the
       ribbon stopping 40 cm short of closing, because the rate is measured at
       the junction and the tarmac's own half width changes along the way. */
    const reach = Math.abs(lateral) - roadHalf + Math.max(end.widthL, end.widthR) + apron;
    const span = Math.min(LEAD_MAX, (reach / rate) * 1.5 + 20);

    // Along the circuit in the lane's direction of travel; index the other way
    // where the lane runs against it.
    const stepIndex = dir * sign;
    const out: Frame[] = [];
    let u = 0;
    let k = ti;
    let prev = tf;
    /*
     * How much of the LANE still sticks out past the near tarmac edge. This is
     * the wedge, and where it reaches zero the junction is closed.
     *
     * The lane, not the whole ribbon: the concrete beside it is wider than the
     * circuit once the apron is set to anything like a real pit complex, so a
     * wedge that had to tuck the concrete under the tarmac too could never
     * close at all and the lead-out simply ran out of track, leaving the notch
     * this walk exists to remove. The concrete does not need to be carried
     * there -- pitRoadClip takes it away against the same tarmac edge, cross
     * section by cross section, which is what a real junction looks like: the
     * apron stops and the lane merges as tarmac.
     */
    const laneReach = Math.max(end.widthL, end.widthR);
    /*
     * How much concrete the junction can carry, and the width the wedge is
     * therefore closed at.
     *
     * The wedge closes when the whole ribbon has gone under the tarmac. That
     * only ever happens if the ribbon is narrower than the road, and a pit
     * complex is not: five metres of working lane either side of an 8 m lane
     * is 18 m against a 14 m circuit, so a wedge measured at full width can
     * never close and the lead-out simply runs out of track. Narrowing the
     * concrete to what fits is what lets it close -- and the metre of margin
     * is what stops it closing on a knife edge, where the last plate is a
     * hairline and the ground beside the circuit shows through.
     *
     * pitApronWidths ramps the drawn concrete down to this same figure over
     * exactly the frames this walk produces, so what is measured here is the
     * width the ribbon is really drawn at.
     */
    const tip = Math.max(0, Math.min(apron, roadHalf - laneReach - 1));
    if (tip < apronTip) apronTip = tip;
    let over = Math.abs(lateral) + laneReach + tip - roadHalf;
    let last: Frame = end;
    for (let guard = 0; guard < m; guard++) {
      const next = k + stepIndex;
      if (next < 0 || next >= m) {
        if (!trackClosed) break;
        k = next < 0 ? m - 1 : 0;
      } else {
        k = next;
      }
      const tk = trackFrames[k];
      u += Math.hypot(tk.pos.x - prev.pos.x, tk.pos.z - prev.pos.z);
      prev = tk;
      if (u > span) break;

      const off = Math.abs(lateral) - rate * u;
      const half = sd < 0 ? tk.widthL : tk.widthR;
      const here: Frame = {
        ...end,
        pos: new THREE.Vector3(
          tk.pos.x + tk.right.x * sd * off,
          tk.pos.y,
          tk.pos.z + tk.right.z * sd * off,
        ),
        fwd: tk.fwd.clone().multiplyScalar(dir),
        right: tk.right.clone().multiplyScalar(dir),
        up: tk.up.clone(),
        curvature: tk.curvature * dir,
        dist: end.dist + sign * u,
      };
      const nowOver = off + laneReach + tip - half;
      if (nowOver <= 0) {
        /* The wedge closes somewhere inside this step. Landing on the track's
           own cross section instead would overshoot it by most of a metre --
           they are eight metres apart -- and the ribbon would end with its
           last plate lying across the racing line. */
        const t = over > 0 ? over / (over - nowOver) : 0;
        out.push(blendFrames(last, here, Math.min(1, Math.max(0, t))));
        break;
      }
      out.push(here);
      over = nowOver;
      last = here;
    }
    return out;
  };

  const head = build(pitFrames[0], -1).reverse();
  const tail = build(pitFrames[n - 1], 1);
  if (head.length === 0 && tail.length === 0) return base;
  return {
    frames: [...head, ...pitFrames, ...tail],
    from: head.length,
    to: head.length + n - 1,
    length: pitFrames[n - 1].dist,
    apronTip,
  };
}

/* ------------------------------------------------------------------ */
/* The lines the junction paints on the CIRCUIT                        */
/* ------------------------------------------------------------------ */

/**
 * The junction MOUTH: the stretch of the track's edge a pit lane crosses.
 *
 * This used to describe a line leaning off the edge onto the racing surface
 * and running a hundred metres down the lap -- a painted lane no real circuit
 * has at a junction like these. What a real circuit does is simpler: the
 * white line along the edge of the tarmac keeps running, and where cars
 * actually cross it -- over the mouth of the entry, and at the end of the
 * exit merge -- it is dashed instead of solid. So this now says WHERE the
 * mouth is, and the road builder redraws its own edge line accordingly.
 * Nothing is ever painted inboard of the edge line any more.
 */
export interface PitTrackLine {
  /** Which side of the circuit it runs on: -1 left, 1 right. */
  side: -1 | 1;
  /** Arc length along the track where the pit lane's own line hands over. */
  junction: number;
  /** Which way along the track the mouth runs from there: away from the lane. */
  dir: 1 | -1;
  /** Arc length of the mouth, from the junction to the lead-out wedge's tip. */
  mouth: number;
  /**
   * Cars cross an entry mouth anywhere along it, so the whole stretch is
   * dashed. An exit stays solid along the seam -- a car leaving the pits has
   * to stay on its own side of it -- and only the far end, where the wedge
   * runs out and merging is allowed, gets the dashes.
   */
  kind: 'entry' | 'exit';
}

/** The mouth is never shorter than a car or longer than a real merge. */
const MOUTH_MIN = 8;
const MOUTH_MAX = 160;

/**
 * Where the two junctions meet the circuit, as stretches of paint on the road.
 *
 * The anchor is the cross section where the concrete beside the lane has been
 * eaten away entirely, so the lane's own asphalt now reaches the tarmac. That
 * is where the lane's edge line has to stop -- from there on the lane and the
 * circuit are one surface and a line along the seam would be marking nothing
 * -- and it is therefore exactly where this one starts.
 */
export function pitTrackLines(
  lead: PitLead,
  clip: PitClip,
  trackFrames: Frame[],
  trackClosed: boolean,
  extra = PIT_APRON,
): PitTrackLine[] {
  const m = trackFrames.length;
  const frames = lead.frames;
  const n = frames.length;
  if (m < 2 || n < 2) return [];

  const index = new PointIndex(trackFrames.map((f) => f.pos), 30);
  const total = trackFrames[m - 1].dist;
  const out: PitTrackLine[] = [];

  /** How much concrete is left between the lane and the circuit at `i`. */
  const shoulder = (i: number): { gap: number; cut: boolean } => {
    const f = frames[i];
    const lo = clip.lo[i];
    const hi = clip.hi[i];
    const cutLo = lo > -(f.widthL + extra) + 0.02;
    const cutHi = hi < f.widthR + extra - 0.02;
    if (cutLo && !cutHi) return { gap: Math.min(Math.max(-f.widthL, lo), hi) - lo, cut: true };
    if (cutHi && !cutLo) return { gap: hi - Math.min(Math.max(f.widthR, lo), hi), cut: true };
    // Both or neither: no single road-facing side to hand over from.
    return { gap: Infinity, cut: cutLo && cutHi };
  };

  /**
   * Walking outwards from the middle of the lane, the point at which the
   * road-facing concrete runs out. Searched from the middle rather than from
   * the lead-out, because a lane laid hard against the circuit is already
   * merging well before its own spline ends.
   *
   * Interpolated between two cross sections rather than snapped to one. They
   * are three or four metres apart and the concrete closes at about a tenth of
   * a metre per metre, so snapping put the handover most of a plate away from
   * where the lane's own line actually stops -- a visible break in what is
   * supposed to be one line.
   */
  const handover = (towards: 1 | -1): THREE.Vector3 | null => {
    const mid = Math.round((lead.from + lead.to) / 2);
    let prev = -1;
    for (let i = mid; i >= 0 && i < n; i += towards) {
      const s = shoulder(i);
      if (s.cut && s.gap <= 0.001) {
        if (prev < 0) return frames[i].pos.clone();
        const before = shoulder(prev).gap;
        const t = before > 0 ? before / (before - s.gap) : 0;
        return frames[prev].pos.clone().lerp(frames[i].pos, Math.min(1, Math.max(0, t)));
      }
      if (s.cut) prev = i;
    }
    return null;
  };

  const add = (at: THREE.Vector3, i: number, towards: 1 | -1) => {
    const f = frames[i];
    const ti = index.nearest(at.x, at.z, 200);
    if (ti < 0) return;
    const tf = trackFrames[ti];
    const lateral = (at.x - tf.pos.x) * tf.right.x + (at.z - tf.pos.z) * tf.right.z;
    const side: -1 | 1 = lateral < 0 ? -1 : 1;
    // The handover's exact arc position, not the nearest cross section's:
    // they are metres apart, and the paint taking over on the circuit has to
    // begin where the lane's own line stops, not a plate up the road from it.
    const junction = tf.dist + ((at.x - tf.pos.x) * tf.fwd.x + (at.z - tf.pos.z) * tf.fwd.z);

    /* Away from the lane along the circuit. The lane travels in `towards`;
       the exit hands over looking forwards and the entry looking backwards, so
       the mouth always opens in the direction the lane is NOT. */
    const along = f.fwd.x * tf.fwd.x + f.fwd.z * tf.fwd.z < 0 ? -1 : 1;
    const dir: 1 | -1 = (towards * along > 0 ? 1 : -1) as 1 | -1;

    // The far end of the mouth is the tip of the lead-out wedge: the last
    // point at which any pit surface still touches the circuit.
    const tip = towards === 1 ? frames[n - 1].pos : frames[0].pos;
    const tj = index.nearest(tip.x, tip.z, 200);
    if (tj < 0) return;
    let mouth = (trackFrames[tj].dist - junction) * dir;
    if (trackClosed && total > 0) {
      mouth = ((mouth % total) + total) % total;
      if (mouth > total / 2) mouth -= total;
    }
    mouth = Math.min(MOUTH_MAX, Math.max(MOUTH_MIN, mouth));
    out.push({ side, junction, dir, mouth, kind: towards === 1 ? 'exit' : 'entry' });
  };

  const tail = handover(1);
  const head = handover(-1);
  if (tail) add(tail, Math.min(n - 1, lead.to), 1);
  if (head) add(head, Math.max(0, lead.from), -1);
  return out;
}

/**
 * Track control points whose road side is close enough to the pit lane that the
 * barrier there would stand in the way. Used by the "open the barrier" action.
 */
export function nodesAlongPitLane(
  trackNodes: TrackNode[],
  pitFrames: Frame[],
  reach: number,
): Array<{ index: number; side: -1 | 1 }> {
  if (pitFrames.length < 2) return [];
  const index = new PointIndex(pitFrames.map((f) => f.pos), 30);
  const out: Array<{ index: number; side: -1 | 1 }> = [];

  trackNodes.forEach((n, i) => {
    const pi = index.nearest(n.p[0], n.p[2], reach);
    if (pi < 0) return;
    const pf = pitFrames[pi];
    const dx = pf.pos.x - n.p[0];
    const dz = pf.pos.z - n.p[2];
    // Without a frame here, fall back to the straight line distance and decide
    // the side from the neighbouring control points.
    const next = trackNodes[(i + 1) % trackNodes.length];
    const prev = trackNodes[(i - 1 + trackNodes.length) % trackNodes.length];
    const fx = next.p[0] - prev.p[0];
    const fz = next.p[2] - prev.p[2];
    const len = Math.hypot(fx, fz) || 1;
    // right = fwd x up, for fwd = (fx, 0, fz) and up = (0,1,0) that is (fz, 0, -fx)
    const rx = fz / len;
    const rz = -fx / len;
    const lateral = dx * rx + dz * rz;
    out.push({ index: i, side: lateral < 0 ? -1 : 1 });
  });

  return out;
}
