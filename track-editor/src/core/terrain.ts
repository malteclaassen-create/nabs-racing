import * as THREE from 'three';
import type { BrushSettings, PathData, RoadSettings, SurfaceKey, TerrainSettings } from '../types';
import type { Frame } from './spline';
import { trackBounds } from './spline';
import type { MaterialKey, MeshDef, SideProfile } from './road';
import { EDGE_SINK, PIT_APRON_DROP, runoffBankRise, shoulderDrop } from './road';
import { PIT_APRON, type PitClip } from './pitLink';

/**
 * The terrain is a regular height grid. `heights` holds what the user sculpted.
 * The mesh you see and the mesh that gets exported additionally have the road
 * corridor blended in, so the ground always meets the tarmac exactly.
 *
 * `paint` says what the ground is MADE of, cell by cell. There is only ever one
 * ground, so a gravel bed is not a slab lying on top of the grass -- it is the
 * ground itself, the same vertices, with grass no longer drawn there. That is
 * what makes sculpting under a painted patch work: hills, dips and the road
 * corridor move the gravel exactly as they move everything else, because it is
 * the same surface.
 */

export function createHeights(res: number, base: number): Float32Array {
  const a = new Float32Array(res * res);
  a.fill(base);
  return a;
}

export function cellSize(t: TerrainSettings): number {
  return t.size / (t.res - 1);
}

/* ------------------------------------------------------------------ */
/* What the ground is made of                                          */
/* ------------------------------------------------------------------ */

/**
 * The materials the ground itself can be. The index into this table is what a
 * paint cell stores, and 0 -- plain grass -- is what an unpainted terrain is
 * made of everywhere, so a project with no paint at all costs nothing.
 *
 * Each one is its own mesh in the export, because that is how Assetto Corsa
 * decides what a car is driving on: the name, not the texture.
 */
export const GROUND_KINDS: ReadonlyArray<{
  label: string;
  surface: SurfaceKey;
  material: MaterialKey;
  name: string;
}> = [
  { label: 'Grass', surface: 'GRASS', material: 'terrain', name: '1GRASS_terrain' },
  { label: 'Asphalt', surface: 'ROAD', material: 'asphalt', name: '1ROAD_terrain_asphalt' },
  { label: 'Concrete', surface: 'CONCRETE', material: 'concrete', name: '1CONCRETE_terrain_concrete' },
  { label: 'Gravel', surface: 'SAND', material: 'sand', name: '1SAND_terrain_gravel' },
  /*
   * Concrete again, and the same concrete to look at -- but exported with the
   * PIT surface, so the game turns the speed limiter on over it.
   *
   * The pair is the point. Widening a pit lane means painting concrete beside
   * it, and plain concrete is not a pit lane as far as Assetto Corsa is
   * concerned: the car drives onto the piece you just added and the limiter
   * goes off. There is nothing about the look of concrete that decides that,
   * so the only way to say which you meant is to have both.
   */
  { label: 'Pit lane', surface: 'PIT', material: 'concrete', name: '1PIT_terrain_concrete' },
];

/**
 * How many paint cells fit across one height grid cell.
 *
 * The paint is deliberately FINER than the height grid. At the default 2 km
 * over 257 vertices a grid cell is 7.8 m across, and a gravel trap whose edge
 * can only step in 7.8 m blocks does not read as a gravel trap. Painting at a
 * quarter of that puts the edge within about two metres, which is the width of
 * the transition on a real circuit anyway.
 *
 * It scales the other way with the grid, so the paint field stays at roughly a
 * megabyte whatever the resolution: it is copied on every dab, exactly like the
 * height field, and a four megabyte copy sixty times a second is a stall.
 */
export function paintSub(res: number): number {
  return Math.max(1, Math.min(8, Math.floor(1024 / Math.max(1, res - 1))));
}

/**
 * Paint samples per side.
 *
 * The samples are POINTS on a lattice, not little squares. That is the whole
 * reason a painted edge does not look like a row of tiles: the mesh is cut
 * where the material changes BETWEEN two samples, so a boundary can run
 * diagonally across a cell instead of only along its sides. Squares can only
 * ever produce steps; points produce a line.
 */
export function paintRes(res: number): number {
  return (res - 1) * paintSub(res) + 1;
}

export function createPaint(res: number): Uint8Array {
  const p = paintRes(res);
  return new Uint8Array(p * p);
}

/** Distance between two paint samples in metres. */
export function paintCellSize(t: TerrainSettings): number {
  return t.size / ((t.res - 1) * paintSub(t.res));
}

/**
 * The value stored in the paint field for one material.
 *
 * Zero is reserved: it means "nobody has painted here", which is NOT the same
 * thing as "here is grass". The run off between the tarmac and the barrier
 * takes its material from the road unless the ground brush has been over it,
 * and with grass at zero there was no way to say "grass, and I mean it" -- a
 * gravel run off could never be turned back into a verge one patch at a time.
 * So a painted material is stored as its index plus one, and the untouched
 * field is what it always was: all zeroes.
 */
export const PAINT_NONE = 0;

/** Store `kind`. Pass -1 to rub the paint out and hand the ground back. */
export function paintValue(kind: number): number {
  return kind < 0 ? PAINT_NONE : kind + 1;
}

/** The GROUND_KINDS index one stored byte names. Unpainted reads as grass. */
export function paintKind(value: number): number {
  if (value <= 0) return 0;
  const k = value - 1;
  return k < GROUND_KINDS.length ? k : 0;
}

/** What the ground is made of at a world point. 0 (grass) outside the grid. */
export function sampleGround(
  t: TerrainSettings,
  paint: Uint8Array | null | undefined,
  x: number,
  z: number,
): number {
  return paintKind(sampleGroundValue(t, paint, x, z));
}

/**
 * The raw byte at a world point, so a caller can tell painted grass apart from
 * ground nobody has touched. PAINT_NONE outside the grid.
 */
export function sampleGroundValue(
  t: TerrainSettings,
  paint: Uint8Array | null | undefined,
  x: number,
  z: number,
): number {
  if (!paint) return PAINT_NONE;
  const pw = paintRes(t.res);
  const ps = paintCellSize(t);
  const px = Math.round((x - t.originX) / ps);
  const pz = Math.round((z - t.originZ) / ps);
  if (px < 0 || pz < 0 || px >= pw || pz >= pw) return PAINT_NONE;
  return paint[pz * pw + px];
}

/**
 * How far each paint sample sits from the edge of the last shape drawn near
 * it, in 64ths of a paint cell and negative on the inside.
 *
 * This is what stops a painted edge from being a staircase.
 *
 * The paint itself can only say which material a LATTICE POINT is; the mesh
 * then cuts each little square where two of its corners disagree. Cutting at
 * the midpoint -- the only place the paint alone can justify -- means every
 * boundary is built from steps and 45 degree diagonals, so the one edge that
 * comes out straight is the one that happens to run along or across the grid.
 * Turn the same rectangle by twenty degrees and its long sides break up into
 * exactly the ladder of little steps this field exists to remove.
 *
 * With the distance recorded either side of the boundary, the cut goes where
 * the shape actually crossed rather than halfway, and the edge is as straight
 * as the shape that drew it at any angle at all.
 */
export const EDGE_UNKNOWN = -128;

/** Distances are quantised in 64ths of a paint cell, so they reach two cells. */
const EDGE_SCALE = 64;

/** How far either side of a boundary a distance is worth keeping, in cells. */
const EDGE_BAND = 2;

export function createPaintEdge(res: number): Int8Array {
  const p = paintRes(res);
  const e = new Int8Array(p * p);
  e.fill(EDGE_UNKNOWN);
  return e;
}

/**
 * The paint field as GROUND_KINDS indices, cached against the field itself.
 *
 * The mesh builder wants kinds, the stored field carries kind-plus-one, and it
 * is read several times per rebuild -- the cell classifier, the cut, the
 * fallback for a cell the budget could not split. Decoding it once per field
 * rather than once per read keeps every one of those loops exactly as tight as
 * it was, and the cache is weak so a superseded field still collects.
 */
const decoded = new WeakMap<Uint8Array, Uint8Array>();

function paintKinds(paint: Uint8Array): Uint8Array {
  const hit = decoded.get(paint);
  if (hit) return hit;
  const out = new Uint8Array(paint.length);
  for (let i = 0; i < paint.length; i++) out[i] = paintKind(paint[i]);
  decoded.set(paint, out);
  return out;
}

/**
 * Set every paint sample a shape covers, and note how far the rest sit from
 * its edge.
 *
 * All three shapes come through here, so they cannot disagree about what
 * "inside" means or about how a change is reported. Each is handed in as a
 * SIGNED DISTANCE rather than a yes or no: negative inside, positive outside,
 * in metres. Inside becomes `value`, and everything within `EDGE_BAND` cells of
 * the boundary -- on either side of it -- has its distance written into `edge`,
 * which is what lets the mesh cut the boundary where it really runs. A plain
 * "is this point inside" cannot say that, and a midpoint cut is a staircase.
 *
 * With `probe` set nothing is written and the first sample that would change
 * ends it. That is what keeps a sweep cheap: the pointer stays inside a patch
 * it has already painted for most of a stroke, and every one of those dabs
 * would otherwise copy the whole paint field and rebuild the whole ground mesh
 * to arrive back at the picture that is already on screen. A probe asks about
 * the materials only, so it scans the shape itself rather than the wider band.
 */
function fillPaint(
  t: TerrainSettings,
  paint: Uint8Array,
  edge: Int8Array | null,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  sdf: (x: number, z: number) => number,
  value: number,
  probe: boolean,
): boolean {
  const pw = paintRes(t.res);
  const ps = paintCellSize(t);
  const originX = t.originX;
  const originZ = t.originZ;
  const band = probe || !edge ? 0 : EDGE_BAND * ps;
  const i0 = Math.max(0, Math.floor((bounds.minX - band - originX) / ps));
  const i1 = Math.min(pw - 1, Math.ceil((bounds.maxX + band - originX) / ps));
  const j0 = Math.max(0, Math.floor((bounds.minZ - band - originZ) / ps));
  const j1 = Math.min(pw - 1, Math.ceil((bounds.maxZ + band - originZ) / ps));
  let changed = false;

  for (let jz = j0; jz <= j1; jz++) {
    const wz = originZ + jz * ps;
    const row = jz * pw;
    for (let ix = i0; ix <= i1; ix++) {
      const k = row + ix;
      // The probe only ever asks about samples that would change material, so
      // it can skip the distance for the rest -- which during a sweep is very
      // nearly all of them.
      if (probe && paint[k] === value) continue;
      const d = sdf(originX + ix * ps, wz);
      if (edge && !probe && d > -band && d < band) {
        const q = Math.round((d / ps) * EDGE_SCALE);
        // EDGE_UNKNOWN is -128 and has to stay reachable only by never being
        // written here, so the clamp stops one short of it.
        edge[k] = q < -127 ? -127 : q > 127 ? 127 : q;
      }
      if (d > 0) continue;
      if (paint[k] === value) continue;
      if (probe) return true;
      paint[k] = value;
      changed = true;
    }
  }
  return changed;
}

