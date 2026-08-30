import * as THREE from 'three';
import type { PathData, TrackNode } from '../types';
import type { SurfaceProbe } from './surfaceProbe';

/**
 * Pinning the recovered centre line onto the circuit that is actually there.
 *
 * The line that comes out of `fast_lane.ai` is a smoothed spline through a
 * racing line: the right shape, roughly the right place. Measured against the
 * real mesh it is up to half a metre out sideways, and its height between
 * control points is interpolated across twelve metre gaps rather than
 * following the tarmac. That is fine for deciding WHERE a corner is and quite
 * useless for deciding where to paint a line.
 *
 * So before anything is generated, every control point is asked of the model:
 * how high is the road here, and how far does it reach either side. The
 * recovered widths -- which came from an AI file and are noisy enough to need
 * a median filter -- are replaced by the distance to the actual edge of the
 * actual tarmac.
 *
 * What is left over after that is the spline between the points, and that is
 * handled at the other end by draping the finished geometry.
 */

/** Keys that mean "black stuff you race on", where a painted line belongs. */
export function isRacingSurface(key: string): boolean {
  return /^(ROAD|ASPHALT|PITLANE|PIT)/i.test(key);
}

/** Keys that mean "hard surface", which a kerb may also stand on. */
export function isHardSurface(key: string): boolean {
  return /^(ROAD|ASPHALT|PITLANE|PIT|CURB|KERB|CONCRETE|OUTER)/i.test(key);
}

export interface ConformOptions {
  /** Furthest the edge search looks either side of the centre, metres. */
  maxHalfWidth?: number;
  /** Which surfaces count as the road whose edge is being looked for. */
  accept?: (surface: string) => boolean;
  /**
   * Keep the recovered width where the model has nothing to say.
   *
   * A control point that lands on a bridge deck the probe does not carry, or
   * beyond the end of an open track, would otherwise get a width of zero and
   * pinch the whole thing shut.
   */
  keepWidthWhenLost?: boolean;
}

export interface ConformReport {
  nodes: number;
  /** How many found the surface under them. */
  grounded: number;
  /** How many found an edge on both sides. */
  measured: number;
  /** Biggest height correction applied, metres. */
  maxLift: number;
  /** Mean absolute difference between recovered and measured half width. */
  meanWidthChange: number;
  /** Half widths pulled back in because the measurement ran off somewhere else. */
  clamped: number;
  warnings: string[];
}

/**
 * How much wider than its neighbours a measured half width may be.
 *
 * Measuring the road off the mesh is right almost everywhere and wrong in one
 * specific place: where the pit lane, the pit entry or a run off apron joins
 * the circuit, the tarmac really is continuous, so the edge walk keeps going
 * and reports the road as thirty metres wide. On the reference circuit that is
 * eleven control points out of four hundred and six, and a kerb drawn there
 * would be laid twenty five metres out in the middle of the pit entry.
 *
 * The fix is local: compare each measurement against the median of its
 * neighbours and refuse anything wildly bigger. Neighbours rather than a fixed
 * limit, because a 9 m club circuit and a 20 m banked oval are both real.
 */
const OUTLIER_FACTOR = 1.5;
const OUTLIER_RADIUS = 12;

function limitWidthOutliers(nodes: TrackNode[], closed: boolean): number {
  const n = nodes.length;
  if (n < OUTLIER_RADIUS * 2) return 0;
  let clamped = 0;

  for (const side of ['widthL', 'widthR'] as const) {
    const values = nodes.map((x) => x[side]);
    const window: number[] = [];
    const limits = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      window.length = 0;
      for (let k = -OUTLIER_RADIUS; k <= OUTLIER_RADIUS; k++) {
        let j = i + k;
        if (closed) j = ((j % n) + n) % n;
        else j = Math.min(n - 1, Math.max(0, j));
        window.push(values[j]);
      }
      window.sort((a, b) => a - b);
      limits[i] = window[OUTLIER_RADIUS] * OUTLIER_FACTOR;
    }
    for (let i = 0; i < n; i++) {
      if (nodes[i][side] > limits[i]) {
        nodes[i] = { ...nodes[i], [side]: limits[i] };
        clamped += 1;
      }
    }
  }
  return clamped;
}

