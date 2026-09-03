import * as THREE from 'three';
import type { TerrainSettings } from '../types';
import type { MeshDef } from './road';
import { sampleHeights, TEX_TILE_M } from './terrain';
import { TREE_CARDS, TREE_CARD_INSET, TREE_SHEET_TILES } from './textures';

/**
 * The country beyond the map: meadows and woods a kilometre or two out,
 * and a range of mountains behind them, all the way round.
 *
 * A circuit with nothing past the edge of its terrain ends in a line of sky
 * at ground level, which no real place does. This is the cheapest thing that
 * fixes it: one ring of triangles round the terrain square, starting ON its
 * edge at the terrain's own height there, easing down to the base level a
 * little way out, then lifted into hills and a range whose height wanders
 * around the compass. Two meshes: the near country wears the terrain's own
 * grass, tiled at the same scale, so the map's ground simply carries on;
 * the range wears a mountain sheet that goes from meadow through forest and
 * rock to snow by HEIGHT, which is what makes a green lump read as a
 * mountain. The slopes are planted with the same tree cards the Plant tool
 * uses, gathered into woods with clearings, conifers higher up, nothing
 * above the tree line. Scenery only -- a car can never reach it.
 *
 * It begins at the square's edge and nowhere inside it: a disc under the
 * terrain used to show through wherever the ground had been sculpted below
 * the base level, and it moves with the square when that is resized.
 */

/** Angular steps round the ring. 1.5 degrees puts facets on a ridge. */
const SEGMENTS = 240;

/**
 * The rings: how far past the terrain's edge each stands, in metres; how
 * much of each ridge height it carries -- the near hills (h1), the middle
 * ridge (h2) and the range (h3); and the seed of its own wander, so the
 * range is a run of foothills, peaks and saddles rather than one smooth
 * wave. The first ring is the edge of the terrain itself, at the terrain's
 * height; the second is flat ground at base level.
 *
 * Metres rather than multiples of the map, because the eye judges a hill by
 * how far away it is and the viewport's fog thins everything past about
 * seven kilometres: a range that stood at three times the side of a large
 * map was out in the haze where nobody saw it.
 */
const RINGS: ReadonlyArray<[number, number, number, number, number]> = [
  [0, 0, 0, 0, 0],
  [250, 0, 0, 0, 0],
  [700, 1, 0, 0, 1],
  [1100, 0.35, 0, 0, 1.4],
  [1500, 0, 1, 0, 2],
  [1900, 0.2, 0.4, 0, 2.6],
  [2300, 0, 0.3, 0.3, 3],
  [2700, 0, 0, 0.75, 3.4],
  [3100, 0, 0, 1, 3.9],
  [3500, 0, 0, 0.8, 4.3],
  [3900, 0, 0, 1, 4.8],
  [4400, 0, 0, 0.55, 5.2],
  [4900, 0, 0, 0.2, 5.7],
];
/** Rings up to this one wear the terrain's grass; from it on, the mountain sheet. */
const GRASS_RINGS = 4;
/** The ridge heights, metres, on top of the wander of the ridge line. */
const H1 = 70;
const H2 = 180;
const H3 = 480;
/** The tallest a peak can come out; the top of the mountain sheet. */
const H_MAX = H3 * 1.9;
/** By this far out the rings have rounded off from the square into a circle. */
const ROUND_BY = 3200;

/**
 * The woods: how many trees are tried, how far out they may stand, how high
 * they climb, and how big they are drawn. Bigger than life the further out
 * they are, because a twelve metre tree two kilometres away is a speck and
 * a wood of specks is a colour, not a wood.
 */
const TREES = 11000;
const TREES_FROM = 120;
const TREES_TO = 3600;
/** No trees above this, metres over the base: the range stands bare. */
const TREE_LINE = 280;
/** Conifers from here up. */
const CONIFER_LINE = 90;

/**
 * A ridge line: a height that wanders round the compass, between 0 and 1.
 * A few sines at prime-ish frequencies with fixed phases, so the same map
 * always has the same skyline and no two ridges have the same shape.
 */
