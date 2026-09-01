import type { PropInstance, TerrainSettings, RoadSettings } from '../types';
import type { Frame } from './spline';
import type { SideProfile } from './road';
import type { PitClip } from './pitLink';
import {
  corridorSurfaceSampler,
  paintCellSize,
  paintKind,
  paintRes,
  roadCorridor,
  sampleHeights,
} from './terrain';

/**
 * The automatic 3D grass along the verges.
 *
 * A ground texture is grass seen from above, and from a cockpit you look ALONG
 * the ground -- which is why every mod track worth driving carpets its verges
 * in thousands of little alpha tested cards. Placing them by hand with the
 * scatter brush works, but nobody scatters thirty thousand tufts around a lap
 * by hand, so this does it for them: a deterministic strip of tufts either
 * side of the circuit, dense against the kerb and thinning as it runs out into
 * the field, skipping anything that is not grass.
 *
 * The tufts are DERIVED, not stored. They live in no project file and no undo
 * history; move the track or repaint the ground and the grass simply follows,
 * the same way the terrain blend does. Hand-placed tufts from the brush are
 * untouched and sit on top.
 *
 * Packed five floats per tuft -- x, z, yaw, scale, and a height OFFSET above
 * the terrain. No absolute height on purpose: the height is sampled from the
 * terrain where the tufts are drawn or exported, so a sculpt stroke moves the
 * grass without this ever being recomputed. That is the difference between
 * sculpting at 60 fps and not.
 *
 * The offset exists because of the run off. The strip beside the road is not
 * the terrain: it is a ribbon of the ROAD mesh, and the ground is deliberately
 * held a few centimetres to a couple of decimetres underneath it (EDGE_SINK
 * and the sink ease in terrain.ts). A tuft dropped straight onto the terrain
 * there stands under the surface you actually see -- grass below the track.
 * So each tuft inside the band records how far the ribbon stood above the
 * terrain when it was planted; that gap survives sculpting, because the brush
 * carries the road and the ground together.
 *
 * This runs on every commit that changes the track shape or the paint, so it
 * has a frame budget, not an export budget. The expensive question -- "is some
 * OTHER part of the lap, or the pit lane, near this tuft?" -- is answered once
 * per cross section instead of once per tuft: each frame gets the short list
 * of foreign frames within reach, which for almost every metre of almost every
 * circuit is empty, and the per-tuft work collapses to a paint lookup.
 */
export const GRASS3D_STRIDE = 5;

export const EMPTY_GRASS3D = new Float32Array(0);

/** How far a tuft keeps off the tarmac, kerb and coloured strip. */
const KEEP = 0.35;

/** Spacing along the track and across the band, metres. */
const ROW = 1.4;
const COL = 1.2;

/** How far past the outer edge of the run off the band reaches. */
const BEYOND = 6;

/**
 * Whether the ground under a tuft is still grass.
 *
 * The paint test lives with the CONSUMERS -- the viewport skips these tufts
 * when composing instance matrices, the export when baking meshes -- rather
 * than in the generator. Deciding it here would put the paint field in the
 * generator's cache key, and then every dab of the ground brush would regrow
 * thirty thousand tufts mid-stroke. A lookup per tuft per rebuild is nothing;
 * a full regeneration per brush frame is a stutter.
 */