/** One dab of the ground brush. Returns whether anything actually changed. */
export function paintGroundDisc(
  t: TerrainSettings,
  paint: Uint8Array,
  edge: Int8Array | null,
  x: number,
  z: number,
  radius: number,
  value: number,
  probe = false,
): boolean {
  return fillPaint(
    t,
    paint,
    edge,
    { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius },
    (px, pz) => Math.hypot(px - x, pz - z) - radius,
    value,
    probe,
  );
}

/** A rectangle of ground, turned by `rotY` degrees about its own centre. */
export interface GroundRect {
  x: number;
  z: number;
  w: number;
  l: number;
  rotY: number;
}

/** Paint a rectangle. Returns whether anything actually changed. */
export function paintGroundRect(
  t: TerrainSettings,
  paint: Uint8Array,
  edge: Int8Array | null,
  rect: GroundRect,
  value: number,
  probe = false,
): boolean {
  const a = (rect.rotY * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const hw = rect.w / 2;
  const hl = rect.l / 2;
  // A turned rectangle still has to be found by an axis aligned scan, so the
  // box is the one that holds it whatever the angle.
  const reach = Math.abs(hw * cos) + Math.abs(hl * sin);
  const reachZ = Math.abs(hw * sin) + Math.abs(hl * cos);
  return fillPaint(
    t,
    paint,
    edge,
    { minX: rect.x - reach, maxX: rect.x + reach, minZ: rect.z - reachZ, maxZ: rect.z + reachZ },
    (px, pz) => {
      const dx = px - rect.x;
      const dz = pz - rect.z;
      // Into the rectangle's own frame, where the distance is the textbook box
      // one: how far outside each pair of sides the point is, with the corner
      // case falling out of taking both at once.
      const u = Math.abs(dx * cos + dz * sin) - hw;
      const v = Math.abs(-dx * sin + dz * cos) - hl;
      const out = Math.hypot(Math.max(u, 0), Math.max(v, 0));
      return out > 0 ? out : Math.max(u, v);
    },
    value,
    probe,
  );
}

/**
 * Paint the inside of a closed outline. Returns whether anything changed.
 *
 * Even-odd crossings decide the inside, which is the rule that makes a shape
 * drawn back over itself hollow rather than nonsense, and needs nothing of the
 * outline but its points -- no winding order, no convexity, no self
 * intersection test. The distance is then the nearest edge, signed by it.
 */
export function paintGroundPolygon(
  t: TerrainSettings,
  paint: Uint8Array,
  edge: Int8Array | null,
  points: ReadonlyArray<{ x: number; z: number }>,
  value: number,
  probe = false,
): boolean {
  if (points.length < 3) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const n = points.length;
  return fillPaint(
    t,
    paint,
    edge,
    { minX, maxX, minZ, maxZ },
    (px, pz) => {
      let inside = false;
      let best = Infinity;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = points[i];
        const b = points[j];
        if ((a.z > pz) !== (b.z > pz)
          && px < ((b.x - a.x) * (pz - a.z)) / (b.z - a.z) + a.x) inside = !inside;
        // Distance to the segment a-b, the projection clamped to its ends.
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const len2 = ex * ex + ez * ez;
        let s = len2 > 1e-12 ? ((px - a.x) * ex + (pz - a.z) * ez) / len2 : 0;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
        const dx = px - (a.x + ex * s);
        const dz = pz - (a.z + ez * s);
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      const d = Math.sqrt(best);
      return inside ? -d : d;
    },
    value,
    probe,
  );
}

/** Carry a paint field onto a different grid, by world position. */
export function resamplePaint(
  from: TerrainSettings,
  paint: Uint8Array | null,
  to: TerrainSettings,
): Uint8Array | null {
  if (!paint) return null;
  const pw = paintRes(to.res);
  const ps = paintCellSize(to);
  const out = new Uint8Array(pw * pw);
  let any = false;
  for (let jz = 0; jz < pw; jz++) {
    const z = to.originZ + jz * ps;
    for (let ix = 0; ix < pw; ix++) {
      const v = sampleGroundValue(from, paint, to.originX + ix * ps, z);
      out[jz * pw + ix] = v;
      if (v !== PAINT_NONE) any = true;
    }
  }
  return any ? out : null;
}

/**
 * Carry the edge distances across with the paint.
 *
 * They are lengths, so they are rescaled: the same boundary is a different
 * number of cells away once the cells change size. Anything that lands outside
 * the band the new grid can express goes back to "unknown", where the mesh
 * falls back to a midpoint cut -- a slightly softer edge on a resampled patch,
 * never a wrong one.
 */
export function resamplePaintEdge(
  from: TerrainSettings,
  edge: Int8Array | null,
  to: TerrainSettings,
): Int8Array | null {
  if (!edge) return null;
  const fromPw = paintRes(from.res);
  if (edge.length !== fromPw * fromPw) return null;
  const pw = paintRes(to.res);
  const ps = paintCellSize(to);
  const fromPs = paintCellSize(from);
  const scale = fromPs / ps;
  const out = new Int8Array(pw * pw);
  out.fill(EDGE_UNKNOWN);
  for (let jz = 0; jz < pw; jz++) {
    const z = to.originZ + jz * ps;
    for (let ix = 0; ix < pw; ix++) {
      const px = Math.round((to.originX + ix * ps - from.originX) / fromPs);
      const pz = Math.round((z - from.originZ) / fromPs);
      if (px < 0 || pz < 0 || px >= fromPw || pz >= fromPw) continue;
      const v = edge[pz * fromPw + px];
      if (v === EDGE_UNKNOWN) continue;
      const q = Math.round(v * scale);
      if (q >= -127 && q <= 127) out[jz * pw + ix] = q;
    }
  }
  return out;
}

/**
 * Bilinear sample of any height field laid out on the terrain grid.
 *
 * Deliberately written without a helper closure. This is the inner loop of the
 * pointer raycast, which runs on every mouse move, and of the full grid
 * resample, which runs 37000 times in one go. A tidy little `at(ix, iz)` arrow
 * inside it allocates a closure on every single call: about a megabyte a second
 * just from moving the camera, and five megabytes in one breath when refitting
 * the terrain.
 */
export function sampleHeights(t: TerrainSettings, heights: Float32Array, x: number, z: number): number {
  const res = t.res;
  const last = res - 1;
  const cs = t.size / last;
  const fx = (x - t.originX) / cs;
  const fz = (z - t.originZ) / cs;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;

  const cx0 = x0 < 0 ? 0 : x0 > last ? last : x0;
  const cx1 = x0 + 1 < 0 ? 0 : x0 + 1 > last ? last : x0 + 1;
  const cz0 = (z0 < 0 ? 0 : z0 > last ? last : z0) * res;
  const cz1 = (z0 + 1 < 0 ? 0 : z0 + 1 > last ? last : z0 + 1) * res;

  const h00 = heights[cz0 + cx0];
  const h10 = heights[cz0 + cx1];
  const h01 = heights[cz1 + cx0];
  const h11 = heights[cz1 + cx1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

/* ------------------------------------------------------------------ */
/* Spatial index over the centre line, for the road corridor blend      */
/* ------------------------------------------------------------------ */

/**
 * One drivable ribbon the terrain has to meet: the main road, and the pit lane
 * with its own, much narrower shoulder.
 */
export interface Corridor {
  frames: Frame[];
  /** Kerb width per cross section and side, already narrowed in tight bends. */
  kerbL: Float32Array;
  kerbR: Float32Array;
  /** Shoulder width per cross section and side. Varies along the track. */
  shoulderL: Float32Array;
  shoulderR: Float32Array;
  /** How far the outer edge of the shoulder sits below the tarmac. */
  drop: number;
  /** The width `drop` was dialled in for, so a pinched shoulder falls less. */
  shoulderFull: number;
  /** Whether the ribbon joins up end to end, so the seam segment exists. */
  closed: boolean;
  /**
   * Per-frame factor on `drop`, 0..1. The pit apron lies flush with the road
   * where the lane is glued onto it (see mergeWeight in buildPitMeshes), and
   * the ground has to follow the concrete it actually meets: a corridor that
   * kept the full drop under a glued apron held the ground 15 cm below it.
   */
  dropScale?: Float32Array;
  /**
   * Carry the frame's full camber all the way across the shoulder. The road's
   * run off goes out flat and fades its banking, and the ground under it does
   * the same; the pit apron is concrete of the complex and rides the lane's
   * plane to its outer edge. A corridor that faded the bank under it held the
   * ground a hand above the concrete's low side wherever a glued lane adopted
   * the road's camber.
   */
  fullBank?: boolean;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Where a point falls on the ribbon: which segment, how far along, how far off. */
interface SegmentHit {
  /** Segment start and end cross sections. */
  a: number;
  b: number;
  /** 0..1 along the segment. */
  t: number;
  /** Distance from the centre line, always positive. */
  dist: number;
  /** Which side of the driving direction the point is on. */
  left: boolean;
}

const hitScratch: SegmentHit = { a: 0, b: 0, t: 0, dist: 0, left: false };

/**
 * Project a point onto the two segments meeting at cross section `fi`.
 *
 * The nearest CROSS SECTION is cheap to find and is not the answer on its own:
 * what the ground has to follow is the road SURFACE, and that lives between the
 * sections. Clamping to the ends of the segment is what makes the far end of an
 * open ribbon -- a pit lane -- a cap rather than a beam that keeps shining down
 * the road.
 *
 * Writes into a module scratch object: this runs once per terrain cell per
 * corridor, tens of thousands of times per rebuild, and a fresh object each
 * time is exactly the kind of allocation that turns into a garbage pause.
 */
function projectOnSegments(
  frames: Frame[],
  fi: number,
  x: number,
  z: number,
  closed: boolean,
): SegmentHit {
  const n = frames.length;
  let bestD2 = Infinity;
  hitScratch.a = fi;
  hitScratch.b = fi;
  hitScratch.t = 0;
  for (let k = 0; k < 2; k++) {
    const a = k === 0 ? fi - 1 : fi;
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
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      hitScratch.a = a;
      hitScratch.b = b;
      hitScratch.t = t;
      const fr = t < 0.5 ? frames[a] : frames[b];
      hitScratch.left = dx * fr.right.x + dz * fr.right.z < 0;
    }
  }
  hitScratch.dist = Math.sqrt(bestD2 === Infinity ? 0 : bestD2);
  return hitScratch;
}

export function roadCorridor(
  frames: Frame[],
  road: RoadSettings,
  profile: SideProfile,
  closed = true,
): Corridor {
  // Kerb and coloured strip together: to the ground they are one piece of hard
  // surface it has to come up flush with. Summed into fresh arrays rather than
  // written back into the profile, which the road mesh is still reading.
  const n = frames.length;
  const hardL = new Float32Array(n);
  const hardR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hardL[i] = profile.kerbWL[i] + profile.apronL[i];
    hardR[i] = profile.kerbWR[i] + profile.apronR[i];
  }
  return {
    frames,
    kerbL: hardL,
    kerbR: hardR,
    shoulderL: profile.runoffL,
    shoulderR: profile.runoffR,
    drop: road.runoffDrop,
    shoulderFull: road.runoffWidth,
    closed,
  };
}

export function pitCorridor(
  frames: Frame[],
  apron: number | Float32Array = PIT_APRON,
  /**
   * The drawn band per cross section. The frames run a few cross sections past
   * the wedge tip at each end -- the clip has taken their whole band, nothing
   * of them is drawn -- and a corridor built over them went on sinking the
   * ground 20 cm under a surface that is not there. What showed, right at the
   * edge of the racing line, was a trench of bare earth the length of the
   * overhang. The corridor now ends where the drawn surface ends.
   */
  clip?: PitClip,
  /** How strongly each cross section is glued to the road, from mergePitFrames. */
  mergeWeight?: Float32Array,
): Corridor {
  let from = 0;
  let to = frames.length - 1;
  if (clip) {
    while (from <= to && clip.hi[from] - clip.lo[from] <= 1e-3) from++;
    while (to >= from && clip.hi[to] - clip.lo[to] <= 1e-3) to--;
  }
  if (from > 0 || to < frames.length - 1) {
    frames = frames.slice(from, to + 1);
    if (typeof apron !== 'number') apron = apron.slice(from, to + 1);
    if (mergeWeight) mergeWeight = mergeWeight.slice(from, to + 1);
  }
  const n = frames.length;
  let dropScale: Float32Array | undefined;
  if (mergeWeight) {
    dropScale = new Float32Array(n);
    for (let i = 0; i < n; i++) dropScale[i] = 1 - Math.min(1, mergeWeight[i] ?? 0);
  }
  // The tapered run where there is one: the ground follows the concrete that is
  // really drawn, so it is not pulled down under an apron that has run out.
  const w = typeof apron === 'number' ? new Float32Array(n).fill(apron) : apron;
  let full = 0;
  for (let i = 0; i < w.length; i++) if (w[i] > full) full = w[i];
  const none = new Float32Array(n);
  // A pit lane is open: joining its ends would fence off the whole infield.
  return { frames, kerbL: none, kerbR: none, shoulderL: w, shoulderR: w, drop: PIT_APRON_DROP,
    shoulderFull: Math.max(1e-6, full), closed: false, dropScale, fullBank: true };
}

/**
 * Nearest cross section lookup over a flat bucket grid.
 *
 * This runs once per terrain vertex, so tens of thousands of times per rebuild.
 * A Map keyed on a hashed cell was costing more in lookups than the distance
 * maths it was meant to save, so the buckets live in two typed arrays in the
 * CSR layout: `start` gives the slice of `items` belonging to each cell.
 * Frame positions are copied into flat arrays for the same reason.
 */
class CorridorIndex {
  private cell: number;
  private minCX: number;
  private minCZ: number;
  private nx: number;
  private nz: number;
  private start: Int32Array;
  private items: Int32Array;
  private px: Float64Array;
  private pz: Float64Array;
  private occupied!: Uint8Array;
  private pw = 0;
  readonly maxRadius: number;

  constructor(frames: Frame[], kerb: number, shoulder: number, blend: number) {
    const n = frames.length;
    this.px = new Float64Array(n);
    this.pz = new Float64Array(n);

    let maxHalf = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const f = frames[i];
      this.px[i] = f.pos.x;
      this.pz[i] = f.pos.z;
      if (f.widthL > maxHalf) maxHalf = f.widthL;
      if (f.widthR > maxHalf) maxHalf = f.widthR;
      if (f.pos.x < minX) minX = f.pos.x;
      if (f.pos.x > maxX) maxX = f.pos.x;
      if (f.pos.z < minZ) minZ = f.pos.z;
      if (f.pos.z > maxZ) maxZ = f.pos.z;
    }
    this.maxRadius = maxHalf + kerb + shoulder + blend;
    this.cell = Math.max(10, this.maxRadius);

    // A single control point dragged far away would otherwise blow the bucket
    // grid up to millions of cells, and allocating that per rebuild is worse
    // than the coarser buckets a bigger cell gives.
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    while ((span / this.cell + 2) ** 2 > 250000) this.cell *= 2;

    this.minCX = Math.floor(minX / this.cell);
    this.minCZ = Math.floor(minZ / this.cell);
    this.nx = Math.floor(maxX / this.cell) - this.minCX + 1;
    this.nz = Math.floor(maxZ / this.cell) - this.minCZ + 1;

    const cellCount = this.nx * this.nz;
    const counts = new Int32Array(cellCount + 1);
    const cellOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(this.px[i] / this.cell) - this.minCX;
      const cz = Math.floor(this.pz[i] / this.cell) - this.minCZ;
      const c = cz * this.nx + cx;
      cellOf[i] = c;
      counts[c + 1] += 1;
    }
    for (let c = 0; c < cellCount; c++) counts[c + 1] += counts[c];
    this.start = counts;

    const cursor = new Int32Array(cellCount);
    this.items = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      this.items[this.start[c] + cursor[c]] = i;
      cursor[c] += 1;
    }

    // Occupancy, dilated by one cell and padded by one, so a single byte read
    // rejects the vast majority of terrain vertices before any maths happens.
    // On a big terrain only a few per cent of the grid is anywhere near the
    // track, and those rejections were the bulk of the mask build.
    this.pw = this.nx + 2;
    this.occupied = new Uint8Array(this.pw * (this.nz + 2));
    for (let cz = 0; cz < this.nz; cz++) {
      for (let cx = 0; cx < this.nx; cx++) {
        const c = cz * this.nx + cx;
        if (this.start[c + 1] === this.start[c]) continue;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            this.occupied[(cz + dz + 1) * this.pw + (cx + dx + 1)] = 1;
          }
        }
      }
    }
  }

  /** Nearest frame index, or -1 when nothing is within reach. */
  nearest(x: number, z: number): number {
    const cx = Math.floor(x / this.cell) - this.minCX;
    const cz = Math.floor(z / this.cell) - this.minCZ;

    if (cx < -1 || cx > this.nx || cz < -1 || cz > this.nz) return -1;
    if (this.occupied[(cz + 1) * this.pw + (cx + 1)] === 0) return -1;

    let best = -1;
    let bestD = this.maxRadius * this.maxRadius * 4;

    const z0 = cz > 0 ? cz - 1 : 0;
    const z1 = cz + 1 < this.nz ? cz + 1 : this.nz - 1;
    const x0 = cx > 0 ? cx - 1 : 0;
    const x1 = cx + 1 < this.nx ? cx + 1 : this.nx - 1;
    if (z0 > z1 || x0 > x1) return -1;

    for (let iz = z0; iz <= z1; iz++) {
      const row = iz * this.nx;
      const from = this.start[row + x0];
      const to = this.start[row + x1 + 1];
      for (let k = from; k < to; k++) {
        const i = this.items[k];
        const dx = this.px[i] - x;
        const dz = this.pz[i] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / Math.max(1e-6, edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Blend the sculpted terrain towards the road surface so there is never a
 * step between tarmac and ground. Returns a NEW array, the user's sculpted
 * heights stay untouched.
 */
/**
 * Precomputed influence of the road corridors on the height grid.
 *
 * Blending is `height = sculpted * (1 - weight) + shift`, evaluated only on the
 * cells the road actually reaches. The expensive part, finding the nearest
 * point on the centre line for every grid vertex, depends solely on the splines
 * and the grid, never on what the user sculpts. So it is computed once and then
 * reused for every stroke of the brush, which is the difference between a
 * sculpt frame costing 12 ms and costing well under 1 ms.
 */
/**
 * How far the ground is tucked underneath the road surface.
 *
 * The road, the kerbs and the run off are separate meshes that sit on top of
 * the terrain, covering exactly the same ground. If the terrain is blended to
 * precisely the road height, the two surfaces are coplanar and the depth buffer
 * cannot decide which is in front: the grass flickers through the tarmac, in
 * the editor and in the game alike. So the ground is sunk a little under the
 * tarmac and eased back up to meet the outer edge of the corridor, where it
 * becomes the visible surface again.
 */
const ROAD_SINK = 0.2;
/** Shortest distance the sink is allowed to ease out over. */
const MIN_SINK_SPAN = 1.2;

export interface CorridorMask {
  /** Indices into the height grid that the road influences at all. */
  indices: Int32Array;
  /** Blend weight per entry of `indices`. */
  weight: Float32Array;
  /** Already weighted target height per entry of `indices`. */
  shift: Float32Array;
}

/**
 * Working buffers for the mask build, kept between calls.
 *
 * These are four arrays the size of the whole height grid, about two megabytes
 * on a large terrain. Allocating them fresh on every rebuild meant throwing two
 * megabytes away per frame while dragging a control point, which on a 120 Hz
 * display is a quarter of a gigabyte a second of garbage: the browser then
 * stops everything for a few hundred milliseconds every several seconds to
 * clean up. The build is synchronous and never re-entered, so reusing them is
 * safe.
 */
const scratch = {
  size: 0,
  maxWeight: new Float32Array(0),
  sumW2: new Float64Array(0),
  sumW2T: new Float64Array(0),
  ceiling: new Float32Array(0),
};

function takeScratch(n: number) {
  if (scratch.size < n) {
    scratch.size = n;
    scratch.maxWeight = new Float32Array(n);
    scratch.sumW2 = new Float64Array(n);
    scratch.sumW2T = new Float64Array(n);
    scratch.ceiling = new Float32Array(n);
  }
  scratch.maxWeight.fill(0, 0, n);
  scratch.sumW2.fill(0, 0, n);
  scratch.sumW2T.fill(0, 0, n);
  scratch.ceiling.fill(Infinity, 0, n);
  return scratch;
}

export function buildCorridorMask(t: TerrainSettings, corridors: Corridor[]): CorridorMask {
  const n = t.res * t.res;
  const cs = cellSize(t);
  /**
   * maxWeight: strongest claim any ribbon has on a cell.
   * sumW2 / sumW2T: squared weight accumulators, for blending overlaps.
   * ceiling: hard upper bound, the height of the lowest ribbon the cell lies
   * directly underneath. Without it, a pit lane running next to a dip in the
   * track pulls the ground up towards its own height and the grass comes
   * through the tarmac. Blending alone cannot guarantee that, a ceiling can.
   */
  const { maxWeight, sumW2, sumW2T, ceiling } = takeScratch(n);

  for (const corridor of corridors) {
    const { frames, kerbL, kerbR, shoulderL, shoulderR, drop, shoulderFull, dropScale, fullBank } = corridor;
    const closedPath = corridor.closed;
    if (frames.length < 2) continue;

    let maxShoulder = 0;
    let maxKerb = 0;
    for (let i = 0; i < frames.length; i++) {
      maxShoulder = Math.max(maxShoulder, shoulderL[i] ?? 0, shoulderR[i] ?? 0);
      maxKerb = Math.max(maxKerb, kerbL[i] ?? 0, kerbR[i] ?? 0);
    }
    const idx = new CorridorIndex(frames, maxKerb, maxShoulder, t.blend);
    const reach = idx.maxRadius + t.blend;

    // Only walk the part of the grid this corridor can possibly reach.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const f of frames) {
      minX = Math.min(minX, f.pos.x); maxX = Math.max(maxX, f.pos.x);
      minZ = Math.min(minZ, f.pos.z); maxZ = Math.max(maxZ, f.pos.z);
    }
    const ix0 = Math.max(0, Math.floor((minX - reach - t.originX) / cs));
    const ix1 = Math.min(t.res - 1, Math.ceil((maxX + reach - t.originX) / cs));
    const iz0 = Math.max(0, Math.floor((minZ - reach - t.originZ) / cs));
    const iz1 = Math.min(t.res - 1, Math.ceil((maxZ + reach - t.originZ) / cs));

    for (let iz = iz0; iz <= iz1; iz++) {
      const z = t.originZ + iz * cs;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = t.originX + ix * cs;
        const fi = idx.nearest(x, z);
        if (fi < 0) continue;

        /*
         * Which piece of road is this cell under? Not "the nearest cross
         * section" -- a cross section is a slice, not an infinite line, and
         * reading a cell's position along one is only meaningful while the cell
         * is beside it. On a corner the sections fan out and a cell out on the
         * verge is measured against one pointing at it from metres up the road,
         * whose surface at that offset is somewhere else entirely. With banking
         * that error is vertical: it left an 88 cm step in the ground at the
         * edge of the run off, and grass standing above the tarmac.
         *
         * Projecting onto the SEGMENT between two sections asks the question
         * that has an answer -- how far is this cell from the road, and what is
         * the road doing there -- and everything below is interpolated between
         * the two ends of that segment.
         */
        const seg = projectOnSegments(frames, fi, x, z, closedPath);
        const a = seg.a;
        const b = seg.b;
        const st = seg.t;
        const fa = frames[a];
        const fb = frames[b];
        const abs = seg.dist;
        const left = seg.left;
        const lateral = left ? -abs : abs;

        const roadHalf = mix(left ? fa.widthL : fa.widthR, left ? fb.widthL : fb.widthR, st);
        const kerb = mix((left ? kerbL[a] : kerbR[a]) ?? 0, (left ? kerbL[b] : kerbR[b]) ?? 0, st);
        const shoulder =
          mix((left ? shoulderL[a] : shoulderR[a]) ?? 0, (left ? shoulderL[b] : shoulderR[b]) ?? 0, st);
        const inner = roadHalf + kerb + shoulder;
        if (abs > inner + t.blend) continue;
        // The centre line's own height and tilt where the cell actually is.
        const centreY = mix(fa.pos.y, fb.pos.y, st);
        const rightY = mix(fa.right.y, fb.right.y, st);

        // Height of the road surface extended sideways, including banking and
        // the drop of the shoulder.
        const clamped = Math.min(abs, inner);
        const overRoad = roadHalf + kerb;
        /* How far across the shoulder this cell is, 0 at the hard edge and 1 at
           the outer one. Linear, because the mesh it has to match is one quad
           spanning exactly that. */
        const shoulderT =
          shoulder > 1e-6 ? Math.min(1, Math.max(0, clamped - overRoad) / shoulder) : 0;
        /*
         * The banking is carried at full tilt over the hard surface and fades
         * out across the shoulder, which is exactly what the run off mesh does.
         * Both have to agree: the ground is raised to meet the tarmac, so a
         * terrain that keeps banking out to the far edge of a 23 m shoulder
         * while the mesh levels off comes up through it.
         *
         * Across the shoulder itself the mesh is ONE quad from the hard edge to
         * the outer edge, so it is a straight line -- and the fade is not. The
         * bank rise and the drop are therefore interpolated linearly between
         * the two edges rather than evaluated at the sample point: matching the
         * curve here would put the ground up to 35 cm above a flat quad in the
         * middle of the verge.
         */
        const bank = fullBank
          ? Math.sign(lateral) * clamped * rightY
          : Math.sign(lateral) *
            (Math.min(clamped, overRoad) * rightY + runoffBankRise(rightY, shoulder) * shoulderT);
        /*
         * The centre line height comes from the projection, so there is no
         * "along the track" correction left to make: the old code took the
         * height of one cross section and walked the tangent plane up to 20 m
         * to reach the cell, which is the same approximation this replaces.
         */
        const dropF = dropScale ? mix(dropScale[a] ?? 1, dropScale[b] ?? 1, st) : 1;
        const surface = centreY + bank - shoulderDrop(drop * dropF, shoulder, shoulderFull) * shoulderT;

        /*
         * How far a grid this coarse can lie about a surface this steep.
         *
         * The heights live on a square grid and are read back by interpolating
         * between its points -- a straight line between two samples up to a
         * cell apart. Where the surface underneath is not straight, that line
         * cuts the corner, and the sharpest corner in a road cross section is
         * the tarmac edge of a banked corner: full camber inside it, nearly
         * level shoulder outside. On a 900 m terrain at the Low setting a cell
         * is 9.4 m across, wider than half a road, so the interpolated ground
         * came up through the tarmac of a steeply banked corner -- half a metre
         * at 20°, a metre at 30°. It looked exactly like the grass sliding onto
         * the track, because that is what it was.
         *
         * Sinking the ground by what the grid can get wrong at this tilt puts
         * the interpolated line back underneath the road. It is buried under
         * the tarmac, so nobody ever sees the extra depth; what they see is the
         * kerb, undisturbed. A finer terrain needs proportionally less of it,
         * and a flat circuit needs none at all.
         */
        /* Both axes of tilt, not just the camber: a lane running along a
           hillside has the same corner-cutting problem lengthways -- measured
           on the hilly test oval, grass standing 19 cm proud of the concrete
           midway between two grid points, with the camber itself under 1%. */
        const slack = 0.6 * cs * Math.abs(rightY);
        /* The same corner-cutting happens LENGTHWAYS on a climb: the ground
           between two grid points beside a road running up a hillside is a
           straight line through a target field that changes regime at the
           mesh edge, and on the hilly test oval it stood 19 cm proud of the
           concrete midway between samples. This term buys the room -- but
           only in the band around the edge, as a bump that is zero both at
           the road centre and at the edge itself: at the centre the road
           hides everything and the depth is already spoken for (deepening it
           there broke the terrain raycast's error budget), and at the edge
           the ground must MEET the bevel, exactly, or the seam is back. */
        const climb = Math.min(0.5, 0.6 * cs * Math.abs(mix(fa.fwd.y, fb.fwd.y, st)));
        /* Full depth under the tarmac, easing out to a hair's gap by the time
           the terrain becomes the surface you actually see.

           Measured BACK from the outer edge, not forward from the hard one.
           Forward, the ease ran over max(shoulder, MIN_SINK_SPAN) of lateral
           distance regardless of where the mesh actually ends -- so wherever
           the run off is squeezed under that span, which is most of the ground
           beside a pit lane, the terrain was still 15 cm down at the very
           point it becomes the visible surface. What that drew was a trench a
           hand deep and under a metre wide along the seam, read in the
           viewport as a dark slot beside the concrete. Anchored to the edge,
           the ease finishes exactly where the mesh hands over -- EDGE_SINK
           under it, which the mesh's own edge bevel comes down to meet -- and
           a narrow shoulder simply starts easing under the tarmac, where
           nobody can see it. */
        /* And never sharper than the grid can draw. The heights live on the
           grid and are read back as straight lines between its points: a sink
           that plunges to full depth within one cell of the edge is invisible
           AT the points and a hand-deep scoop between them -- which is what
           dug the trench beside every road on a coarse terrain. Easing over
           a cell and a half keeps the interpolated line within a few
           centimetres of the surface it hides under. */
        const sinkSpan = Math.max(shoulder, MIN_SINK_SPAN, cs * 1.5);
        const sinkT = smoothstep(inner - sinkSpan, inner, Math.min(abs, inner));
        const target =
          surface
          - (ROAD_SINK
            + slack * (1 - sinkT)
            + climb * 4 * sinkT * (1 - sinkT)
            + (EDGE_SINK - ROAD_SINK) * sinkT);

        const w = 1 - smoothstep(inner, inner + t.blend, abs);
        if (w <= 1e-6) continue;

        const i = iz * t.res + ix;
        // Squared weights, so the ribbon a cell is actually under dominates
        // instead of being averaged away by a neighbour passing nearby.
        const w2 = w * w;
        sumW2[i] += w2;
        sumW2T[i] += w2 * target;
        if (w > maxWeight[i]) maxWeight[i] = w;
        // Directly underneath this ribbon -- plus one grid cell beyond its
        // edge -- so it caps how high the ground goes: never above where this
        // ribbon alone would have put it. The extra cell is for the grid, not
        // the ribbon: the seam is only ever pinned AT grid points, and a point
        // just outside the edge left at open-country height hoists the
        // interpolated ground over the ribbon's outer metres on any hillside.
        // Measured on the hilly test oval: grass 14 cm proud of the concrete.
        if (abs <= inner + cs && target < ceiling[i]) ceiling[i] = target;
      }
    }
  }

  let count = 0;
  for (let i = 0; i < n; i++) if (maxWeight[i] > 1e-6) count++;
  const indices = new Int32Array(count);
  const weight = new Float32Array(count);
  const shift = new Float32Array(count);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const w = maxWeight[i];
    if (w <= 1e-6) continue;
    let target = sumW2T[i] / sumW2[i];
    if (target > ceiling[i]) target = ceiling[i];
    indices[k] = i;
    weight[k] = w;
    shift[k] = target * w;
    k++;
  }
  return { indices, weight, shift };
}

export function applyCorridorMask(sculpted: Float32Array, mask: CorridorMask): Float32Array {
  const out = new Float32Array(sculpted);
  for (let k = 0; k < mask.indices.length; k++) {
    const i = mask.indices[k];
    out[i] = sculpted[i] * (1 - mask.weight[k]) + mask.shift[k];
  }
  return out;
}

/** Convenience wrapper, does both steps at once. */
export function blendRoadIntoTerrain(t: TerrainSettings, corridors: Corridor[]): Float32Array {
  return applyCorridorMask(t.heights, buildCorridorMask(t, corridors));
}

/**
 * Normals for a regular height grid, from central differences.
 *
 * Equivalent to the generic per triangle accumulation for this topology but
 * roughly five times faster, which matters because this runs on every stroke
 * of the sculpt brush.
 */
function gridNormals(
  t: TerrainSettings,
  heights: Float32Array,
  out: Float32Array,
  bounds?: { x0: number; x1: number; z0: number; z1: number },
) {
  const res = t.res;
  const cs = cellSize(t);
  const at = (ix: number, iz: number) =>
    heights[Math.min(Math.max(iz, 0), res - 1) * res + Math.min(Math.max(ix, 0), res - 1)];

  const zFrom = bounds ? Math.max(0, bounds.z0) : 0;
  const zTo = bounds ? Math.min(res - 1, bounds.z1) : res - 1;
  const xFrom = bounds ? Math.max(0, bounds.x0) : 0;
  const xTo = bounds ? Math.min(res - 1, bounds.x1) : res - 1;

  for (let iz = zFrom; iz <= zTo; iz++) {
    for (let ix = xFrom; ix <= xTo; ix++) {
      const i = iz * res + ix;
      const dx = (at(ix + 1, iz) - at(ix - 1, iz)) / (2 * cs);
      const dz = (at(ix, iz + 1) - at(ix, iz - 1)) / (2 * cs);
      const len = Math.hypot(dx, 1, dz);
      out[i * 3 + 0] = -dx / len;
      out[i * 3 + 1] = 1 / len;
      out[i * 3 + 2] = -dz / len;
    }
  }
}

/**
 * The grid a terrain geometry was built for, kept on `geometry.userData`.
 *
 * `updateTerrainGeometry` used to decide "same grid?" by comparing the first
 * vertex against `originX` with a 1e-6 tolerance. The vertex is float32, the
 * origin is float64: at an origin of -900 the rounding error alone is ~5e-5,
 * fifty times the tolerance. Any origin that was not exactly representable in
 * float32 - which is what "Fit terrain to track" produces - failed the check,
 * and the terrain was silently rebuilt from scratch on every sculpt frame.
 * Remembering the actual numbers instead of guessing from rounded vertex data
 * makes the check exact.
 */
interface TerrainGridTag {
  res: number;
  size: number;
  originX: number;
  originZ: number;
  minY: number;
  maxY: number;
  /**
   * The height field these vertices were written from, by identity. Height
   * fields are replaced, never written into, so the same object means the same
   * ground and the vertices can be carried into a recut mesh unchanged. One
   * geometry holds one field and is dropped whole when it is replaced, so this
   * cannot chain the way `heightsDelta` would.
   */
  heights: Float32Array;
  /**
   * The paint field the triangles were sorted for, by identity. Paint is copied
   * on write like the height field, so a different array means a different
   * picture and the mesh has to be cut again.
   */
  paint: Uint8Array | null;
  /** The distances the cuts were placed from; a change reshapes every edge. */
  paintEdge: Int8Array | null;
  /** The vertices added inside cells the paint splits, or null when none. */
  extras: TerrainExtras | null;
}

/**
 * Vertices appended after the plain grid, for the cells a painted edge crosses.
 *
 * A cell that is all one material stays two triangles. A cell the edge runs
 * through is cut into sub-cells at the paint resolution, and those need
 * vertices of their own: `cellX`/`cellZ` say which grid cell one sits in and
 * `u`/`v` where inside it, so the sculpt brush can move them with the four
 * corners they hang between. They sit exactly on the straight edge between two
 * grid corners, so a subdivided cell and its plain neighbour cannot crack open.
 *
 * The lattice is at HALF a sub-cell, not a whole one, so a boundary can be cut
 * through the middle of a sub-cell rather than only round its sides. That is
 * where the diagonal edges come from; on a square-only lattice every edge is a
 * staircase no matter how fine the squares get.
 */
interface TerrainExtras {
  /** Vertex index the appended block starts at. Below it is the plain grid. */
  first: number;
  cellX: Int32Array;
  cellZ: Int32Array;
  u: Float32Array;
  v: Float32Array;
}

/**
 * Cells the paint may split before the rest fall back to their majority
 * material. A ragged edge round a big patch is a few hundred; nothing a brush
 * can draw comes near this, and it stops a pathological paint field from
 * turning a 66000 vertex grid into a million vertex one.
 */
const MAX_SPLIT_CELLS = 4000;

/**
 * One material per grid cell: the index into GROUND_KINDS, or -1 when the paint
 * across that cell is not all the same and the cell has to be cut up.
 *
 * Returns null when the whole terrain is plain grass, which is the state every
 * project starts in and most stay in. That null is what keeps the ground mesh
 * of an unpainted track exactly what it was before any of this existed.
 */
function classifyCells(t: TerrainSettings, kinds: Uint8Array | null | undefined): Int8Array | null {
  const paint = kinds;
  if (!paint) return null;
  const res = t.res;
  const cells = res - 1;
  const sub = paintSub(res);
  const pw = cells * sub + 1;
  if (paint.length !== pw * pw) return null;

  const out = new Int8Array(cells * cells);
  let painted = false;
  for (let cj = 0; cj < cells; cj++) {
    for (let ci = 0; ci < cells; ci++) {
      const first = paint[cj * sub * pw + ci * sub];
      let uniform = true;
      // Every sample the cell touches, its far edges included: two cells share
      // the samples along the edge between them, which is what stops a boundary
      // from being claimed by one of them and forgotten by the other.
      for (let b = 0; b <= sub && uniform; b++) {
        const row = (cj * sub + b) * pw + ci * sub;
        for (let a = 0; a <= sub; a++) {
          if (paint[row + a] !== first) {
            uniform = false;
            break;
          }
        }
      }
      out[cj * cells + ci] = uniform ? first : -1;
      if (first !== 0 || !uniform) painted = true;
    }
  }
  return painted ? out : null;
}

/** The material most of a split cell is made of, used when the budget runs out. */
function dominantKind(t: TerrainSettings, kinds: Uint8Array, ci: number, cj: number): number {
  const paint = kinds;
  const sub = paintSub(t.res);
  const pw = (t.res - 1) * sub + 1;
  const tally = new Array<number>(GROUND_KINDS.length).fill(0);
  for (let b = 0; b <= sub; b++) {
    const row = (cj * sub + b) * pw + ci * sub;
    for (let a = 0; a <= sub; a++) tally[paint[row + a]] += 1;
  }
  let best = 0;
  for (let k = 1; k < tally.length; k++) if (tally[k] > tally[best]) best = k;
  return best;
}

/**
 * The triangles of one sub-cell, cut where the material changes.
 *
 * The four corners carry a material each. Where two neighbouring corners
 * disagree the boundary crosses the edge between them, and it is cut at the
 * midpoint -- so a sub-cell is not one tile of one material but two pieces
 * meeting along a line that can run diagonally. That single change is what
 * turns a staircase into an edge.
 *
 * Walking the ring collects both pieces at once: a corner joins the piece of
 * its own material, and a crossing point joins both. Everything it produces is
 * convex, so a fan from the first point triangulates it.
 *
 * `half` addresses the half-step lattice: (0,0) is the sub-cell's low corner,
 * (2,2) the far one, and the odd numbers in between are the crossing points.
 */
function cutSubCell(
  m0: number, m1: number, m2: number, m3: number,
  emit: (kind: number, ring: number[]) => void,
) {
  // Ring order, anticlockwise seen from above, matching the plain cell's
  // winding: (0,0) (0,2) (2,2) (2,0) in half steps, with the crossing point
  // between each pair.
  const cx = [0, 0, 2, 2];
  const cz = [0, 2, 2, 0];
  const mid = [
    [0, 1], [1, 2], [2, 1], [1, 0],
  ];
  const m = [m0, m1, m2, m3];

  const a = m0;
  const inA = [m[0] === a, m[1] === a, m[2] === a, m[3] === a];
  let other = -1;
  for (let i = 1; i < 4; i++) {
    if (inA[i]) continue;
    if (other < 0) other = m[i];
    else if (other !== m[i]) {
      // Three materials meeting in one sub-cell. Nothing sensible to cut, and
      // nothing a brush can really draw: it takes the whole cell.
      emit(a, [0, 0, 0, 2, 2, 2, 2, 0]);
      return;
    }
  }
  if (other < 0) {
    emit(a, [0, 0, 0, 2, 2, 2, 2, 0]);
    return;
  }

  // The saddle: the two materials sit on the diagonals, so the ring walk would
  // hand one of them a figure of eight. The material of corner 0 keeps the
  // middle, the other one gets its two corners cut off.
  if (inA[0] === inA[2] && inA[1] === inA[3]) {
    emit(a, [0, 0, 0, 1, 1, 2, 2, 2, 2, 1, 1, 0]);
    emit(other, [0, 1, 0, 2, 1, 2]);
    emit(other, [2, 1, 2, 0, 1, 0]);
    return;
  }

  const ringA: number[] = [];
  const ringB: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    (inA[i] ? ringA : ringB).push(cx[i], cz[i]);
    if (inA[i] !== inA[j]) {
      ringA.push(mid[i][0], mid[i][1]);
      ringB.push(mid[i][0], mid[i][1]);
    }
  }
  emit(a, ringA);
  emit(other, ringB);
}

