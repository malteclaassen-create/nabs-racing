import * as THREE from 'three';
import type { TerrainSettings } from '../types';
import type { MeshDef } from './road';
import { sampleHeights } from './terrain';

/**
 * The country beyond the map: rolling hills a kilometre or two out, and a
 * range of mountains behind them, all the way round.
 *
 * A circuit with nothing past the edge of its terrain ends in a line of sky
 * at ground level, which no real place does. This is the cheapest thing that
 * fixes it: one ring of triangles round the terrain square, starting ON its
 * edge at the terrain's own height there, easing down to the base level a
 * little way out, then lifted into two ridges whose height wanders around
 * the compass. It is scenery only -- a car can never reach it -- and it is
 * drawn with a texture that fades from grass at the foot to haze at the
 * peaks, so the far range reads as far.
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

export function buildHorizon(terrain: TerrainSettings, heights: Float32Array): MeshDef[] {
  if (!wantsHorizon(terrain)) return [];
  const S = terrain.size;
  const half = S / 2;
  const cx = terrain.originX + half;
  const cz = terrain.originZ + half;
  const foot = terrain.base - 0.3;

  const rings = RINGS.length;
  const cols = SEGMENTS + 1;
  const pos = new Float32Array(rings * cols * 3);
  const uv = new Float32Array(rings * cols * 2);
  for (let j = 0; j < rings; j++) {
    const [dr, a1, a2, a3] = RINGS[j];
    // From the square's edge near in to a circle far out.
    const round = Math.min(1, dr / ROUND_BY);
    for (let i = 0; i < cols; i++) {
      const t = (i / SEGMENTS) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const rSquare = half / Math.max(Math.abs(c), Math.abs(s));
      const rCircle = half * Math.SQRT2;
      const r = rSquare + (rCircle - rSquare) * round + dr;
      let y: number;
      if (j === 0) {
        // On the edge, at the terrain's own height there, a hair inside the
        // grid so the sample never falls off it.
        const x = cx + c * (rSquare - 0.01);
        const z = cz + s * (rSquare - 0.01);
        y = sampleHeights(terrain, heights, x, z) - 0.02;
      } else {
        y =
          foot +
          a1 * H1 * (0.5 + ridge(t, 1)) +
          a2 * H2 * (0.6 + ridge(t, 2)) +
          // Peakier than the hills: a range is not a swell.
          a3 * H3 * (0.7 + Math.pow(ridge(t, 3), 1.6) * 1.2);
      }
      const o = (j * cols + i) * 3;
      pos[o] = cx + c * r;
      pos[o + 1] = y;
      pos[o + 2] = cz + s * r;
      const u = (j * cols + i) * 2;
      uv[u] = (i / SEGMENTS) * 12;
      uv[u + 1] = j / (rings - 1);
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
  return [{ name: 'OBJ_horizon', material: 'horizon', surface: null, geometry: g }];
}
