import * as THREE from 'three';
import type { TerrainSettings } from '../types';
import type { MeshDef } from './road';

/**
 * The country beyond the map: rolling hills a kilometre or two out, and a
 * range of mountains behind them, all the way round.
 *
 * A circuit with nothing past the edge of its terrain ends in a line of sky
 * at ground level, which no real place does. This is the cheapest thing that
 * fixes it: one ring of triangles around the terrain, its inner rings flat
 * at ground level so the terrain lies over them, its outer rings lifted into
 * two ridges whose height wanders around the compass. It is scenery only --
 * a car can never reach it -- and it is drawn with a texture that fades from
 * grass at the foot to haze at the peaks, so the far range reads as far.
 *
 * Everything is measured off the terrain square: the ridges stand at fixed
 * multiples of its side and their heights scale with it, so a small map
 * gets low hills close in and a large one gets a proper range.
 */

/** Angular steps round the ring. 2.5 degrees is a ridge with some shape in it. */
const SEGMENTS = 144;

/**
 * The rings: how far past the terrain's corner each stands, in metres, and
 * how much of each ridge height it carries -- the near hills (h1), the
 * middle ridge (h2) and the mountains (h3). The first ring is the centre of
 * the map, the second its corner: both flat, both under the terrain.
 *
 * Metres rather than multiples of the map, because the eye judges a hill by
 * how far away it is and the viewport's fog thins everything past about
 * seven kilometres: a range that stood at three times the side of a large
 * map was out in the haze where nobody saw it.
 */
const RINGS: ReadonlyArray<[number, number, number, number]> = [
  [-1, 0, 0, 0],
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

export function buildHorizon(terrain: TerrainSettings): MeshDef[] {
  if (!wantsHorizon(terrain)) return [];
  const S = terrain.size;
  const cx = terrain.originX + S / 2;
  const cz = terrain.originZ + S / 2;
  // Just under the untouched ground, so the terrain lies over the inner rings.
  const foot = terrain.base - 0.3;
  // The corner of the terrain square is where the country starts.
  const R0 = (S / 2) * Math.SQRT2 + 10;

  const rings = RINGS.length;
  const cols = SEGMENTS + 1;
  const pos = new Float32Array(rings * cols * 3);
  const uv = new Float32Array(rings * cols * 2);
  for (let j = 0; j < rings; j++) {
    const [dr, a1, a2, a3] = RINGS[j];
    const r = dr < 0 ? 0 : R0 + dr;
    for (let i = 0; i < cols; i++) {
      const t = (i / SEGMENTS) * Math.PI * 2;
      const y =
        foot +
        a1 * H1 * (0.5 + ridge(t, 1)) +
        a2 * H2 * (0.6 + ridge(t, 2)) +
        // Peakier than the hills: a range is not a swell.
        a3 * H3 * (0.7 + Math.pow(ridge(t, 3), 1.6) * 1.2);
      const o = (j * cols + i) * 3;
      pos[o] = cx + Math.cos(t) * r;
      pos[o + 1] = y;
      pos[o + 2] = cz + Math.sin(t) * r;
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