/**
 * World metres to one texture tile on the ground.
 *
 * The same figure road.ts lays the tarmac at (`dist / 8`), so a patch of
 * asphalt or gravel painted into the terrain has exactly the grain of the road
 * it runs up to. It used to be 12, which put the 512 px grass tile at 43 px to
 * the metre -- a quarter of what Assetto Corsa's own tracks use, and the main
 * reason the ground read as green paint rather than grass. The grass sheet is
 * 1024 px (see GRASS_SIZE in textures.ts), so 8 m is 128 px/m, in the middle
 * of the 100-200 px/m band measured off imola, magione and fn_imola.
 */
const TEX_TILE_M = 8;

/** Position, normal and UV of the appended vertices in [from, to). */
function writeExtras(
  t: TerrainSettings,
  heights: Float32Array,
  pos: Float32Array,
  nor: Float32Array,
  uv: Float32Array,
  ex: TerrainExtras,
  from: number,
  to: number,
) {
  const res = t.res;
  const cs = cellSize(t);
  for (let k = from; k < to; k++) {
    const ci = ex.cellX[k];
    const cj = ex.cellZ[k];
    const u = ex.u[k];
    const v = ex.v[k];
    const a = cj * res + ci;
    const b = a + 1;
    const c = a + res;
    const d = c + 1;
    const wu = 1 - u;
    const wv = 1 - v;
    const i = ex.first + k;

    const gx = (ci + u) * cs;
    const gz = (cj + v) * cs;
    pos[i * 3 + 0] = t.originX + gx;
    pos[i * 3 + 1] =
      (heights[a] * wu + heights[b] * u) * wv + (heights[c] * wu + heights[d] * u) * v;
    pos[i * 3 + 2] = t.originZ + gz;
    uv[i * 2 + 0] = gx / TEX_TILE_M;
    uv[i * 2 + 1] = gz / TEX_TILE_M;

    let nx = (nor[a * 3 + 0] * wu + nor[b * 3 + 0] * u) * wv + (nor[c * 3 + 0] * wu + nor[d * 3 + 0] * u) * v;
    let ny = (nor[a * 3 + 1] * wu + nor[b * 3 + 1] * u) * wv + (nor[c * 3 + 1] * wu + nor[d * 3 + 1] * u) * v;
    let nz = (nor[a * 3 + 2] * wu + nor[b * 3 + 2] * u) * wv + (nor[c * 3 + 2] * wu + nor[d * 3 + 2] * u) * v;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    nor[i * 3 + 0] = nx;
    nor[i * 3 + 1] = ny;
    nor[i * 3 + 2] = nz;
  }
}

