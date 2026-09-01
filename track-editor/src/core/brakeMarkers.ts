import * as THREE from 'three';
import { frameAtDistance, pathLength, type Frame } from './spline';
import type { SideProfile } from './road';
import { SIGN_DISTANCES } from './textures';

/**
 * Braking boards, worked out from the shape of the circuit.
 *
 * Putting a set of boards down by hand means finding the corner, measuring back
 * 50, 100 and 150 metres along a curve, and getting three objects square to a
 * road that is turning -- for every corner. It is exactly the kind of job the
 * geometry already knows the answer to.
 *
 * Everything here is pure: frames in, placements out, no editor state and no
 * three.js scene, so it can be checked headlessly.
 */

export interface BrakeMarkerCfg {
  /** Metres before the corner to put a board at. */
  distances: number[];
  /**
   * A stretch counts as a corner once its radius drops below this.
   *
   * 200 m is roughly the line between "a corner you brake for" and "a kink you
   * lift for" on a circuit car.
   */
  radius: number;
  /** Least total bend before it is worth signing, degrees. */
  minTurn: number;
  /** How far outside the tarmac edge -- kerb and coloured strip included. */
  offset: number;
  /** Which side of the road the boards stand on. */
  side: 'outside' | 'inside' | 'left' | 'right';
}

/**
 * Two boards closer together than this are one board too many.
 *
 * Through a sequence of corners the 150 m board of one lands right beside the
 * 50 m board of the next, and a driver reading "150" a car's length after
 * "50" learns nothing from either. The one nearer its own corner wins, because
 * that is the one whose distance is still true.
 */
const MIN_BOARD_GAP = 15;

export const DEFAULT_BRAKE_CFG: BrakeMarkerCfg = {
  distances: [50, 100, 150],
  radius: 200,
  minTurn: 35,
  offset: 3,
  side: 'outside',
};

export interface BrakeMarker {
  /** Library key of the board to place. */
  kind: string;
  p: [number, number, number];
  /** Heading in degrees, already facing the oncoming car. */
  rotY: number;
  /** Which board this is, metres. Only used for the name and the status line. */
  distance: number;
  /** Cross section it stands beside, for anything that reads the profile. */
  frame: number;
  /** Where it stands, as a distance along the lap. */
  dist: number;
  /** Distance along the lap of the corner it belongs to. */
  cornerDist: number;
  /**
   * Whether the board stands on the BUILT run off rather than on open ground.
   * The run off is part of the road mesh and rides above the terrain that is
   * tucked underneath it, so a board there must keep its computed height
   * instead of following the terrain, or it sinks to the buried layer.
   */
  onRunoff: boolean;
}

/** Library key carrying a given distance. Mirrors the library's own naming. */
export function brakeMarkerKind(distance: number): string {
  const i = SIGN_DISTANCES.indexOf(distance as (typeof SIGN_DISTANCES)[number]);
  if (i < 0) return 'marker_board';
  return i === 0 ? 'marker_board' : `brake_${distance}`;
}

/** Every board the automatic placement can produce, for cleaning up after it. */
export const BRAKE_MARKER_KINDS: readonly string[] = SIGN_DISTANCES.map(brakeMarkerKind);

/**
 * Signed curvature per cross section, 1/metres. Positive turns right.
 *
 * From the change in heading over the distance travelled, averaged over a few
 * cross sections either side. Raw frame to frame differences are useless here:
 * at a fine sampling the heading step is a fraction of a degree and the noise
 * in it is the same size as the signal, so a straight comes out as a string of
 * imaginary corners.
 */
function curvature(frames: Frame[], closed: boolean, window = 6): Float32Array {
  const n = frames.length;
  const out = new Float32Array(n);
  if (n < 3) return out;
  const heading = (f: Frame) => Math.atan2(f.fwd.x, f.fwd.z);
  for (let i = 0; i < n; i++) {
    const a = i - window;
    const b = i + window;
    if (!closed && (a < 0 || b >= n)) {
      // Near an open end there is nothing to average over; the ends of a track
      // are not where braking boards go anyway.
      out[i] = 0;
      continue;
    }
    const ia = ((a % n) + n) % n;
    const ib = b % n;
    let dTheta = heading(frames[ib]) - heading(frames[ia]);
    // Wrap into -pi..pi, or every lap crossing reads as a hairpin.
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    let ds = frames[ib].dist - frames[ia].dist;
    if (ds <= 0) ds += frames[n - 1].dist + frames[n - 1].pos.distanceTo(frames[0].pos);
    out[i] = ds > 1e-6 ? dTheta / ds : 0;
  }
  return out;
}

