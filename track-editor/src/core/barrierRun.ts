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
 * Modules are placed end to end along the line, each one turned AND stretched
 * to span its own piece of it exactly. Pure geometry: line in, placements out.
 */

export interface RunPiece {
  p: [number, number, number];
  /** Full orientation in degrees, XYZ order, ready to store on a prop. */
  rot: [number, number, number];
  /** Heading in degrees, the same convention as any other placed object. */
  rotY: number;
  /** Stretch along the module's own run axis that makes its ends land exactly. */
  sz: number;
}

export interface LineSample {
  x: number;
  y: number;
  z: number;
}

/**
 * Place modules of `length` metres end to end along a polyline.
 *
 * The line is divided into equal steps as near to `length` as they can be, and
 * each module spans the CHORD of its own step: turned to it, pitched to follow
 * it uphill or down, and scaled along its run so its ends land exactly on the
 * step's ends. Consecutive modules therefore SHARE their endpoints -- there is
 * no gap and no overlap anywhere on a curve, on a slope, or at the far end of
 * the run, which fixed 8 m pieces could never promise. The stretch is at most
 * half a module either way, which the eye does not read on a fence or a rail.
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

  const count = Math.max(1, Math.round(total / length));
  const step = total / count;
  const q = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const e = new THREE.Euler();
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < count; k++) {
    const a = at(k * step);
    const b = at((k + 1) * step);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz < 1e-9) continue;
    const yaw = Math.atan2(dx, dz);
    /*
     * Yaw about the world's up, then pitch about the module's OWN sideways
     * axis, so the run axis lies along the chord in 3D and the module rides a
     * slope instead of stepping down it. Composed as a quaternion and read
     * back as the XYZ Euler every prop stores: writing the pitch straight
     * into r[0] would pitch about the WORLD X, which is only the same thing
     * on a run that happens to head due north.
     */
    q.setFromAxisAngle(Y, yaw);
    q.multiply(qPitch.setFromAxisAngle(X, -Math.atan2(dy, horiz)));
    e.setFromQuaternion(q, 'XYZ');
    out.push({
      p: [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2],
      rot: [
        THREE.MathUtils.radToDeg(e.x),
        THREE.MathUtils.radToDeg(e.y),
        THREE.MathUtils.radToDeg(e.z),
      ],
      rotY: (THREE.MathUtils.radToDeg(yaw) + 360) % 360,
      sz: Math.hypot(horiz, dy) / length,
    });
  }
  return out;

  /** The point `s` metres along the line. */
  function at(s: number): LineSample {
    if (s <= 0) return points[0];
    if (s >= total) return points[points.length - 1];
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