/** The grid cells one edit touched, inclusive. ix in [i0,i1], iz in [j0,j1]. */
export interface GridPatch {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/**
 * Which region of a freshly written height field differs from the array it
 * replaced. The brush knows exactly where it painted; without this note that
 * knowledge is thrown away and re-derived by comparing all res² vertices.
 *
 * The previous field is held by a WeakRef, and that is not a detail.
 *
 * A WeakMap holds its KEYS weakly and its values as strongly as anything else.
 * With the array itself in the value, every height field kept the one it
 * replaced alive: field n held n-1, which was still a live key, whose value
 * held n-2, and so on. One unbroken chain back to the first brush stroke of the
 * session. At a hundred and fifty kilobytes a field and sixty strokes a second,
 * that is nine megabytes a second that can never be collected -- measured in a
 * recorded session as the heap floor climbing six hundred megabytes a minute,
 * which is exactly how long a browser tab lasts before "Out of memory".
 *
 * Weakly, the chain cannot form. If the previous field has been collected the
 * patch simply does not apply and the mesh is rebuilt in full, which is a few
 * milliseconds once, not a leak forever.
 */
export const heightsDelta = new WeakMap<
  Float32Array,
  { prev: WeakRef<Float32Array>; box: GridPatch }
>();

/**
 * Build the terrain mesh from a finished height field and its paint.
 *
 * Painted ground is not a second mesh laid over the first. It is the same
 * vertices: the triangles are simply sorted into one run per material and each
 * run drawn with its own, so where there is gravel there is no grass triangle
 * at all -- nothing to show through, nothing to fight the depth buffer, and
 * nothing that can be left behind when the ground underneath is sculpted.
 */
export function buildTerrainGeometry(
  t: TerrainSettings,
  heights: Float32Array,
  paint?: Uint8Array | null,
  /**
   * The geometry this one replaces. A repaint moves triangles between materials
   * and cuts different cells up, so the index has to be built again -- but the
   * grid vertices themselves have not moved at all. When the height field is
   * the same object, they are copied across rather than recomputed, which is
   * the vertex loop and the whole normal pass saved on every dab of the brush.
   */
  reuse?: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const res = t.res;
  const cs = cellSize(t);
  const cells = res - 1;
  const base = res * res;

  // Kinds, not stored bytes: the field carries kind-plus-one so that unpainted
  // ground can be told from painted grass, and everything below this line is
  // about materials.
  const kinds = paint ? paintKinds(paint) : null;
  const kind = classifyCells(t, kinds);
  const sub = paintSub(res);
  const pw = cells * sub + 1;
  /*
   * Where a boundary crosses the line between two paint samples, as a fraction
   * of the way from the first to the second.
   *
   * The paint alone can only say that the two ends disagree, and the honest
   * answer to "where between them" is then the middle -- which is what builds
   * a staircase out of every edge that does not run along the grid. The edge
   * field remembers how far each sample sat from the shape that drew it, and
   * two distances of opposite sign say exactly where the zero between them is.
   *
   * The result is nudged off the ends: a cut sitting exactly on a corner makes
   * a triangle of no area, and a fan over one of those is a crack.
   */
  const edge = t.paintEdge && t.paintEdge.length === pw * pw ? t.paintEdge : null;
  const crossing = (a: number, b: number): number => {
    if (!edge) return 0.5;
    const da = edge[a];
    const db = edge[b];
    if (da === EDGE_UNKNOWN || db === EDGE_UNKNOWN) return 0.5;
    // Same side of the boundary, or both exactly on it: the distances are
    // remembered from different shapes and cannot place this crossing.
    if ((da <= 0) === (db <= 0) || da === db) return 0.5;
    const f = da / (da - db);
    return f < 0.04 ? 0.04 : f > 0.96 ? 0.96 : f;
  };
  // The half-step lattice a cut cell is expressed on: every sub-cell corner and
  // every point a boundary can cross an edge at.
  const span = 2 * sub + 1;
  const perCell = span * span;

  // Which cells the paint cuts up. Everything past the budget takes the
  // material most of it is made of instead. The budget is counted in vertices
  // rather than cells, because that is what actually costs: a cut cell carries
  // far more of them on a coarse grid, where each one covers more ground.
  const maxSplit = Math.max(64, Math.min(MAX_SPLIT_CELLS, Math.floor(200000 / perCell)));
  const split: number[] = [];
  if (kind) {
    for (let c = 0; c < kind.length; c++) {
      if (kind[c] >= 0) continue;
      if (split.length < maxSplit) split.push(c);
      else kind[c] = dominantKind(t, kinds!, c % cells, (c / cells) | 0);
    }
  }

  const extraCount = split.length * perCell;
  const total = base + extraCount;
  const pos = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const nor = new Float32Array(total * 3);

  let minY = Infinity;
  let maxY = -Infinity;
  const old = reuse?.userData.grid as TerrainGridTag | undefined;
  const carry =
    old !== undefined
    && old.heights === heights
    && old.res === res
    && old.size === t.size
    && old.originX === t.originX
    && old.originZ === t.originZ
    && (reuse!.getAttribute('position') as THREE.BufferAttribute).count >= base;

  if (carry) {
    pos.set((reuse!.getAttribute('position').array as Float32Array).subarray(0, base * 3));
    uv.set((reuse!.getAttribute('uv').array as Float32Array).subarray(0, base * 2));
    nor.set((reuse!.getAttribute('normal').array as Float32Array).subarray(0, base * 3));
    for (let i = 0; i < base; i++) {
      const h = heights[i];
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  } else {
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const i = iz * res + ix;
        const h = heights[i];
        pos[i * 3 + 0] = t.originX + ix * cs;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = t.originZ + iz * cs;
        uv[i * 2 + 0] = (ix * cs) / TEX_TILE_M;
        uv[i * 2 + 1] = (iz * cs) / TEX_TILE_M;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }
    gridNormals(t, heights, nor);
  }

  let extras: TerrainExtras | null = null;
  if (extraCount > 0) {
    extras = {
      first: base,
      cellX: new Int32Array(extraCount),
      cellZ: new Int32Array(extraCount),
      u: new Float32Array(extraCount),
      v: new Float32Array(extraCount),
    };
    let k = 0;
    for (const c of split) {
      const ci = c % cells;
      const cj = (c / cells) | 0;
      for (let b = 0; b < span; b++) {
        for (let a = 0; a < span; a++) {
          extras.cellX[k] = ci;
          extras.cellZ[k] = cj;
          /*
           * Even lattice steps are the sub-cell corners and sit on a paint
           * sample; the odd ones in between are the only places a boundary is
           * ever cut, so they -- and only they -- move onto it. A point odd in
           * both is the middle of a sub-cell, used by the saddle case, and has
           * no single edge to sit on.
           *
           * The points along a cell's own border are even and therefore never
           * move, which is what keeps two neighbouring cut cells sharing the
           * same edge and the mesh free of cracks.
           */
          let u = a / (2 * sub);
          let v = b / (2 * sub);
          const oddA = (a & 1) === 1;
          const oddB = (b & 1) === 1;
          if (oddA && !oddB) {
            const s0 = (cj * sub + (b >> 1)) * pw + ci * sub + (a >> 1);
            u = ((a >> 1) + crossing(s0, s0 + 1)) / sub;
          } else if (!oddA && oddB) {
            const s0 = (cj * sub + (b >> 1)) * pw + ci * sub + (a >> 1);
            v = ((b >> 1) + crossing(s0, s0 + pw)) / sub;
          }
          extras.u[k] = u;
          extras.v[k] = v;
          k++;
        }
      }
    }
    writeExtras(t, heights, pos, nor, uv, extras, 0, extraCount);
  }

  /* --- triangles, sorted by material -------------------------------- */

  const kindCount = GROUND_KINDS.length;
  const tris = new Array<number>(kindCount).fill(0);

  /**
   * Walk every sub-cell of every cut cell, handing each piece to `take`.
   *
   * Run twice: once to count the triangles per material, so the index buffer
   * can be allocated in one go and each material's run laid out end to end,
   * and once to write them. Counting by running the real cut, rather than
   * guessing at it, is what stops the two from ever disagreeing.
   */
  const walkSplit = (take: (k: number, ring: number[], v0: number, a: number, b: number) => void) => {
    let v0 = base;
    for (const c of split) {
      const ci = c % cells;
      const cj = (c / cells) | 0;
      for (let b = 0; b < sub; b++) {
        const lo = (cj * sub + b) * pw + ci * sub;
        const hi = lo + pw;
        for (let a = 0; a < sub; a++) {
          cutSubCell(
            kinds![lo + a], kinds![hi + a], kinds![hi + a + 1], kinds![lo + a + 1],
            (k, ring) => take(k, ring, v0, a, b),
          );
        }
      }
      v0 += perCell;
    }
  };

  if (!kind) {
    tris[0] = cells * cells * 2;
  } else {
    for (let c = 0; c < kind.length; c++) if (kind[c] >= 0) tris[kind[c]] += 2;
    walkSplit((k, ring) => {
      tris[k] += ring.length / 2 - 2;
    });
  }

  const totalTris = tris.reduce((s, n) => s + n, 0);
  const idx = total > 65535 ? new Uint32Array(totalTris * 3) : new Uint16Array(totalTris * 3);
  // Where each material's run starts, and the write cursor inside it.
  const start = new Array<number>(kindCount).fill(0);
  const at = new Array<number>(kindCount).fill(0);
  for (let k = 1; k < kindCount; k++) start[k] = start[k - 1] + tris[k - 1] * 3;
  for (let k = 0; k < kindCount; k++) at[k] = start[k];

  for (let cj = 0; cj < cells; cj++) {
    for (let ci = 0; ci < cells; ci++) {
      const k = kind ? kind[cj * cells + ci] : 0;
      if (k < 0) continue;
      const a = cj * res + ci;
      const b = a + 1;
      const c = a + res;
      const d = c + 1;
      let w = at[k];
      idx[w++] = a; idx[w++] = c; idx[w++] = b;
      idx[w++] = b; idx[w++] = c; idx[w++] = d;
      at[k] = w;
    }
  }
  if (extras) {
    walkSplit((k, ring, v0, a, b) => {
      // Ring coordinates are half steps inside the sub-cell; the lattice they
      // land on is the whole cell's.
      const at0 = (hx: number, hz: number) => v0 + (2 * b + hz) * span + (2 * a + hx);
      const first = at0(ring[0], ring[1]);
      let w = at[k];
      for (let i = 2; i + 3 < ring.length; i += 2) {
        idx[w++] = first;
        idx[w++] = at0(ring[i], ring[i + 1]);
        idx[w++] = at0(ring[i + 2], ring[i + 3]);
      }
      at[k] = w;
    });
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  // Only a painted terrain gets groups at all: unpainted, this is the single
  // grass mesh it has always been, drawn in one call.
  const present = groundKindsPresent(tris);
  if (present.length > 1) {
    present.forEach((k, slot) => g.addGroup(start[k], tris[k] * 3, slot));
  }
  const tag: TerrainGridTag = {
    res, size: t.size, originX: t.originX, originZ: t.originZ, minY, maxY,
    heights,
    paint: paint ?? null,
    paintEdge: edge,
    extras,
  };
  g.userData.grid = tag;
  g.userData.groundKinds = present;
  return g;
}

/** Which materials this terrain actually uses, in table order. */
function groundKindsPresent(tris: number[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < tris.length; k++) if (tris[k] > 0) out.push(k);
  return out.length > 0 ? out : [0];
}

/**
 * Push new heights into an existing terrain geometry.
 *
 * Only the Y coordinates and the normals ever change while sculpting, so the
 * index and UV buffers stay untouched and the geometry object keeps its
 * identity. That avoids reallocating and re-uploading megabytes per frame.
 * Returns false when the grid no longer matches and a full rebuild is needed.
 */
export function updateTerrainGeometry(
  g: THREE.BufferGeometry,
  t: TerrainSettings,
  heights: Float32Array,
  patch?: GridPatch,
  paint?: Uint8Array | null,
): boolean {
  const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!pos || !nor || pos.count < t.res * t.res) return false;

  // Guard against a moved or resized grid, where X and Z would be wrong too.
  // Compared against the exact numbers the geometry was built with, never
  // against the float32-rounded vertex data.
  const tag = g.userData.grid as TerrainGridTag | undefined;
  if (!tag || tag.res !== t.res || tag.size !== t.size) return false;
  if (tag.originX !== t.originX || tag.originZ !== t.originZ) return false;
  // A repaint moves triangles between materials and can cut new cells up, so
  // there is nothing to patch: the mesh has to be built again.
  if (tag.paint !== (paint ?? null)) return false;
  // Same materials, different edges: the cuts move, so the mesh is rebuilt.
  if (tag.paintEdge !== (t.paintEdge ?? null)) return false;

  const pa = pos.array as Float32Array;

  // Only a small patch of a big terrain actually moves on any one edit: the
  // brush disc, or the corridor around the control point being dragged. Write
  // that patch and leave the rest of the buffers alone, rather than rewriting
  // and re-normalising a quarter of a million floats every frame. When the
  // edit says where it painted, trust it; otherwise find the patch by scanning.
  const res = t.res;
  let x0 = res;
  let x1 = -1;
  let z0 = res;
  let z1 = -1;
  let minY = tag.minY;
  let maxY = tag.maxY;

  if (patch) {
    x0 = Math.max(0, patch.i0);
    x1 = Math.min(res - 1, patch.i1);
    z0 = Math.max(0, patch.j0);
    z1 = Math.min(res - 1, patch.j1);
    if (x1 < x0 || z1 < z0) return true;
    // The range can only grow here. Exact again on the next full scan or
    // rebuild; a slightly generous bounding sphere never draws wrongly.
    for (let iz = z0; iz <= z1; iz++) {
      const row = iz * res;
      for (let ix = x0; ix <= x1; ix++) {
        const h = heights[row + ix];
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }
  } else {
    minY = Infinity;
    maxY = -Infinity;
    for (let iz = 0; iz < res; iz++) {
      const row = iz * res;
      for (let ix = 0; ix < res; ix++) {
        const i = row + ix;
        const h = heights[i];
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
        if (pa[i * 3 + 1] !== h) {
          if (ix < x0) x0 = ix;
          if (ix > x1) x1 = ix;
          if (iz < z0) z0 = iz;
          if (iz > z1) z1 = iz;
        }
      }
    }
  }
  tag.minY = minY;
  tag.maxY = maxY;

  if (x1 >= x0) {
    for (let iz = z0; iz <= z1; iz++) {
      const row = iz * res;
      for (let ix = x0; ix <= x1; ix++) {
        const i = row + ix;
        pa[i * 3 + 1] = heights[i];
      }
    }
    // Normals of the ring around the patch change too, because they are built
    // from neighbouring heights.
    const nz0 = Math.max(0, z0 - 1);
    const nz1 = Math.min(res - 1, z1 + 1);
    gridNormals(t, heights, nor.array as Float32Array, {
      x0: x0 - 1, x1: x1 + 1, z0: nz0, z1: nz1,
    });

    // Upload only the rows that moved. Flagging the attribute without a range
    // makes three re-send the whole buffer, which on a big terrain is megabytes
    // per frame while dragging.
    const from = nz0 * res;
    const count = (nz1 - nz0 + 1) * res;
    pos.clearUpdateRanges();
    pos.addUpdateRange(from * 3, count * 3);
    nor.clearUpdateRanges();
    nor.addUpdateRange(from * 3, count * 3);

    // The vertices inside split cells hang off the four grid corners around
    // them, so a stroke that moves a corner has to carry them along. Without
    // this the gravel stays where the grass used to be.
    const ex = tag.extras;
    if (ex) {
      let k0 = ex.cellX.length;
      let k1 = -1;
      for (let k = 0; k < ex.cellX.length; k++) {
        const ci = ex.cellX[k];
        const cj = ex.cellZ[k];
        if (ci < x0 - 1 || ci > x1 || cj < z0 - 1 || cj > z1) continue;
        if (k < k0) k0 = k;
        if (k > k1) k1 = k;
      }
      if (k1 >= k0) {
        const uv = g.getAttribute('uv') as THREE.BufferAttribute;
        writeExtras(t, heights, pos.array as Float32Array, nor.array as Float32Array,
          uv.array as Float32Array, ex, k0, k1 + 1);
        pos.addUpdateRange((ex.first + k0) * 3, (k1 - k0 + 1) * 3);
        nor.addUpdateRange((ex.first + k0) * 3, (k1 - k0 + 1) * 3);
      }
    }

    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }

  // The grid never moves sideways, so the bounding sphere follows from the
  // extent and the height range. Cheaper than rescanning every vertex.
  const halfX = t.size / 2;
  const cyRange = (minY + maxY) / 2;
  g.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(t.originX + halfX, cyRange, t.originZ + halfX),
    Math.hypot(halfX, halfX) + (maxY - minY) / 2,
  );
  return true;
}

export function terrainMesh(
  t: TerrainSettings,
  heights: Float32Array,
  paint?: Uint8Array | null,
  reuse?: THREE.BufferGeometry,
  patch?: GridPatch,
): MeshDef {
  const geometry =
    reuse && updateTerrainGeometry(reuse, t, heights, patch, paint)
      ? reuse
      : buildTerrainGeometry(t, heights, paint, reuse);
  // A resize or refit genuinely needs a new geometry; the old one is dead the
  // moment it is replaced. Without this the GPU buffers of every previous grid
  // stay allocated for the rest of the session.
  if (reuse && geometry !== reuse) reuse.dispose();

  const present = (geometry.userData.groundKinds as number[] | undefined) ?? [0];
  const parts = present.map((k) => ({
    name: GROUND_KINDS[k].name,
    material: GROUND_KINDS[k].material,
    surface: GROUND_KINDS[k].surface,
  }));
  const first = parts[0];
  return {
    name: first.name,
    material: first.material,
    surface: first.surface,
    geometry,
    // Left off entirely when the ground is all one material, so nothing
    // downstream has to think about groups on the common case.
    groups: parts.length > 1 ? parts : undefined,
  };
}

/**
 * One mesh per material, for the exporter.
 *
 * The viewport can draw a single geometry in several passes; a track folder
 * cannot. Assetto Corsa reads the surface off the mesh NAME, so the gravel has
 * to arrive as `1SAND_terrain_gravel` and the grass as `1GRASS_terrain`, each
 * carrying only its own triangles and only the vertices those use.
 */
export function splitByGroups(def: MeshDef): MeshDef[] {
  const parts = def.groups;
  const groups = def.geometry.groups;
  if (!parts || parts.length < 2 || groups.length !== parts.length) return [def];

  return groups.map((grp, i) => {
    const part = parts[grp.materialIndex ?? i];
    return {
      ...def,
      name: part.name,
      material: part.material,
      surface: part.surface,
      geometry: extractGroup(def.geometry, grp.start, grp.count),
      groups: undefined,
    };
  });
}

/** The triangles of one group as a standalone geometry, vertices compacted. */
function extractGroup(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const index = geo.getIndex();
  const posAttr = geo.getAttribute('position');
  if (!index) return geo;

  const map = new Int32Array(posAttr.count).fill(-1);
  const src: number[] = [];
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const v = index.getX(start + i);
    let m = map[v];
    if (m < 0) {
      m = src.length;
      map[v] = m;
      src.push(v);
    }
    idx[i] = m;
  }

  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = geo.getAttribute(name);
    if (!a) continue;
    const from = a.array as Float32Array;
    const to = new Float32Array(src.length * a.itemSize);
    for (let i = 0; i < src.length; i++) {
      for (let c = 0; c < a.itemSize; c++) to[i * a.itemSize + c] = from[src[i] * a.itemSize + c];
    }
    out.setAttribute(name, new THREE.BufferAttribute(to, a.itemSize));
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/* ------------------------------------------------------------------ */
/* Picking                                                             */
/* ------------------------------------------------------------------ */

/**
 * A ray test made for a height grid.
 *
 * The terrain carries the pointer handlers, because it is the surface you draw
 * and sculpt on. That puts it in the pointer test on every single mouse move,
 * and three.js' default test walks every triangle in the mesh: on a 289 grid
 * that is 165000 triangle tests per mouse move, tens of times a second, on top
 * of whatever else is going on. It is the reason dragging felt heavy no matter
 * how fast the rebuild got.
 *
 * A height grid does not need any of that. March along the ray until it crosses
 * below the surface, then close in on the crossing. A couple of hundred height
 * lookups, each of them a bilinear read.
 */
export function makeTerrainRaycast(t: TerrainSettings, heights: Float32Array) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] < minY) minY = heights[i];
    if (heights[i] > maxY) maxY = heights[i];
  }

  const bounds = {
    x0: t.originX,
    x1: t.originX + t.size,
    z0: t.originZ,
    z1: t.originZ + t.size,
    y0: minY - 1,
    y1: maxY + 1,
  };

  return function terrainRaycast(
    this: THREE.Object3D,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
  ) {
    const ray = raycaster.ray;
    const o = ray.origin;
    const d = ray.direction;

    // Clip the ray to the box the terrain lives in.
    let tMin = Math.max(0, raycaster.near);
    let tMax = raycaster.far;
    const slab = (origin: number, dir: number, lo: number, hi: number): boolean => {
      if (Math.abs(dir) < 1e-9) return origin >= lo && origin <= hi;
      let ta = (lo - origin) / dir;
      let tb = (hi - origin) / dir;
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > tMin) tMin = ta;
      if (tb < tMax) tMax = tb;
      return tMin <= tMax;
    };
    if (!slab(o.x, d.x, bounds.x0, bounds.x1)) return;
    if (!slab(o.z, d.z, bounds.z0, bounds.z1)) return;
    if (!slab(o.y, d.y, bounds.y0, bounds.y1)) return;
    if (tMax <= tMin) return;

    const span = tMax - tMin;
    const cs = cellSize(t);
    const steps = Math.min(2048, Math.max(16, Math.ceil(span / (cs * 0.75))));
    const step = span / steps;

    const heightAt = (dist: number) =>
      sampleHeights(t, heights, o.x + d.x * dist, o.z + d.z * dist);

    let prevT = tMin;
    let prevDiff = o.y + d.y * prevT - heightAt(prevT);

    for (let i = 1; i <= steps; i++) {
      const tHere = tMin + step * i;
      const diff = o.y + d.y * tHere - heightAt(tHere);
      if (prevDiff >= 0 && diff < 0) {
        // Crossed the surface between prevT and tHere. Close in on it.
        let lo = prevT;
        let hi = tHere;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          if (o.y + d.y * mid - heightAt(mid) >= 0) lo = mid;
          else hi = mid;
        }
        const hit = (lo + hi) / 2;
        const point = new THREE.Vector3(o.x + d.x * hit, o.y + d.y * hit, o.z + d.z * hit);
        point.y = sampleHeights(t, heights, point.x, point.z);

        // Surface normal from the neighbouring heights.
        const e = cs * 0.5;
        const hx =
          sampleHeights(t, heights, point.x + e, point.z) -
          sampleHeights(t, heights, point.x - e, point.z);
        const hz =
          sampleHeights(t, heights, point.x, point.z + e) -
          sampleHeights(t, heights, point.x, point.z - e);
        const normal = new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize();

        intersects.push({
          distance: point.distanceTo(o),
          point,
          object: this,
          normal,
          face: null,
          faceIndex: undefined,
          uv: undefined,
        } as unknown as THREE.Intersection);
        return;
      }
      prevT = tHere;
      prevDiff = diff;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Sculpt brush                                                        */
