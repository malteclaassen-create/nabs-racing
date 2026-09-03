import * as THREE from 'three';
import type { TerrainSettings } from '../types';
import type { MeshDef } from './road';
import { sampleHeights, TEX_TILE_M } from './terrain';
import { TREE_CARDS, TREE_CARD_INSET, TREE_SHEET_TILES } from './textures';

/**
 * The country beyond the map: rolling hills a kilometre or two out, and a
 * range of mountains behind them, all the way round, with woods on the
 * slopes.
 *
 * A circuit with nothing past the edge of its terrain ends in a line of sky
 * at ground level, which no real place does. This is the cheapest thing that
 * fixes it: one ring of triangles round the terrain square, starting ON its
 * edge at the terrain's own height there, easing down to the base level a
 * little way out, then lifted into ridges whose height wanders around the
 * compass. It is drawn with the terrain's own grass, tiled at the same
 * scale, so the map's ground simply carries on; and it is planted with the
 * same tree cards the Plant tool uses, gathered into woods with clearings
 * between them, so no two stretches of it look alike. Scenery only -- a car
 * can never reach it.
 *
 * It begins at the square's edge and nowhere inside it: a disc under the
 * terrain used to show through wherever the ground had been sculpted below
 * the base level, and it moves with the square when that is resized.
 */

/** Angular steps round the ring. 2.5 degrees is a ridge with some shape in it. */
const SEGMENTS = 144;

/**
 * The rings: how far past the terrain's edge each stands, in metres, and
 * how much of each ridge height it carries -- the near hills (h1), the
 * middle ridge (h2) and the mountains (h3). The first ring is the edge of
 * the terrain itself, at the terrain's height; the second is flat ground at
 * base level.
 *
 * Metres rather than multiples of the map, because the eye judges a hill by
 * how far away it is and the viewport's fog thins everything past about
 * seven kilometres: a range that stood at three times the side of a large
 * map was out in the haze where nobody saw it.
 */
const RINGS: ReadonlyArray<[number, number, number, number]> = [
  [0, 0, 0, 0],
  [250, 0, 0, 0],
  [700, 1, 0, 0],
  [1100, 0.35, 0, 0],
  [1700, 0, 1, 0],
  [2300, 0, 0.4, 0],
  [3200, 0, 0, 1],
  [4000, 0, 0, 0.5],
  [4800, 0, 0, 0.1],
];
/** The ridge heights, metres, on top of the wander of the ridge line. */
const H1 = 70;
const H2 = 180;
const H3 = 450;
/** By this far out the rings have rounded off from the square into a circle. */
const ROUND_BY = 3200;

/**
 * The woods: how many trees are tried, how far out they may stand, and how
 * big they are drawn. Bigger than life the further out they are, because a
 * twelve metre tree two kilometres away is a speck and a wood of specks is
 * a colour, not a wood.
 */
const TREES = 9000;
const TREES_FROM = 120;
const TREES_TO = 2700;

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