function ridge(theta: number, seed: number): number {
  const parts: Array<[number, number]> = [
    [3, 0.5],
    [5, 0.35],
    [8, 0.25],
    [13, 0.15],
    [21, 0.08],
    [34, 0.06],
    [55, 0.04],
  ];
  let v = 0;
  let norm = 0;
  for (const [f, a] of parts) {
    v += a * Math.sin(f * theta + seed * 1.7 * f + seed);
    norm += a;
  }
  return 0.5 + (0.5 * v) / norm;
}

/** The lift of one ring at a bearing. */
function ringLift(j: number, t: number): number {
  const [, a1, a2, a3, seed] = RINGS[j];
  return (
    a1 * H1 * (0.5 + ridge(t, seed)) +
    a2 * H2 * (0.6 + ridge(t, seed + 0.5)) +
    // Peakier than the hills: a range is not a swell.
    a3 * H3 * (0.7 + Math.pow(ridge(t, seed + 1), 1.6) * 1.2)
  );
}

/**
 * The roughness of the range: every vertex of it is jogged a little, so
 * the ridges have facets and the shading has something to catch. Hashed
 * off the vertex's place in the grid rather than rolled, so the ground the
 * trees are planted on (which interpolates the same grid) agrees with the
 * mesh exactly, and a tree neither floats nor drowns.
 */
function jog(j: number, i: number): number {
  const a3 = RINGS[j][3];
  if (a3 < 0.5) return 0;
  const h = Math.sin((i % SEGMENTS) * 12.9898 + j * 78.233) * 43758.5453;
  return (h - Math.floor(h) - 0.5) * a3 * H3 * 0.3;
}

/** The lift of one vertex of the grid. */
function vertexLift(j: number, i: number): number {
  const t = (i / SEGMENTS) * Math.PI * 2;
  return ringLift(j, t) + jog(j, i);
}

/**
 * The lift of the country at `dr` metres past the edge, bearing `t`: the
 * grid's own surface, interpolated between its four nearest vertices.
 */
function lift(dr: number, t: number): number {
  const fi = ((t / (Math.PI * 2)) % 1 + 1) % 1 * SEGMENTS;
  const i0 = Math.floor(fi);
  const i1 = (i0 + 1) % SEGMENTS;
  const fx = fi - i0;
  for (let j = 1; j < RINGS.length; j++) {
    const d1 = RINGS[j][0];
    if (dr > d1 && j < RINGS.length - 1) continue;
    const d0 = RINGS[j - 1][0];
    const f = Math.min(1, Math.max(0, (dr - d0) / (d1 - d0)));
    const lo = vertexLift(j - 1, i0) * (1 - fx) + vertexLift(j - 1, i1) * fx;
    const hi = vertexLift(j, i0) * (1 - fx) + vertexLift(j, i1) * fx;
    return lo * (1 - f) + hi * f;
  }
  return 0;
}

/** Whether a project wants the country round its map. Undefined counts as yes. */
export function wantsHorizon(terrain: TerrainSettings): boolean {
  return terrain.enabled && terrain.horizon !== false;
}

/**
 * A cheap signature of the terrain's border heights: the ring starts at
 * them, so it has to be rebuilt when they change, and only then.
 */
export function horizonEdgeKey(terrain: TerrainSettings, heights: Float32Array): number {
  const res = terrain.res;
  if (heights.length < res * res) return 0;
  let h = 0;
  for (let i = 0; i < res; i++) {
    h = h * 31 + heights[i] * 1000 + heights[(res - 1) * res + i] * 7 + heights[i * res] * 13 + heights[i * res + res - 1] * 17;
    h %= 1e9;
  }
  return Math.round(h);
}

/** Where a bearing leaves the terrain square, from its centre. */
function edgeRadius(half: number, c: number, s: number): number {
  return half / Math.max(Math.abs(c), Math.abs(s));
}

/** The radius `dr` metres past the edge on a bearing: square near in, a circle far out. */
function radiusAt(half: number, c: number, s: number, dr: number): number {
  const rSquare = edgeRadius(half, c, s);
  const rCircle = half * Math.SQRT2;
  const round = Math.min(1, dr / ROUND_BY);
  return rSquare + (rCircle - rSquare) * round + dr;
}