/* ------------------------------------------------------------------ */

/** Dab the brush once. Returns the grid box it touched, for the mesh update. */
export function applyBrush(
  t: TerrainSettings,
  heights: Float32Array,
  x: number,
  z: number,
  brush: BrushSettings,
  dt: number,
  flattenTarget: number,
): GridPatch {
  const out = heights;
  // Local copies: `t` can be a store draft whose property reads go through a
  // proxy, and the loop below reads them per cell.
  const res = t.res;
  const originX = t.originX;
  const originZ = t.originZ;
  const cs = cellSize(t);
  const r = brush.radius;
  const i0 = Math.max(0, Math.floor((x - r - originX) / cs));
  const i1 = Math.min(res - 1, Math.ceil((x + r - originX) / cs));
  const j0 = Math.max(0, Math.floor((z - r - originZ) / cs));
  const j1 = Math.min(res - 1, Math.ceil((z + r - originZ) / cs));
  const amount = brush.strength * dt;

  for (let jz = j0; jz <= j1; jz++) {
    const wz = originZ + jz * cs;
    for (let ix = i0; ix <= i1; ix++) {
      const wx = originX + ix * cs;
      const d = Math.hypot(wx - x, wz - z);
      if (d > r) continue;
      const falloff = 1 - smoothstep(0, r, d);
      const i = jz * res + ix;

      if (brush.mode === 'raise') out[i] += amount * falloff;
      else if (brush.mode === 'lower') out[i] -= amount * falloff;
      else if (brush.mode === 'flatten') out[i] += (flattenTarget - out[i]) * Math.min(1, amount * falloff * 0.5);
      else {
        // smooth: pull each vertex towards the average of its neighbours
        let sum = 0;
        let n = 0;
        for (let b = -1; b <= 1; b++) {
          for (let a = -1; a <= 1; a++) {
            const cx = Math.min(Math.max(ix + a, 0), res - 1);
            const cz = Math.min(Math.max(jz + b, 0), res - 1);
            sum += out[cz * res + cx];
            n++;
          }
        }
        out[i] += (sum / n - out[i]) * Math.min(1, amount * falloff * 0.6);
      }
    }
  }
  return { i0, i1, j0, j1 };
}