/**
 * Total length of the lap. The spline's own, so every distance here means the
 * same thing as it does to `frameAtDistance`.
 */
function lapLength(frames: Frame[], closed: boolean): number {
  return pathLength(frames, closed);
}

export interface Corner {
  /** Cross section where the bend starts. */
  entry: number;
  /** Distance along the lap at the entry. */
  dist: number;
  /** +1 for a right hander, -1 for a left. */
  turn: 1 | -1;
  /** How far it bends in total, degrees. */
  degrees: number;
  /** Tightest radius anywhere in it, metres. */
  radius: number;
}

/**
 * Every corner worth signing, in lap order.
 *
 * A bend starts where the radius drops below the threshold and ends where it
 * has climbed back to half as tight again -- hysteresis, so a corner whose
 * radius wobbles around the threshold is one corner and not five. A run has to
 * turn `minTurn` degrees in total to count, which is what throws out the kinks
 * on a straight.
 */
export function findCorners(frames: Frame[], closed: boolean, cfg: BrakeMarkerCfg): Corner[] {
  const n = frames.length;
  const out: Corner[] = [];
  if (n < 8) return out;
  const k = curvature(frames, closed);
  const enter = 1 / Math.max(1, cfg.radius);
  const leave = enter / 1.5;

  let i = 0;
  // On a ring, start the sweep at a cross section that is NOT already in a
  // corner, so the first corner found is not half of one cut at the seam.
  if (closed) {
    let guard = 0;
    while (guard < n && Math.abs(k[i]) >= leave) {
      i += 1;
      guard += 1;
    }
    if (guard >= n) return out; // a circle: no straights, so no braking boards
  }

  const start = i;
  let seen = 0;
  let run: number[] | null = null;
  while (seen < n) {
    const idx = closed ? (start + seen) % n : seen;
    const mag = Math.abs(k[idx]);
    if (run === null) {
      if (mag >= enter) run = [idx];
    } else if (mag >= leave) {
      run.push(idx);
    } else {
      pushCorner(run);
      run = null;
    }
    seen += 1;
  }
  if (run) pushCorner(run);
  return out;

  function pushCorner(run: number[]) {
    let degrees = 0;
    let tightest = Infinity;
    let sum = 0;
    for (let j = 0; j < run.length; j++) {
      const idx = run[j];
      const prev = run[j - 1] ?? idx;
      let ds = frames[idx].dist - frames[prev].dist;
      if (ds < 0) ds += lapLength(frames, closed);
      degrees += Math.abs(k[idx]) * ds * (180 / Math.PI);
      if (Math.abs(k[idx]) > 1e-9) tightest = Math.min(tightest, 1 / Math.abs(k[idx]));
      sum += k[idx];
    }
    if (degrees < cfg.minTurn) return;
    const entry = run[0];
    out.push({
      entry,
      dist: frames[entry].dist,
      turn: sum >= 0 ? 1 : -1,
      degrees,
      radius: Number.isFinite(tightest) ? tightest : cfg.radius,
    });
  }
}

/** Cross section nearest a distance along the lap, wrapping on a ring. */
function frameAtDist(frames: Frame[], closed: boolean, target: number): number {
  const total = lapLength(frames, closed);
  let d = target;
  if (closed) {
    d = ((d % total) + total) % total;
  } else if (d < 0 || d > total) {
    return -1;
  }
  // The frames are sorted by dist, so this is a plain binary search...
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].dist < d) lo = mid + 1;
    else hi = mid;
  }
  /*
   * ...for the first cross section at or past the target, which is not the same
   * as the NEAREST one. Coarsely sampled, that is a whole segment of error in
   * one direction, and a board is supposed to be 100 m back, not 100 to 108.
   * The last gap of a ring has no cross section past it at all, so the start
   * line is the candidate on that side.
   */
  const before = lo > 0 ? lo - 1 : closed ? frames.length - 1 : 0;
  const gapTo = (i: number) => {
    let g = Math.abs(frames[i].dist - d);
    if (closed) g = Math.min(g, total - g);
    return g;
  };
  return gapTo(before) < gapTo(lo) ? before : lo;
}

