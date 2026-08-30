import type { AiPoint } from '../core/markers';

/**
 * Writer for Assetto Corsa's `fast_lane.ai` / `pit_lane.ai`.
 *
 * Layout (version 7), cross checked against AssettoServer's open source
 * FastLaneParser:
 *
 *   int32  version = 7
 *   int32  detailCount
 *   int32  lapTime
 *   int32  sampleCount
 *   detailCount x {
 *     float3 position
 *     float  length
 *     int32  id
 *   }
 *   int32  extraCount            (must equal detailCount)
 *   extraCount x {
 *     float speed, gas, brake, obsoleteLatG, radius
 *     float sideLeft, sideRight, camber, direction
 *     float3 normal
 *     float length
 *     float3 forwardVector
 *     float tag, grade
 *   }
 *
 * Speed / gas / brake are estimated from curvature. They are only hints: the
 * AI still works them out live, but sensible values give a better first drive
 * than zeroes. Everything geometric is exact.
 */

/** Lateral grip budget used for the speed estimate, in m/s^2. */
const LAT_ACCEL = 16;
const MAX_SPEED = 92; // m/s, about 330 km/h

export interface AiFileOptions {
  /** Estimated lap time in milliseconds. 0 is accepted by the game. */
  lapTimeMs?: number;
}

export function buildAiFile(points: AiPoint[], opts: AiFileOptions = {}): Uint8Array {
  const n = points.length;
  if (n < 3) return new Uint8Array(0);

  const size = 16 + n * 20 + 4 + n * 72;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let o = 0;

  const i32 = (v: number) => { dv.setInt32(o, v, true); o += 4; };
  const f32 = (v: number) => { dv.setFloat32(o, Number.isFinite(v) ? v : 0, true); o += 4; };

  i32(7);
  i32(n);
  i32(Math.round(opts.lapTimeMs ?? 0));
  i32(n);

  for (let i = 0; i < n; i++) {
    const p = points[i];
    f32(p.pos.x);
    f32(p.pos.y);
    f32(p.pos.z);
    f32(p.dist);
    i32(i);
  }

  i32(n);

  // Curvature limited speed, then a simple backwards pass so braking starts
  // before the corner instead of at the apex.
  const speeds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    speeds[i] = Math.min(MAX_SPEED, Math.sqrt(LAT_ACCEL * Math.max(4, points[i].radius)));
  }
  const DECEL = 12; // m/s^2
  for (let pass = 0; pass < 2; pass++) {
    for (let k = n - 1; k >= 0; k--) {
      const i = k;
      const j = (i + 1) % n;
      const ds = Math.max(0.1, distanceBetween(points, i, j));
      const limit = Math.sqrt(speeds[j] * speeds[j] + 2 * DECEL * ds);
      if (speeds[i] > limit) speeds[i] = limit;
    }
  }

  for (let i = 0; i < n; i++) {
    const p = points[i];
    const next = points[(i + 1) % n];
    const v = speeds[i];
    const vNext = speeds[(i + 1) % n];
    const accelerating = vNext >= v;

    f32(v);                                   // speed
    f32(accelerating ? 1 : 0);                // gas
    f32(accelerating ? 0 : Math.min(1, (v - vNext) / 4)); // brake
    f32(0);                                   // obsoleteLatG
    f32(p.radius);                            // radius
    f32(p.sideLeft);                          // sideLeft
    f32(p.sideRight);                         // sideRight
    f32(p.camber);                            // camber
    f32(1);                                   // direction multiplier
    f32(p.normal.x); f32(p.normal.y); f32(p.normal.z);
    f32(p.dist);                              // length
    f32(p.fwd.x); f32(p.fwd.y); f32(p.fwd.z);
    f32(0);                                   // tag
    f32(0);                                   // grade
    void next;
  }

  return new Uint8Array(buf);
}

function distanceBetween(points: AiPoint[], i: number, j: number): number {
  return points[i].pos.distanceTo(points[j].pos);
}

/** Rough lap time for the header, from the same speed estimate. */
export function estimateLapTimeMs(points: AiPoint[]): number {
  if (points.length < 3) return 0;
  let t = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const d = points[i].pos.distanceTo(points[j].pos);
    const v = Math.max(8, Math.min(MAX_SPEED, Math.sqrt(LAT_ACCEL * Math.max(4, points[i].radius))));
    t += d / v;
  }
  return Math.round(t * 1000);
}