export function conformPathToSurface(
  path: PathData,
  probe: SurfaceProbe,
  options: ConformOptions = {},
): { path: PathData; report: ConformReport } {
  const maxHalf = options.maxHalfWidth ?? 25;
  const accept = options.accept ?? isRacingSurface;
  const keepWidth = options.keepWidthWhenLost !== false;

  const nodes = path.nodes;
  const report: ConformReport = {
    nodes: nodes.length, grounded: 0, measured: 0,
    maxLift: 0, meanWidthChange: 0, clamped: 0, warnings: [],
  };
  if (nodes.length < 2 || probe.triangleCount === 0) {
    if (probe.triangleCount === 0) {
      report.warnings.push('no drivable surface was found in the imported models');
    }
    return { path, report };
  }

  const closed = path.closed && nodes.length >= 3;
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const at = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let widthDelta = 0;
  let widthCount = 0;

  const out: TrackNode[] = nodes.map((node, i) => {
    const prev = nodes[i > 0 ? i - 1 : closed ? nodes.length - 1 : 0].p;
    const next = nodes[i < nodes.length - 1 ? i + 1 : closed ? 0 : nodes.length - 1].p;
    fwd.set(next[0] - prev[0], 0, next[2] - prev[2]);
    if (fwd.lengthSq() < 1e-9) fwd.set(0, 0, 1);
    fwd.normalize();
    // Horizontal across. The edge walk tracks height as it goes, so it climbs
    // a banked corner without needing the banked frame here.
    right.crossVectors(fwd, up).normalize();

    const hit = probe.sample(node.p[0], node.p[2], node.p[1], 20);
    let y = node.p[1];
    if (hit) {
      report.grounded += 1;
      report.maxLift = Math.max(report.maxLift, Math.abs(hit.y - node.p[1]));
      y = hit.y;
    }

    at.set(node.p[0], y, node.p[2]);
    let widthL = node.widthL;
    let widthR = node.widthR;
    if (hit && accept(hit.surface)) {
      const l = probe.edgeFrom(at, right.clone().multiplyScalar(-1), maxHalf, accept);
      const r = probe.edgeFrom(at, right, maxHalf, accept);
      if (l > 0.5 && r > 0.5) {
        report.measured += 1;
        widthDelta += Math.abs(l - node.widthL) + Math.abs(r - node.widthR);
        widthCount += 2;
        widthL = l;
        widthR = r;
      } else if (!keepWidth) {
        widthL = Math.max(0.5, l);
        widthR = Math.max(0.5, r);
      }
    }

    return { ...node, p: [node.p[0], y, node.p[2]] as [number, number, number], widthL, widthR };
  });

  report.meanWidthChange = widthCount > 0 ? widthDelta / widthCount : 0;
  report.clamped = limitWidthOutliers(out, closed);
  if (report.grounded < nodes.length * 0.8) {
    report.warnings.push(
      `only ${report.grounded} of ${nodes.length} control points found road under them; `
      + 'the surfaces.ini keys may not match the mesh names',
    );
  }

  return { path: { closed: path.closed, nodes: out }, report };
}

/* ------------------------------------------------------------------ */
/* Draping finished geometry                                           */
/* ------------------------------------------------------------------ */

export interface DrapeOptions {
  /** How far above the surface the result sits, metres. */
  lift: number;
  /** Vertices further than this from any surface keep their own height. */
  reach?: number;
  /**
   * Refuse corrections bigger than this, metres.
   *
   * A safety rail, not a feature. Draping is meant to remove centimetres of
   * spline error; a correction of metres means the vertex is over something
   * else entirely -- a bridge, a building, the pit lane running alongside --
   * and moving it there would be worse than leaving it.
   */
  maxCorrection?: number;
}

/**
 * Flatten a generated mesh onto the imported surface.
 *
 * FLAT is the whole contract: every vertex ends up at surface + lift. That
 * makes this exactly right for PAINT -- an edge line, a coloured strip -- which
 * has no thickness and whose only requirement is to be a hair above the tarmac
 * everywhere so it neither z-fights nor floats. Measured undraped on a real
 * circuit, a painted line strays up to 0.6 m from the surface; draped it is a
 * uniform 12 mm.
 *
 * It is deliberately NOT used for anything with its own shape. There was a
 * version of this that tried to keep a kerb's relief by preserving each
 * vertex's height above the mesh's lowest point -- which on a circuit with
 * four and a half metres of elevation change lifted the kerbs at the high end
 * of the lap by four and a half metres. And it turned out not to be needed at
 * all: because the centre line is conformed to the surface first, the kerbs
 * the generator produces already sit a measured 0.037 m from the real tarmac
 * on average, worst case 0.15 m. So kerbs are left alone and this handles the
 * flat things.
 *
 * Returns how many vertices found the surface, because "the line is floating"
 * and "the probe found nothing there" look identical on screen and are
 * completely different problems.
 */
export function drapeGeometry(
  geometry: THREE.BufferGeometry,
  probe: SurfaceProbe,
  opts: DrapeOptions,
): { placed: number; total: number } {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  if (!pos) return { placed: 0, total: 0 };
  const reach = opts.reach ?? 6;
  const maxCorrection = opts.maxCorrection ?? 3;
  const array = pos.array as Float32Array;
  const count = pos.count;

  let placed = 0;
  for (let i = 0; i < count; i++) {
    const x = array[i * 3];
    const y = array[i * 3 + 1];
    const z = array[i * 3 + 2];
    const hit = probe.heightAt(x, z, y, reach);
    if (hit === null) continue;
    const target = hit + opts.lift;
    if (Math.abs(target - y) > maxCorrection) continue;
    placed += 1;
    array[i * 3 + 1] = target;
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { placed, total: count };
}