export function grass3dOnGrass(terrain: TerrainSettings, x: number, z: number): boolean {
  const paint = terrain.paint;
  if (!paint) return true;
  /*
   * All FOUR lattice points around the tuft, not the nearest one.
   *
   * The paint lives on a grid a couple of metres wide, and the drawn boundary
   * runs THROUGH the cells (the edge field cuts them). Sampling only the
   * nearest point let a tuft stand up to half a cell inside a gravel bed and
   * still read the grass point behind it -- a picket line of grass along both
   * edges of every painted patch, and nowhere else. Requiring all four
   * corners to be grass can only err the other way: the tufts stop half a
   * cell short of the paint instead, which reads as a tended edge.
   */
  /*
   * A full lattice cell of margin, not just the cell's own corners.
   *
   * The painted shape's real boundary is drawn from the EDGE field, which
   * remembers where the brush stroke actually ran -- up to a cell away from
   * the lattice points that carry the material. The run off band is cut with
   * the same field, so painted sand there can reach a whole cell past its
   * nearest non-grass lattice point, and tufts cleared against the corners
   * alone still stood on that overhang. Checking the surrounding ring too
   * costs a strip of grass one cell wide around every painted patch, which
   * reads as a tended edge; grass on the gravel reads as a bug.
   */
  const pw = paintRes(terrain.res);
  const ps = paintCellSize(terrain);
  const fx = (x - terrain.originX) / ps;
  const fz = (z - terrain.originZ) / ps;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  for (let dz = -1; dz <= 2; dz++) {
    for (let dx = -1; dx <= 2; dx++) {
      const px = x0 + dx;
      const pz = z0 + dz;
      if (px < 0 || pz < 0 || px >= pw || pz >= pw) continue;
      const v = paint[pz * pw + px];
      if (v > 0 && paintKind(v) !== 0) return false;
    }
  }
  return true;
}

/**
 * The ground PADS a tuft must keep off: gravel beds, paddock tarmac, concrete
 * aprons dropped with the Place tool. They are props, not paint, so the paint
 * test above cannot see them -- and grass standing on a gravel bed is the same
 * lie as grass on a painted gravel bed, told by a different tool. One entry
 * per pad, its rotation pre-resolved, tested by whoever draws the tufts (the
 * same contract, and the same reason, as the paint: props move without the
 * generator's cache key ever hearing about it).
 */
export interface GrassBlocker {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hx: number;
  hz: number;
}

export function grass3dBlockers(
  props: readonly PropInstance[],
  isPad: (kind: string) => boolean,
  footprint: (kind: string) => { cx: number; cz: number; hx: number; hz: number },
): GrassBlocker[] {
  const out: GrassBlocker[] = [];
  for (const p of props) {
    if (!isPad(p.kind)) continue;
    const box = footprint(p.kind);
    const a = ((p.r[1] ?? 0) * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const sx = p.s[0] ?? 1;
    const sz = p.s[2] ?? 1;
    // The footprint centre in world space, so an off-centre box stays honest.
    const lcx = box.cx * sx;
    const lcz = box.cz * sz;
    out.push({
      x: p.p[0] + cos * lcx + sin * lcz,
      z: p.p[2] - sin * lcx + cos * lcz,
      cos,
      sin,
      hx: Math.abs(box.hx * sx),
      hz: Math.abs(box.hz * sz),
    });
  }
  return out;
}

/** Whether a tuft at (x, z) stands on one of the pads. */
export function grass3dOnPad(blockers: readonly GrassBlocker[], x: number, z: number): boolean {
  for (const b of blockers) {
    const dx = x - b.x;
    const dz = z - b.z;
    const r = b.hx + b.hz;
    if (dx * dx + dz * dz > r * r) continue;
    const lx = b.cos * dx - b.sin * dz;
    const lz = b.sin * dx + b.cos * dz;
    if (Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz) return true;
  }
  return false;
}

/** Bucket edge for the coarse neighbour grid, metres. */
const CELL = 60;

/** Points hashed onto a coarse grid, for radius queries in bulk. */
function buckets(pts: { x: number; z: number }[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (let i = 0; i < pts.length; i++) {
    const key = Math.floor(pts[i].x / CELL) * 65536 + Math.floor(pts[i].z / CELL);
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  }
  return map;
}

/** Indices within `radius` of (x, z), by scanning the touched cells. */
function near(map: Map<number, number[]>, pts: { x: number; z: number }[], x: number, z: number, radius: number, out: number[]): void {
  out.length = 0;
  const r2 = radius * radius;
  const c0x = Math.floor((x - radius) / CELL);
  const c1x = Math.floor((x + radius) / CELL);
  const c0z = Math.floor((z - radius) / CELL);
  const c1z = Math.floor((z + radius) / CELL);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const list = map.get(cx * 65536 + cz);
      if (!list) continue;
      for (const i of list) {
        const dx = pts[i].x - x;
        const dz = pts[i].z - z;
        if (dx * dx + dz * dz <= r2) out.push(i);
      }
    }
  }
}

