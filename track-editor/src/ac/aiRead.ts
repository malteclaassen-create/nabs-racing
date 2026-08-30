/**
 * Reader for Assetto Corsa's `fast_lane.ai` and `pit_lane.ai`.
 *
 * src/export/aiLine.ts writes these; this reads them back, and it is the key
 * that makes an imported track EDITABLE rather than just viewable.
 *
 * The editor's tools -- kerbs, painted lines, braking boards, pit boxes -- all
 * work along a centre line with a width either side. A track baked into a kn5
 * has no such thing: it is a pile of triangles. But every drivable AC track
 * ships an AI line, and an AI line is exactly a centre line with a width
 * either side, sampled every metre or two, complete with the surface normal
 * (so banking comes back too). Recovering the spline from it costs nothing and
 * needs no guessing at geometry.
 *
 * Layout, version 7, the same one the writer emits:
 *
 *   int32 version, int32 detailCount, int32 lapTime, int32 sampleCount
 *   detailCount x { float3 position, float length, int32 id }
 *   int32 extraCount
 *   extraCount x { float speed, gas, brake, obsoleteLatG, radius,
 *                  sideLeft, sideRight, camber, direction,
 *                  float3 normal, float length, float3 forward,
 *                  float tag, float grade }
 *
 * Older files stop after the detail block. That is handled: the extras are
 * optional and the widths fall back to a sane default, because a track whose
 * AI line has no widths is still worth importing.
 */

export interface AiPointRead {
  /** World position of the line. */
  pos: [number, number, number];
  /** Distance along the lane from its start, metres. */
  dist: number;
  /** Drivable width to the left / right of the line, metres. 0 when unknown. */
  sideLeft: number;
  sideRight: number;
  /** Surface normal. [0,1,0] when the file has no extras. */
  normal: [number, number, number];
  /** Direction of travel. Zero when the file has no extras. */
  forward: [number, number, number];
  /** Corner radius the game recorded, metres. 0 when unknown. */
  radius: number;
  camber: number;
}

export interface AiLane {
  version: number;
  lapTimeMs: number;
  points: AiPointRead[];
  /** Whether the file carried the per point extras (widths, normals). */
  hasExtras: boolean;
}

const DETAIL_SIZE = 20;
const EXTRA_SIZE = 72;

export function readAiLane(bytes: Uint8Array): AiLane {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  const f32 = () => { const v = dv.getFloat32(o, true); o += 4; return v; };

  if (bytes.length < 16) throw new Error('ai file is too short to be one');
  const version = i32();
  const detailCount = i32();
  const lapTimeMs = i32();
  i32();                                   // sampleCount, always == detailCount

  if (detailCount < 0 || 16 + detailCount * DETAIL_SIZE > bytes.length) {
    throw new Error(`ai file claims ${detailCount} points but is ${bytes.length} bytes`);
  }

  const points: AiPointRead[] = [];
  for (let i = 0; i < detailCount; i++) {
    const x = f32(), y = f32(), z = f32();
    const dist = f32();
    i32();                                 // id, always the index
    points.push({
      pos: [x, y, z], dist,
      sideLeft: 0, sideRight: 0,
      normal: [0, 1, 0], forward: [0, 0, 0],
      radius: 0, camber: 0,
    });
  }

  let hasExtras = false;
  if (o + 4 <= bytes.length) {
    const extraCount = i32();
    if (extraCount === detailCount && o + extraCount * EXTRA_SIZE <= bytes.length) {
      hasExtras = true;
      for (let i = 0; i < extraCount; i++) {
        f32();                             // speed
        f32();                             // gas
        f32();                             // brake
        f32();                             // obsoleteLatG
        const radius = f32();
        const sideLeft = f32();
        const sideRight = f32();
        const camber = f32();
        f32();                             // direction
        const nx = f32(), ny = f32(), nz = f32();
        f32();                             // length, same as dist
        const fx = f32(), fy = f32(), fz = f32();
        f32();                             // tag
        f32();                             // grade
        const p = points[i];
        p.radius = radius;
        p.sideLeft = sideLeft;
        p.sideRight = sideRight;
        p.camber = camber;
        p.normal = [nx, ny, nz];
        p.forward = [fx, fy, fz];
      }
    }
  }

  return { version, lapTimeMs, points, hasExtras };
}