/**
 * Dab the brush once onto a path's control point heights.
 *
 * This is what makes the sculpt tool move the ROAD and not just the ground
 * beside it. The ground under the tarmac is slaved to the road by the corridor
 * mask, so a brush that only wrote into the height field left the road -- and
 * therefore the ground under it -- standing still: the stroke was stored,
 * undoable and invisible. Moving the control points instead moves the one
 * height source everything else follows: the road mesh, the kerbs, the
 * barriers, the markers, and through the corridor the ground itself.
 *
 * The same formulas as `applyBrush`, so the road and the free terrain rise at
 * the same rate and stay level with each other through the blend zone.
 *
 * Control points are sparse -- tens of metres apart -- so a brush smaller than
 * the spacing would fall between two of them and do nothing. Each SEGMENT is
 * therefore tested too: a dab landing between two points is split across them
 * by its position along the segment, scaled so the spline at the dab itself
 * moves at full brush rate rather than at the average of two half moves.
 *
 * Returns whether any height actually changed, so the caller can skip the
 * rebuild bookkeeping when the brush never reached the path.
 */
export function applyBrushToPath(
  path: PathData,
  x: number,
  z: number,
  brush: BrushSettings,
  dt: number,
  flattenTarget: number,
): boolean {
  const nodes = path.nodes;
  const n = nodes.length;
  if (n === 0) return false;
  const r = brush.radius;
  const amount = brush.strength * dt;

  // How hard the brush presses on each control point, 0..1.
  const weight = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = nodes[i].p;
    const d = Math.hypot(p[0] - x, p[2] - z);
    if (d < r) weight[i] = 1 - smoothstep(0, r, d);
  }

  // A dab between two points: project it onto the segment and split the press
  // across the endpoints. The interpolated height at parameter t of deltas
  // (1-t)*a + t*b, with a = f*(1-t)/norm and b = f*t/norm, is exactly f -- the
  // road under the brush keeps pace with the ground beside it.
  const segs = path.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = nodes[i].p;
    const b = nodes[(i + 1) % n].p;
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) continue;
    const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[2]) * dz) / len2));
    const px = a[0] + dx * t;
    const pz = a[2] + dz * t;
    const d = Math.hypot(px - x, pz - z);
    if (d >= r) continue;
    const f = 1 - smoothstep(0, r, d);
    const norm = (1 - t) * (1 - t) + t * t; // 0.5 at mid-segment, 1 at the ends
    weight[i] = Math.max(weight[i], (f * (1 - t)) / norm);
    weight[(i + 1) % n] = Math.max(weight[(i + 1) % n], (f * t) / norm);
  }

  let changed = false;
  for (let i = 0; i < n; i++) {
    const w = weight[i];
    if (w <= 1e-4) continue;
    const y = nodes[i].p[1];
    let next = y;
    if (brush.mode === 'raise') next = y + amount * w;
    else if (brush.mode === 'lower') next = y - amount * w;
    else if (brush.mode === 'flatten') next = y + (flattenTarget - y) * Math.min(1, amount * w * 0.5);
    else {
      // smooth: pull the point towards the average of its path neighbours
      const prev = nodes[(i - 1 + n) % n];
      const after = nodes[(i + 1) % n];
      let avg: number;
      if (path.closed) avg = (prev.p[1] + after.p[1]) / 2;
      else if (i === 0) avg = after.p[1];
      else if (i === n - 1) avg = prev.p[1];
      else avg = (prev.p[1] + after.p[1]) / 2;
      next = y + (avg - y) * Math.min(1, amount * w * 0.6);
    }
    if (next !== y) {
      nodes[i].p[1] = next;
      changed = true;
    }
  }
  return changed;
}

