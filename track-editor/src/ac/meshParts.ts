import * as THREE from 'three';
import { decodeMesh, type Kn5Mesh } from './kn5Read';

/**
 * Breaking one of the track's meshes into the separate things it really is.
 *
 * A modder merges. `1kerb01` is not "a kerb", it is EVERY kerb of that type on
 * the circuit in one mesh; `twall031` is 280 barrier segments; `treesXFixed` is
 * four thousand trees. Selecting the mesh selects all of them at once, which
 * is exactly what was reported: click the kerb at turn one and the one at turn
 * two lights up too.
 *
 * The fix is to find the connected pieces. Two things that look obvious about
 * that are both wrong, and the numbers say so:
 *
 *   CONNECTIVITY ALONE IS NOT ENOUGH. Measured on the reference track,
 *   `1kerb01` has 14,424 triangles and 10,817 connected pieces with a median
 *   size of ONE triangle -- its vertices are not welded, so almost every
 *   triangle is its own island. Useless.
 *
 *   BUT IT IS NOT USELESS EVERYWHERE. On the same track `twall031` falls into
 *   280 pieces of 16-24 triangles, one per barrier section, and
 *   `treesXFixed_SUB1` into 4,236 pieces of 2, one per tree. Those are exactly
 *   the objects somebody would want to move.
 *
 * So positions are WELDED first -- vertices within a millimetre are treated as
 * the same point -- and connectivity is run on that. The unwelded kerb then
 * joins back up into the runs it is drawn as, and the barriers and trees stay
 * separate because they genuinely do not touch.
 *
 * Everything here works on the mesh's own LOCAL coordinates, so the editor and
 * the exporter compute identical pieces in identical order, which matters: the
 * piece INDEX is what a saved project stores.
 */

/** Vertices closer than this are the same point. */
const WELD = 0.001;

export interface MeshPart {
  /** Triangle indices (into the mesh's index buffer / 3) belonging to it. */
  triangles: Int32Array;
  /** Vertex indices it uses. What a transform has to move. */
  vertices: Int32Array;
  /** Bounds in the mesh's own local space. */
  box: THREE.Box3;
}

export interface MeshPartition {
  parts: MeshPart[];
  /** Island id per triangle, so a raycast hit maps straight to a piece. */
  ofTriangle: Int32Array;
}

/**
 * Split a mesh into its connected pieces.
 *
 * Deterministic: pieces come back ordered by their first triangle, so the same
 * mesh always yields the same piece numbers in this editor and in the export.
 */
export function partitionMesh(mesh: Kn5Mesh): MeshPartition {
  const d = decodeMesh(mesh);
  const triCount = Math.floor(d.indices.length / 3);
  const vertexCount = mesh.vertexCount;

  /* --- weld ---------------------------------------------------------- */
  // A hash of the rounded position, so two vertices a hair apart share a key.
  const welded = new Int32Array(vertexCount);
  const byCell = new Map<string, number>();
  for (let i = 0; i < vertexCount; i++) {
    const x = Math.round(d.positions[i * 3] / WELD);
    const y = Math.round(d.positions[i * 3 + 1] / WELD);
    const z = Math.round(d.positions[i * 3 + 2] / WELD);
    const key = `${x},${y},${z}`;
    const seen = byCell.get(key);
    if (seen === undefined) { byCell.set(key, i); welded[i] = i; }
    else welded[i] = seen;
  }

  /* --- connect ------------------------------------------------------- */
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    // Path compression, so a long chain is walked once.
    while (parent[x] !== r) { const next = parent[x]; parent[x] = r; x = next; }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let t = 0; t < triCount; t++) {
    const a = welded[d.indices[t * 3]];
    const b = welded[d.indices[t * 3 + 1]];
    const c = welded[d.indices[t * 3 + 2]];
    union(a, b);
    union(b, c);
  }

  /* --- collect ------------------------------------------------------- */
  const ofTriangle = new Int32Array(triCount).fill(-1);
  const order = new Map<number, number>();
  const triangleLists: number[][] = [];
  for (let t = 0; t < triCount; t++) {
    const root = find(welded[d.indices[t * 3]]);
    let id = order.get(root);
    if (id === undefined) {
      id = triangleLists.length;
      order.set(root, id);
      triangleLists.push([]);
    }
    ofTriangle[t] = id;
    triangleLists[id].push(t);
  }

  const parts: MeshPart[] = triangleLists.map((tris) => {
    const used = new Set<number>();
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const v = d.indices[t * 3 + k];
        used.add(v);
        box.expandByPoint(p.set(d.positions[v * 3], d.positions[v * 3 + 1], d.positions[v * 3 + 2]));
      }
    }
    return { triangles: Int32Array.from(tris), vertices: Int32Array.from(used), box };
  });

  return { parts, ofTriangle };
}

/**
 * Geometry for one piece, in the mesh's local space.
 *
 * Used to draw a selected piece on its own so it can be dragged, and to
 * highlight it.
 */