/** The lift of the country at `dr` metres past the edge, bearing `t`. */
function lift(dr: number, t: number): number {
  const h = (a1: number, a2: number, a3: number) =>
    a1 * H1 * (0.5 + ridge(t, 1)) +
    a2 * H2 * (0.6 + ridge(t, 2)) +
    // Peakier than the hills: a range is not a swell.
    a3 * H3 * (0.7 + Math.pow(ridge(t, 3), 1.6) * 1.2);
  for (let j = 1; j < RINGS.length; j++) {
    const [d1, a1, b1, c1] = RINGS[j];
    if (dr > d1 && j < RINGS.length - 1) continue;
    const [d0, a0, b0, c0] = RINGS[j - 1];
    const f = Math.min(1, Math.max(0, (dr - d0) / (d1 - d0)));
    return h(a0, b0, c0) * (1 - f) + h(a1, b1, c1) * f;
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

function buildGround(terrain: TerrainSettings, heights: Float32Array): MeshDef {
  const half = terrain.size / 2;
  const cx = terrain.originX + half;
  const cz = terrain.originZ + half;
  const foot = terrain.base - 0.3;

  const rings = RINGS.length;
  const cols = SEGMENTS + 1;
  const pos = new Float32Array(rings * cols * 3);
  const uv = new Float32Array(rings * cols * 2);
  for (let j = 0; j < rings; j++) {
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
        y = foot + lift(dr, t);
      }
      const o = (j * cols + i) * 3;
      const x = cx + c * r;
      const z = cz + s * r;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      // The terrain's grass, tiled at the terrain's scale, so the ground
      // carries straight on over the edge.
      const u = (j * cols + i) * 2;
      uv[u] = x / TEX_TILE_M;
      uv[u + 1] = z / TEX_TILE_M;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * cols + i;
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
  return { name: 'OBJ_horizon', material: 'terrain', surface: null, geometry: g };
}

/**
 * The woods on the slopes: tree cards, two crossed and seen from both
 * sides, gathered where a slow wander round the compass and out from the
 * edge says there is a wood, left open where it says a clearing. Pines and
 * firs take the high ground.
 */
function buildWoods(terrain: TerrainSettings): MeshDef | null {
  const half = terrain.size / 2;
  const cx = terrain.originX + half;
  const cz = terrain.originZ + half;
  const foot = terrain.base - 0.3;

  // A small fixed-seed generator: the same map always grows the same woods.
  let seed = 0x9e3779b9 ^ Math.round(terrain.size);
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Summer green only: no birch and no autumn colour out here (Malte's
  // wish), and the conifers keep to the high ground.
  const lowland: Array<keyof typeof TREE_CARDS> = ['broadleaf', 'broadleaf', 'poplar', 'willow', 'scrub'];
  const upland: Array<keyof typeof TREE_CARDS> = ['pine', 'fir', 'pine', 'fir', 'broadleaf'];

  const trees: Array<{ x: number; y: number; z: number; w: number; h: number; tile: number; ry: number }> = [];
  for (let n = 0; n < TREES; n++) {
    const t = rnd() * Math.PI * 2;
    const dr = TREES_FROM + rnd() * (TREES_TO - TREES_FROM);
    // Woods and clearings: two slow wanders, one round, one outwards.
    const wood = 0.5 * ridge(t * 1.3, 7) + 0.5 * ridge(dr * 0.0025 + t * 0.4, 9);
    // Dense in the woods, none in the clearings: a steep gate on the wander.
    if (rnd() > (wood - 0.42) * 3.0) continue;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const r = radiusAt(half, c, s, dr);
    const y = foot + lift(dr, t);
    const high = lift(dr, t) > 60;
    const kind = high ? upland[(rnd() * upland.length) | 0] : lowland[(rnd() * lowland.length) | 0];
    const card = TREE_CARDS[kind];
    // Larger the further out, so a wood stays a wood at a distance.
    const scale = (1.4 + (dr / TREES_TO) * 2.2) * (0.8 + rnd() * 0.4);
    trees.push({ x: cx + c * r, y: y - 0.3, z: cz + s * r, w: card.w * scale, h: card.h * scale, tile: card.tile, ry: rnd() * Math.PI });
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
      for (let back = 0; back < 2; back++) {
        const v0 = q * 4;
        // Corners: left-bottom, right-bottom, right-top, left-top.
        const corners = [
          [tr.x - dx, tr.y, tr.z - dz, 0, 0],
          [tr.x + dx, tr.y, tr.z + dz, 1, 0],
          [tr.x + dx, tr.y + tr.h, tr.z + dz, 1, 1],
          [tr.x - dx, tr.y + tr.h, tr.z - dz, 0, 1],
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
  const out: MeshDef[] = [buildGround(terrain, heights)];
  const woods = buildWoods(terrain);
  if (woods) out.push(woods);
  return out;
}