/**
 * The neighbour lists are computed for every BLOCK of cross sections, not
 * every one: the answer changes over tens of metres, the frames sit a couple
 * of metres apart, and this precompute was the most expensive line in the
 * whole generator when it ran per frame. The query radius is widened by the
 * block's own span, so sharing the list loses nothing.
 */
const BLOCK = 8;

/**
 * The generator behind a one-slot cache, keyed on the IDENTITY of the derived
 * pieces it reads. The frames and the profile are themselves memoised, so
 * their identity changes exactly when the shape does -- and crucially, this
 * never runs inside getDerived: the viewport asks a beat after the shape
 * settles, the export asks when the button is pressed, and an editing frame
 * never pays for a lawn.
 */
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object): number => {
  let id = ids.get(o);
  if (id === undefined) {
    id = nextId++;
    ids.set(o, id);
  }
  return id;
};

let cacheKey: string | null = null;
let cacheValue: Float32Array = EMPTY_GRASS3D;

export function grass3dFor(
  terrain: TerrainSettings,
  heights: Float32Array,
  road: RoadSettings,
  trackFrames: Frame[],
  trackClosed: boolean,
  profile: SideProfile,
  pitDrawFrames: Frame[],
  pitApron: Float32Array,
  pitClip: PitClip | null,
): Float32Array {
  // The heights are read for the baseline under each tuft but are NOT part of
  // the key: a sculpt stroke must never regrow the lawn (the stored offsets
  // ride the terrain instead), and the shape signatures cover every reason
  // the offsets could actually change.
  const key =
    `${idOf(trackFrames)}|${idOf(profile)}|${idOf(pitDrawFrames)}|${idOf(pitApron)}|${pitClip ? idOf(pitClip) : 0}|${trackClosed ? 1 : 0}|` +
    `${terrain.originX}|${terrain.originZ}|${terrain.size}|${road.runoffSurface}|` +
    `${road.runoffDrop}|${road.runoffWidth}`;
  if (key !== cacheKey) {
    cacheKey = key;
    cacheValue = generateGrass3d(terrain, heights, road, trackFrames, trackClosed, profile, pitDrawFrames, pitApron, pitClip);
  }
  return cacheValue;
}