/* ------------------------------------------------------------------ */
/* Interpreting it                                                     */
/* ------------------------------------------------------------------ */

function dist2(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Whether the lane closes on itself.
 *
 * A circuit's fast_lane comes back to where it started; a pit lane and a hill
 * climb do not. The test is the gap between the last point and the first
 * against the typical spacing between neighbours -- an absolute threshold
 * would misjudge both a 300 m kart track and a 25 km Nordschleife.
 */
export function laneIsClosed(lane: AiLane): boolean {
  const p = lane.points;
  if (p.length < 8) return false;
  let step = 0;
  for (let i = 1; i < p.length; i++) step += Math.sqrt(dist2(p[i - 1].pos, p[i].pos));
  step /= p.length - 1;
  const gap = Math.sqrt(dist2(p[p.length - 1].pos, p[0].pos));
  return gap < Math.max(step * 3, 12);
}

/** Total length of the lane in metres, from the recorded distances. */
export function laneLength(lane: AiLane): number {
  const p = lane.points;
  if (p.length < 2) return 0;
  const last = p[p.length - 1];
  // `dist` is cumulative and reliable; fall back to summing if it is not set.
  if (last.dist > 1) return last.dist;
  let sum = 0;
  for (let i = 1; i < p.length; i++) sum += Math.sqrt(dist2(p[i - 1].pos, p[i].pos));
  return sum;
}

/**
 * Bank angle in degrees from a surface normal and a direction of travel,
 * positive raising the RIGHT hand edge -- the editor's own convention for
 * TrackNode.bank.
 *
 * The horizontal "across" vector is the travel direction turned a right angle
 * in the ground plane; how far the normal leans along it is the bank.
 */
export function bankFromNormal(
  normal: [number, number, number],
  forward: [number, number, number],
): number {
  const [nx, , nz] = normal;
  const [fx, , fz] = forward;
  const flat = Math.hypot(fx, fz);
  const nlen = Math.hypot(normal[0], normal[1], normal[2]);
  if (flat < 1e-4 || nlen < 1e-4) return 0;

  const ax = fz / flat, az = -fx / flat;
  const lean = (nx * ax + nz * az) / nlen;
  return Math.asin(Math.max(-1, Math.min(1, lean))) * (180 / Math.PI);
}

export function laneBankDegrees(p: AiPointRead): number {
  return bankFromNormal(p.normal, p.forward);
}

/**
 * Bank for every point of a lane.
 *
 * Uses the direction of travel the file recorded when there is one, and the
 * direction to the neighbouring points when there is not -- and there often is
 * not: measured across an installation, plenty of tracks store good surface
 * normals with the forward vector left at zero, and reading only the stored
 * field would silently flatten every banked corner on them.
 */
export function laneBanks(lane: AiLane): Float32Array {
  const p = lane.points;
  const out = new Float32Array(p.length);
  if (p.length < 2) return out;
  const closed = laneIsClosed(lane);

  for (let i = 0; i < p.length; i++) {
    let fwd = p[i].forward;
    if (Math.hypot(fwd[0], fwd[1], fwd[2]) < 1e-4) {
      const prev = i > 0 ? p[i - 1] : closed ? p[p.length - 1] : p[i];
      const next = i < p.length - 1 ? p[i + 1] : closed ? p[0] : p[i];
      fwd = [
        next.pos[0] - prev.pos[0],
        next.pos[1] - prev.pos[1],
        next.pos[2] - prev.pos[2],
      ];
    }
    out[i] = bankFromNormal(p[i].normal, fwd);
  }
  return out;
}

/**
 * Whether the extras block actually carries anything.
 *
 * Some files -- every pit_lane.ai looked at, for one -- have the block present
 * but filled with zeroes. `hasExtras` says the bytes were there; this says
 * they mean something. Widths of zero would otherwise come through as a track
 * with no width at all.
 */
export function laneHasWidths(lane: AiLane): boolean {
  if (!lane.hasExtras) return false;
  let nonZero = 0;
  for (const p of lane.points) if (p.sideLeft > 0.05 || p.sideRight > 0.05) nonZero += 1;
  return nonZero > lane.points.length / 4;
}