/** A small fixed-seed generator: the same map always grows the same country. */
function rng(seed: number): () => number {
  let s = (0x9e3779b9 ^ seed) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * One band of rings as a mesh: `from` to `to` inclusive, so two bands share
 * the ring on their seam. The grass band is textured in world metres like
 * the terrain; the mountain band by height, the sheet's V running from the
 * meadow at the foot to the snow at H_MAX.
 */
function buildBand(
  terrain: TerrainSettings,
  heights: Float32Array,
  from: number,
  to: number,
  kind: 'grass' | 'mountain',
): MeshDef {
  const half = terrain.size / 2;
  const cx = terrain.originX + half;
  const cz = terrain.originZ + half;
  const foot = terrain.base - 0.3;

  const rings = to - from + 1;
  const cols = SEGMENTS + 1;
  const pos = new Float32Array(rings * cols * 3);
  const uv = new Float32Array(rings * cols * 2);
  for (let jj = 0; jj < rings; jj++) {
    const j = from + jj;
    const dr = RINGS[j][0];
    for (let i = 0; i < cols; i++) {
      const t = (i / SEGMENTS) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const r = radiusAt(half, c, s, dr);
      let y: number;
      if (j === 0) {
        // On the edge, at the terrain's own height there, a hair inside the
        // grid so the sample never falls off it.
        const rE = edgeRadius(half, c, s) - 0.01;
        y = sampleHeights(terrain, heights, cx + c * rE, cz + s * rE) - 0.02;
      } else {
        y = foot + vertexLift(j, i);
      }
      const o = (jj * cols + i) * 3;
      pos[o] = cx + c * r;
      pos[o + 1] = y;
      pos[o + 2] = cz + s * r;
      const u = (jj * cols + i) * 2;
      if (kind === 'grass') {
        // The terrain's grass, tiled at the terrain's scale, so the ground
        // carries straight on over the edge.
        uv[u] = pos[o] / TEX_TILE_M;
        uv[u + 1] = pos[o + 2] / TEX_TILE_M;
      } else {
        // Round the compass across the sheet, so its grain breaks the bands
        // up; up the sheet by height.
        uv[u] = (i / SEGMENTS) * 8;
        uv[u + 1] = Math.min(0.995, Math.max(0.005, (pos[o + 1] - foot) / H_MAX));
      }
    }
  }
  const index: number[] = [];
  for (let jj = 0; jj < rings - 1; jj++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = jj * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Wound so the faces look up and in, towards the map.
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return kind === 'grass'
    ? { name: 'OBJ_horizon', material: 'terrain', surface: null, geometry: g }
    : { name: 'OBJ_horizon_range', material: 'mountain', surface: null, geometry: g };
}

/**
 * The woods on the slopes: tree cards, two crossed and seen from both
 * sides, gathered where a slow wander round the compass and out from the
 * edge says there is a wood, left open where it says a clearing, thinning
 * with height and stopping at the tree line. Broadleaf in the valleys,
 * conifers on the high ground.
 */
function buildWoods(terrain: TerrainSettings): MeshDef | null {
  const half = terrain.size / 2;
  const cx = terrain.originX + half;
  const cz = terrain.originZ + half;
  const foot = terrain.base - 0.3;
  const rnd = rng(Math.round(terrain.size) * 7);

  // Summer green only: no birch and no autumn colour out here (Malte's
  // wish), and the conifers keep to the high ground.
  const lowland: Array<keyof typeof TREE_CARDS> = ['broadleaf', 'broadleaf', 'poplar', 'willow', 'scrub'];
  const upland: Array<keyof typeof TREE_CARDS> = ['pine', 'fir', 'pine', 'fir', 'broadleaf'];

  const trees: Array<{ x: number; y: number; z: number; w: number; h: number; tile: number; ry: number }> = [];
  for (let n = 0; n < TREES; n++) {
    const t = rnd() * Math.PI * 2;
    const dr = TREES_FROM + rnd() * (TREES_TO - TREES_FROM);
    const up = lift(dr, t);
    if (up > TREE_LINE) continue;
    // Woods and clearings: two slow wanders, one round, one outwards, and
    // a finer one for the clumps inside a wood. Thinner towards the tree
    // line, the way a real slope opens up.
    const wood = 0.5 * ridge(t * 1.3, 7) + 0.5 * ridge(dr * 0.0025 + t * 0.4, 9);
    const clump = ridge(t * 9 + dr * 0.012, 11);
    const thin = 1 - (up / TREE_LINE) * 0.7;
    if (rnd() > (wood - 0.4) * 3.0 * thin) continue;
    if (clump < 0.32 && rnd() < 0.7) continue;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const r = radiusAt(half, c, s, dr);
    const kind = up > CONIFER_LINE ? upland[(rnd() * upland.length) | 0] : lowland[(rnd() * lowland.length) | 0];
    const card = TREE_CARDS[kind];
    // Larger the further out, so a wood stays a wood at a distance.
    const scale = (1.3 + (dr / TREES_TO) * 2.4) * (0.8 + rnd() * 0.4);
    trees.push({ x: cx + c * r, y: foot + up - 0.3, z: cz + s * r, w: card.w * scale, h: card.h * scale, tile: card.tile, ry: rnd() * Math.PI });
  }
  if (trees.length === 0) return null;

  // Four quads a tree: two crossed cards, each with a back face.
  const quads = trees.length * 4;
  const pos = new Float32Array(quads * 4 * 3);
  const nor = new Float32Array(quads * 4 * 3);
  const uv = new Float32Array(quads * 4 * 2);
  const index = new Uint32Array(quads * 6);
  const span = 1 - 2 * TREE_CARD_INSET;
  let q = 0;
  for (const tr of trees) {
    const col = tr.tile % TREE_SHEET_TILES;
    const row = (tr.tile / TREE_SHEET_TILES) | 0;
    for (let k = 0; k < 2; k++) {
      const a = tr.ry + (k * Math.PI) / 2;
      const dx = Math.cos(a) * tr.w * 0.5;
      const dz = Math.sin(a) * tr.w * 0.5;
      // The front face looks this way; the back copy stands 3 cm behind it.
      // Exactly coincident, the two fought for the depth buffer and the
      // material is double sided, so whichever lost had its normal turned
      // away from the sun: every other tree came out black from one side.
      const nx = -Math.sin(a);
      const nz = Math.cos(a);
      for (let back = 0; back < 2; back++) {
        const v0 = q * 4;
        const ox = back ? -nx * 0.03 : 0;
        const oz = back ? -nz * 0.03 : 0;
        // Corners: left-bottom, right-bottom, right-top, left-top.
        const corners = [
          [tr.x - dx + ox, tr.y, tr.z - dz + oz, 0, 0],
          [tr.x + dx + ox, tr.y, tr.z + dz + oz, 1, 0],
          [tr.x + dx + ox, tr.y + tr.h, tr.z + dz + oz, 1, 1],
          [tr.x - dx + ox, tr.y + tr.h, tr.z - dz + oz, 0, 1],
        ];
        for (let i = 0; i < 4; i++) {
          const [x, y, z, u, v] = corners[i];
          pos.set([x, y, z], (v0 + i) * 3);
          // Lit as a canopy, not as a wall: up, so both faces shade alike.
          nor.set([0, 1, 0], (v0 + i) * 3);
          const uu = TREE_CARD_INSET + u * span;
          const vv = TREE_CARD_INSET + v * span;
          uv.set([(col + uu) / TREE_SHEET_TILES, (TREE_SHEET_TILES - 1 - row + vv) / TREE_SHEET_TILES], (v0 + i) * 2);
        }
        if (back === 0) index.set([v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3], q * 6);
        else index.set([v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2], q * 6);
        q++;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return { name: 'OBJ_horizon_woods', material: 'tree_card', surface: null, geometry: g };
}

export function buildHorizon(terrain: TerrainSettings, heights: Float32Array): MeshDef[] {
  if (!wantsHorizon(terrain)) return [];
  const out: MeshDef[] = [
    buildBand(terrain, heights, 0, GRASS_RINGS, 'grass'),
    buildBand(terrain, heights, GRASS_RINGS, RINGS.length - 1, 'mountain'),
  ];
  const woods = buildWoods(terrain);
  if (woods) out.push(woods);
  return out;
}