export function generateGrass3d(
  terrain: TerrainSettings,
  heights: Float32Array,
  road: RoadSettings,
  trackFrames: Frame[],
  trackClosed: boolean,
  profile: SideProfile,
  pitDrawFrames: Frame[],
  pitApron: Float32Array,
  pitClip: PitClip | null,
): Float32Array {
  const n = trackFrames.length;
  if (n < 2) return EMPTY_GRASS3D;

  const trackPts = trackFrames.map((f) => f.pos);
  const pn = profile.runoffL.length;

  // How far out from the centre line each cross section is built ground, so a
  // tuft near SOMEBODY ELSE'S piece of the lap can keep off it too. The run
  // off counts as ground a tuft may stand on (it is grass, and shaving it
  // leaves a bare strip); the kerb and the coloured strip never are.
  const hardEdge = (i: number, left: boolean): number => {
    const pi = Math.min(i, pn - 1);
    const f = trackFrames[i];
    return left
      ? f.widthL + profile.kerbWL[pi] + profile.apronL[pi]
      : f.widthR + profile.kerbWR[pi] + profile.apronR[pi];
  };

  // How far the band can possibly reach, so the neighbour queries cover it.
  let maxTo = 0;
  for (let i = 0; i < n; i++) {
    const pi = Math.min(i, pn - 1);
    const f = trackFrames[i];
    maxTo = Math.max(
      maxTo,
      f.widthL + profile.kerbWL[pi] + profile.apronL[pi] + profile.runoffL[pi],
      f.widthR + profile.kerbWR[pi] + profile.apronR[pi] + profile.runoffR[pi],
    );
  }
  const reach = maxTo + BEYOND + 2;

  /*
   * The lap running back past itself. Two cross sections are "foreign" to
   * each other when they are far apart ALONG the lap but close ACROSS it --
   * a hairpin's other leg, the far side of a pinched loop. Counted in index
   * distance scaled by the average spacing, which is exact enough for a test
   * whose only job is to keep neighbours out of their own keep-off list.
   */
  let total = 0;
  for (let i = 0; i + 1 < n; i++) total += trackPts[i].distanceTo(trackPts[i + 1]);
  const avg = Math.max(0.5, total / Math.max(1, n - 1));
  const window = Math.ceil((reach * 2) / avg);

  const trackMap = buckets(trackPts);
  const scratch: number[] = [];
  const blocks = Math.ceil(n / BLOCK);
  const foreign = new Map<number, number[]>();
  const blockReach = reach * 2 + BLOCK * avg;
  for (let bi = 0; bi < blocks; bi++) {
    const i = Math.min(n - 1, bi * BLOCK + (BLOCK >> 1));
    near(trackMap, trackPts, trackPts[i].x, trackPts[i].z, blockReach, scratch);
    let list: number[] | null = null;
    for (const j of scratch) {
      const di = Math.abs(i - j);
      if ((trackClosed ? Math.min(di, n - di) : di) <= window + BLOCK) continue;
      if (!list) list = [];
      list.push(j);
    }
    if (list) foreign.set(bi, list);
  }

  // The drawn ribbon's height, asked with the corridor mask's own projection.
  const surfaceAt = corridorSurfaceSampler([roadCorridor(trackFrames, road, profile, trackClosed)]);

  /*
   * The pit lane's DRAWN band, not its centre line and not its nominal width.
   *
   * A radius test against the lane's points misses everything the drawn
   * ribbon adds -- the concrete shoulder, the lead wedges -- so tufts stood
   * on the concrete. And a test against widths+apron alone overshoots at the
   * two junctions, where the CLIP has already cut the band back onto the
   * circuit's tarmac: keeping grass off ground the clip handed back left
   * bald corners at both ends of the lane that read as missing concrete.
   * So the keep-off is exactly what buildPitMeshes draws: per cross section
   * the interval [widths+apron] intersected with the clip, interpolated along
   * each segment, and nothing where the clip has emptied the band.
   */
  const pitN = pitDrawFrames.length;
  let pitBlocked: ((x: number, z: number) => boolean) | null = null;
  if (pitN >= 2) {
    const effLo = new Float32Array(pitN);
    const effHi = new Float32Array(pitN);
    let pitReach = 1;
    for (let i = 0; i < pitN; i++) {
      const f = pitDrawFrames[i];
      const ap = pitApron[Math.min(i, pitApron.length - 1)] ?? 0;
      const rawLo = -(f.widthL + ap);
      const rawHi = f.widthR + ap;
      effLo[i] = pitClip ? Math.max(pitClip.lo[i] ?? rawLo, rawLo) : rawLo;
      effHi[i] = pitClip ? Math.min(pitClip.hi[i] ?? rawHi, rawHi) : rawHi;
      pitReach = Math.max(pitReach, -effLo[i], effHi[i]);
    }
    const pitPts = pitDrawFrames.map((f) => f.pos);
    const pitMap = buckets(pitPts);
    const found: number[] = [];
    const radius = pitReach + KEEP + 4;
    pitBlocked = (x, z) => {
      near(pitMap, pitPts, x, z, radius, found);
      for (const j of found) {
        if (j + 1 >= pitN) continue;
        const pa = pitPts[j];
        const pb = pitPts[j + 1];
        const ex = pb.x - pa.x;
        const ez = pb.z - pa.z;
        const len2 = ex * ex + ez * ez;
        if (len2 < 1e-9) continue;
        let t = ((x - pa.x) * ex + (z - pa.z) * ez) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (pa.x + ex * t);
        const dz = z - (pa.z + ez * t);
        const fr = t < 0.5 ? pitDrawFrames[j] : pitDrawFrames[j + 1];
        // The residual is perpendicular to the segment, so its dot with the
        // frame's right vector is the signed lateral offset in the band.
        const lat = dx * fr.right.x + dz * fr.right.z;
        const lo = effLo[j] + (effLo[j + 1] - effLo[j]) * t;
        const hi = effHi[j] + (effHi[j + 1] - effHi[j]) * t;
        if (hi - lo < 0.05) continue;
        if (lat > lo - KEEP && lat < hi + KEEP) return true;
      }
      return false;
    };
  }

  // Seeded, so the same project always grows the same grass -- in the
  // viewport, in the export, and after a reload.
  let s = 20260830;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const x0 = terrain.originX;
  const z0 = terrain.originZ;
  const x1 = terrain.originX + terrain.size;
  const z1 = terrain.originZ + terrain.size;

  // Unpainted run off takes its material from the road settings; when that is
  // not grass, the strip between the kerb and the open field is bare.
  const runoffGrass = road.runoffSurface === 'GRASS';

  const out: number[] = [];
  const segs = trackClosed ? n : n - 1;

  for (let i = 0; i < segs; i++) {
    const a = trackFrames[i];
    const b = trackFrames[(i + 1) % n];
    const segLen = a.pos.distanceTo(b.pos);
    if (segLen < 1e-6) continue;
    const rows = Math.max(1, Math.round(segLen / ROW));
    const pi = Math.min(i, pn - 1);
    const others = foreign.get((i / BLOCK) | 0);

    for (let side = -1; side <= 1; side += 2) {
      const w = side < 0 ? a.widthL : a.widthR;
      const kerb =
        side < 0 ? profile.kerbWL[pi] + profile.apronL[pi] : profile.kerbWR[pi] + profile.apronR[pi];
      const run = side < 0 ? profile.runoffL[pi] : profile.runoffR[pi];
      const from = w + kerb + KEEP;
      const to = w + kerb + run + BEYOND;

      for (let r = 0; r < rows; r++) {
        const t = (r + rnd()) / rows;
        const cx = a.pos.x + (b.pos.x - a.pos.x) * t;
        const cz = a.pos.z + (b.pos.z - a.pos.z) * t;

        for (let d = from; d < to; d += COL) {
          let lat = d + (rnd() - 0.5) * COL * 0.9;
          if (lat < from) lat = from;
          // Dense at the edge of the road, thinning towards the open field --
          // which is where the eye stops caring and the triangle count starts.
          const frac = (lat - from) / (to - from);
          if (rnd() < frac * 0.7) continue;

          const px = cx + a.right.x * side * lat;
          const pz = cz + a.right.z * side * lat;
          if (px < x0 || px > x1 || pz < z0 || pz > z1) continue;

          /*
           * Where the lap runs back past itself, whoever is nearest owns the
           * ground: if a foreign passage is clearly closer than we are, it
           * plants here and we do not, or a hairpin would grow its grass
           * twice -- and the foreign passage's own tarmac is kept off too.
           */
          if (others) {
            let bad = false;
            for (const j of others) {
              const np = trackPts[j];
              const dx = px - np.x;
              const dz = pz - np.z;
              const nd = Math.hypot(dx, dz);
              if (nd < lat - COL * 1.5) { bad = true; break; }
              const fr = trackFrames[j];
              const left = dx * fr.right.x + dz * fr.right.z < 0;
              if (nd < hardEdge(j, left) + KEEP) { bad = true; break; }
            }
            if (bad) continue;
          }

          // The pit lane, its concrete shoulder and its lead wedges are not
          // grass either.
          if (pitBlocked && pitBlocked(px, pz)) continue;

          // Unpainted run off that is not grass gets no tufts. What the PAINT
          // says is deliberately not checked here -- the consumers do that per
          // tuft (see grass3dOnGrass), so a brush dab never regrows the lawn.
          if (!runoffGrass && lat < w + kerb + run + KEEP) continue;

          /*
           * How far the visible surface stands above the terrain here.
           *
           * Inside the band the surface is the run off ribbon of the road
           * mesh, and the terrain is held sunk under it. The ribbon's height
           * comes from corridorSurfaceSampler -- the exact projection the
           * corridor mask shapes the ground with -- so the tufts land on the
           * quad the eye sees, plus a hair so their roots never z-fight it.
           */
          let dy = 0.01;
          const surface = surfaceAt(px, pz);
          if (surface !== null) {
            const ground = sampleHeights(terrain, heights, px, pz);
            if (surface > ground) dy = surface - ground + 0.01;
          }

          out.push(px, pz, rnd() * Math.PI * 2, 0.7 + rnd() * 0.7, dy);
        }
      }
    }
  }

  return Float32Array.from(out);
}