export function partGeometry(mesh: Kn5Mesh, part: MeshPart): THREE.BufferGeometry {
  const d = decodeMesh(mesh);
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const t of part.triangles) {
    for (let k = 0; k < 3; k++) {
      const v = d.indices[t * 3 + k];
      let local = remap.get(v);
      if (local === undefined) {
        local = positions.length / 3;
        remap.set(v, local);
        positions.push(d.positions[v * 3], d.positions[v * 3 + 1], d.positions[v * 3 + 2]);
        normals.push(d.normals[v * 3], d.normals[v * 3 + 1], d.normals[v * 3 + 2]);
        uvs.push(d.uvs[v * 2], d.uvs[v * 2 + 1]);
      }
      indices.push(local);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(indices);
  return g;
}

/**
 * Geometry for everything EXCEPT one piece.
 *
 * The other half of dragging a piece: the rest of the mesh has to keep being
 * drawn where it is, without the piece that moved.
 */
export function withoutPart(mesh: Kn5Mesh, partition: MeshPartition, id: number): THREE.BufferGeometry {
  const rest: number[] = [];
  for (let t = 0; t < partition.ofTriangle.length; t++) {
    if (partition.ofTriangle[t] !== id) rest.push(t);
  }
  return partGeometry(mesh, {
    triangles: Int32Array.from(rest),
    vertices: new Int32Array(0),
    box: new THREE.Box3(),
  });
}

/**
 * Whether splitting this mesh is worth offering.
 *
 * A mesh that comes apart into one piece is one object, and a road surface
 * that comes apart into thousands of stray triangles is not made of objects
 * either -- offering to move a quarter of a triangle helps nobody. Both are
 * treated as "select the whole thing".
 */
export function isSplittable(partition: MeshPartition): boolean {
  if (partition.parts.length < 2) return false;
  // At least one piece has to be a real thing rather than a sliver.
  return partition.parts.some((p) => p.triangles.length >= 2);
}

/* ------------------------------------------------------------------ */
/* Texture density                                                     */
/* ------------------------------------------------------------------ */

export interface UvRates {
  /** UV units per metre along each world axis, as [du, dv]. */
  x: [number, number];
  y: [number, number];
  z: [number, number];
  /** How far the piece reaches in UV. Below 1 the texture does not repeat. */
  spanU: number;
  spanV: number;
}

/**
 * How the texture is laid onto a piece.
 *
 * Needed to resize something without stretching what is printed on it. Making
 * a two metre kerb five centimetres wider stretches its pattern by the same
 * 2.7% unless the UVs grow with it, and on a chequered kerb that is visible as
 * squares that no longer match the one next door.
 *
 * Measured off the edges rather than assumed: for every triangle edge that
 * runs mostly along one world axis, compare how far it travels in the world
 * with how far it travels in UV. Diagonal edges are skipped -- they say
 * nothing clean about either axis. On a real sausage kerb this comes out as
 * 0.97 u per metre across and 0.21 v per metre along, which is exactly the
 * strip mapping the modder drew.
 */
export function uvRates(mesh: Kn5Mesh, vertices?: Int32Array, triangles?: Int32Array): UvRates {
  const d = decodeMesh(mesh);
  const tris = triangles ?? Int32Array.from({ length: mesh.indexCount / 3 }, (_, i) => i);
  const acc = { x: [0, 0, 0], y: [0, 0, 0], z: [0, 0, 0] } as Record<string, number[]>;
  const axes = ['x', 'y', 'z'] as const;

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const seen = new Set<number>();

  for (const t of tris) {
    const vs = [d.indices[t * 3], d.indices[t * 3 + 1], d.indices[t * 3 + 2]];
    for (const v of vs) {
      if (seen.has(v)) continue;
      seen.add(v);
      minU = Math.min(minU, d.uvs[v * 2]); maxU = Math.max(maxU, d.uvs[v * 2]);
      minV = Math.min(minV, d.uvs[v * 2 + 1]); maxV = Math.max(maxV, d.uvs[v * 2 + 1]);
    }
    for (let e = 0; e < 3; e++) {
      const a = vs[e], b = vs[(e + 1) % 3];
      const dw = [
        d.positions[b * 3] - d.positions[a * 3],
        d.positions[b * 3 + 1] - d.positions[a * 3 + 1],
        d.positions[b * 3 + 2] - d.positions[a * 3 + 2],
      ];
      const len = Math.hypot(dw[0], dw[1], dw[2]);
      if (len < 1e-4) continue;
      const abs = dw.map(Math.abs);
      const biggest = Math.max(abs[0], abs[1], abs[2]);
      // Only edges that clearly belong to one axis.
      if (biggest / len < 0.8) continue;
      const axis = axes[abs.indexOf(biggest)];
      acc[axis][0] += Math.abs(d.uvs[b * 2] - d.uvs[a * 2]) / len;
      acc[axis][1] += Math.abs(d.uvs[b * 2 + 1] - d.uvs[a * 2 + 1]) / len;
      acc[axis][2] += 1;
    }
  }

  const rate = (a: 'x' | 'y' | 'z'): [number, number] =>
    acc[a][2] === 0 ? [0, 0] : [acc[a][0] / acc[a][2], acc[a][1] / acc[a][2]];

  void vertices;
  return {
    x: rate('x'), y: rate('y'), z: rate('z'),
    spanU: Number.isFinite(minU) ? maxU - minU : 0,
    spanV: Number.isFinite(minV) ? maxV - minV : 0,
  };
}