/* ------------------------------------------------------------------ */
/* Refitting                                                           */
/* ------------------------------------------------------------------ */

/** Resize / recentre the terrain around the track, keeping sculpted shape. */
export function fitTerrainToTrack(
  t: TerrainSettings,
  frames: Frame[],
  margin: number,
): TerrainSettings {
  const b = trackBounds(frames, margin);
  const size = Math.max(200, Math.ceil(Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 50) * 50);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const next: TerrainSettings = {
    ...t,
    size,
    originX: cx - size / 2,
    originZ: cz - size / 2,
    heights: createHeights(t.res, t.base),
  };
  // Carry the old sculpt over into the new grid.
  const cs = cellSize(next);
  for (let iz = 0; iz < next.res; iz++) {
    for (let ix = 0; ix < next.res; ix++) {
      const x = next.originX + ix * cs;
      const z = next.originZ + iz * cs;
      const inOld =
        x >= t.originX && x <= t.originX + t.size && z >= t.originZ && z <= t.originZ + t.size;
      next.heights[iz * next.res + ix] = inOld ? sampleHeights(t, t.heights, x, z) : t.base;
    }
  }
  next.paint = resamplePaint(t, t.paint, next);
  next.paintEdge = resamplePaintEdge(t, t.paintEdge, next);
  return next;
}

/** Change grid density without losing the sculpted shape. */
export function resampleTerrain(t: TerrainSettings, res: number): TerrainSettings {
  const next: TerrainSettings = { ...t, res, heights: createHeights(res, t.base) };
  const cs = cellSize(next);
  for (let iz = 0; iz < res; iz++) {
    for (let ix = 0; ix < res; ix++) {
      next.heights[iz * res + ix] = sampleHeights(
        t,
        t.heights,
        next.originX + ix * cs,
        next.originZ + iz * cs,
      );
    }
  }
  // The paint grid is tied to the height grid, so it is resampled with it --
  // otherwise changing the resolution would silently throw the ground away.
  next.paint = resamplePaint(t, t.paint, next);
  next.paintEdge = resamplePaintEdge(t, t.paintEdge, next);
  return next;
}