const tmp = new THREE.Vector3();

/**
 * Where every braking board goes.
 *
 * Boards are measured back along the ARC, not in a straight line: 100 m before
 * a corner means a hundred metres of driving, and on the approach to a corner
 * that is already turning those two are not the same place.
 */
export function planBrakeMarkers(
  frames: Frame[],
  closed: boolean,
  profile: SideProfile,
  cfg: BrakeMarkerCfg = DEFAULT_BRAKE_CFG,
): BrakeMarker[] {
  const out: BrakeMarker[] = [];
  if (frames.length < 8) return out;
  const corners = findCorners(frames, closed, cfg);
  if (corners.length === 0) return out;
  const k = curvature(frames, closed);
  const enter = 1 / Math.max(1, cfg.radius);
  const lap = lapLength(frames, closed);

  for (const corner of corners) {
    for (const distance of cfg.distances) {
      const target = corner.dist - distance;
      const i = frameAtDist(frames, closed, target);
      if (i < 0) continue;
      /*
       * Skip a board that would land inside another corner. Measured back from
       * a hairpin, the 150 m board of one corner can easily sit in the middle
       * of the one before it, where it means nothing and stands in the way of
       * that corner's own boards.
       */
      if (Math.abs(k[i]) >= enter && i !== corner.entry) continue;

      /*
       * Interpolated, not snapped to the cross section.
       *
       * The cross sections of a long straight can be twelve metres apart, so
       * taking the nearest one puts a "100" board anywhere from 94 to 106 m
       * back -- and the number printed on it is a promise about exactly that.
       * The kerb widths below still come from the nearest section; being half a
       * cross section out about where the kerb ends changes nothing.
       */
      const f = frameAtDistance(frames, closed, target);
      // Outside of the bend: a right hander turns towards +right, so its
      // outside is the left hand edge.
      const side =
        cfg.side === 'left' ? -1
          : cfg.side === 'right' ? 1
            : cfg.side === 'inside' ? corner.turn
              : (-corner.turn as 1 | -1);
      const hard =
        side < 0
          ? f.widthL + profile.kerbWL[i] + profile.apronL[i]
          : f.widthR + profile.kerbWR[i] + profile.apronR[i];
      const lateral = hard + cfg.offset;
      // Flat step outwards, like the run off: on a banked approach an offset
      // along the tilted right vector plants the board under the grass.
      tmp.set(f.right.x, 0, f.right.z);
      if (tmp.lengthSq() > 1e-12) tmp.normalize();
      /*
       * Where the board's FOOT is. Within the run off the surface it stands on
       * is the road mesh, which runs out flat from the tarmac edge, banking
       * included, and sits ABOVE the terrain tucked beneath it. A board there
       * used to follow the terrain and sank to that buried layer, its lower
       * half behind the run off's edge. Beyond the run off the ground is the
       * ground, and terrain following is right.
       */
      const runoffHere = side < 0 ? profile.runoffL[i] : profile.runoffR[i];
      const onRunoff = cfg.offset <= runoffHere + 0.05;
      const half = side < 0 ? f.widthL : f.widthR;
      const y = onRunoff ? f.pos.y + side * f.right.y * half + 0.02 : f.pos.y;
      out.push({
        kind: brakeMarkerKind(distance),
        onRunoff,
        p: [f.pos.x + tmp.x * lateral * side, y, f.pos.z + tmp.z * lateral * side],
        // Facing back down the track, so the car arriving sees the number.
        rotY: (THREE.MathUtils.radToDeg(Math.atan2(-f.fwd.x, -f.fwd.z)) + 360) % 360,
        distance,
        frame: i,
        dist: ((target % lap) + lap) % lap,
        cornerDist: corner.dist,
      });
    }
  }

  /*
   * Thin out anything that ended up on top of something else. Sorted by
   * distance first, so when two boards clash it is the one closer to its own
   * corner that survives -- a "50" is the one you actually brake on.
   */
  const kept: BrakeMarker[] = [];
  for (const m of [...out].sort((a, b) => a.distance - b.distance)) {
    const clash = kept.some(
      (k) => Math.hypot(k.p[0] - m.p[0], k.p[2] - m.p[2]) < MIN_BOARD_GAP,
    );
    if (!clash) kept.push(m);
  }
  return kept;
}
