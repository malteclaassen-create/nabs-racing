import * as THREE from 'three';

/**
 * Laying a run of barrier modules along a drawn line.
 *
 * The barrier tool paints the generated barrier onto the edge of the track, and
 * that is the right tool for the roadside. It is no use at all for a wall
 * across a paddock, a run of armco down a slip road, or a tyre wall on the
 * outside of a corner that the track does not follow -- for those, the barrier
 * has to be drawn where it goes, the same way the track itself is drawn.
 *
 * Modules are placed end to end along the line, each one turned to sit along
 * its own piece of it. Pure geometry: line in, placements out.
 */

export interface RunPiece {
  p: [number, number, number];
  /** Heading in degrees, the same convention as any other placed object. */
  rotY: number;
}

export interface LineSample {
  x: number;
  y: number;
  z: number;
}

/**
 * How much of a module may hang past the end of the line before it is dropped.
 *
 * A run 25 m long out of 8 m modules is three modules and a metre left over.
 * Adding a fourth overshoots by seven metres, which is worse than stopping a
 * metre short; leaving 4.5 m bare is worse than overshooting by 3.5. Half a
 * module is the line where one becomes the other.
 */
const OVERSHOOT = 0.5;

/**
 * Place modules of `length` metres end to end along a polyline.
 *
 * Each module is aimed along the CHORD of the piece of line it covers, not
 * along the tangent at its centre: modules are rigid, so what has to line up is
 * where their ends land. Aiming them at the tangent leaves a wedge of daylight
 * between every pair on a curve.
 */
export function layBarrierRun(points: LineSample[], length: number): RunPiece[] {
  const out: RunPiece[] = [];
  if (points.length < 2 || length <= 0.01) return out;

  // Cumulative distance along the line, measured on the ground: a run up a
  // slope is still laid out in plan, the same way a fence is built.
  const dist: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    dist.push(dist[i - 1] + d);
  }
  const total = dist[dist.length - 1];
  if (total < 1e-6) return out;

  const count = Math.max(1, Math.round(total / length - OVERSHOOT + 0.5));
  for (let k = 0; k < count; k++) {
    const a = at(k * length);
    const b = at((k + 1) * length);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) continue;
    out.push({
      p: [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2],
      rotY: (THREE.MathUtils.radToDeg(Math.atan2(dx, dz)) + 360) % 360,
    });
  }
  return out;

  /** The point `s` metres along the line, carried on past the end if need be. */
  function at(s: number): LineSample {
    if (s <= 0) return points[0];
    if (s >= total) {
      // Past the end, follow the last direction rather than piling up on the
      // final point: an overshooting module has to stick out straight.
      const n = points.length;
      const last = points[n - 1];
      const prev = points[n - 2];
      const seg = Math.hypot(last.x - prev.x, last.z - prev.z) || 1;
      const over = s - total;
      return {
        x: last.x + ((last.x - prev.x) / seg) * over,
        y: last.y + ((last.y - prev.y) / seg) * over,
        z: last.z + ((last.z - prev.z) / seg) * over,
      };
    }
    let i = 1;
    while (i < dist.length - 1 && dist[i] < s) i += 1;
    const t = (s - dist[i - 1]) / Math.max(1e-9, dist[i] - dist[i - 1]);
    const a = points[i - 1];
    const b = points[i];
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }
}

/** Total ground length of a drawn line, for the status line. */
export function runLength(points: LineSample[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return d;
}
