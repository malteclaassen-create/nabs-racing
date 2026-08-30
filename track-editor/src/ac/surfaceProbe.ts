import * as THREE from 'three';
import type { AcSceneMesh } from './acScene';

/**
 * Asking an imported circuit where its surface is.
 *
 * Everything the editor adds to an imported track -- a kerb, a painted line, a
 * braking board -- has to sit ON the track, and the track is a hundred thousand
 * triangles somebody else built. The recovered centre line is a good scaffold
 * but it is a smoothed spline through an AI file: measured against the real
 * thing it is up to half a metre out sideways and its height is interpolated
 * between control points twelve metres apart. Painting a line on that puts it
 * next to the tarmac rather than on it.
 *
 * So the mesh is the truth and this is how it is asked:
 *
 *   heightAt(x, z)         what is the surface height here
 *   edgeFrom(p, dir, max)  how far does the tarmac go that way
 *
 * Both need thousands of queries -- one per vertex of every generated strip --
 * so a raycast against the whole model is out. Triangles go into a flat
 * uniform grid over XZ instead, which for a circuit is close to ideal: the
 * drivable surface is a long thin ribbon, so most cells are empty and the ones
 * that are not hold a handful of triangles.
 */

/** Grid cell size, metres. About a road width: bigger wastes tests, smaller wastes cells. */
const CELL = 8;

/**
 * How far above and below the asked-for height a hit still counts.
 *
 * Tracks cross over themselves -- a bridge, a tunnel, the Nordschleife
 * carousel doubling back underneath -- so "the highest surface here" is the
 * wrong question and would put a kerb on the flyover. The question is "the
 * surface nearest the height I expect", and this is how far it may be.
 */
const DEFAULT_REACH = 12;

interface Tri {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
  /** Index into the surface key table, so a hit knows what it landed on. */
  surface: number;
}

export interface SurfaceHit {
  y: number;
  /** The surfaces.ini KEY of the triangle that was hit. */
  surface: string;
}

export class SurfaceProbe {
  private cells = new Map<number, Tri[]>();
  private surfaces: string[] = [];
  private minX = Infinity;
  private minZ = Infinity;
  readonly triangleCount: number;
  readonly bounds = new THREE.Box3();

  constructor(meshes: readonly AcSceneMesh[]) {
    let count = 0;
    for (const mesh of meshes) {
      if (!mesh.geometry) continue;
      this.bounds.union(mesh.box);
    }
    if (this.bounds.isEmpty()) {
      this.triangleCount = 0;
      return;
    }
    this.minX = this.bounds.min.x;
    this.minZ = this.bounds.min.z;

    for (const mesh of meshes) {
      const geo = mesh.geometry;
      if (!geo) continue;
      const surface = this.surfaceId(mesh.surface ?? '');
      const pos = geo.getAttribute('position');
      const index = geo.getIndex();
      const triCount = index ? index.count / 3 : pos.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        const tri: Tri = {
          ax: pos.getX(i0), ay: pos.getY(i0), az: pos.getZ(i0),
          bx: pos.getX(i1), by: pos.getY(i1), bz: pos.getZ(i1),
          cx: pos.getX(i2), cy: pos.getY(i2), cz: pos.getZ(i2),
          surface,
        };
        this.insert(tri);
        count += 1;
      }
    }
    this.triangleCount = count;
  }

  private surfaceId(key: string): number {
    let i = this.surfaces.indexOf(key);
    if (i < 0) { i = this.surfaces.length; this.surfaces.push(key); }
    return i;
  }

  private key(cx: number, cz: number): number {
    // A single number so the Map does not hold a string per cell. 20 bits each
    // is a million cells per axis, which at 8 m is eight thousand kilometres.
    return cx * 1048576 + cz;
  }

  private insert(tri: Tri) {
    const x0 = Math.floor((Math.min(tri.ax, tri.bx, tri.cx) - this.minX) / CELL);
    const x1 = Math.floor((Math.max(tri.ax, tri.bx, tri.cx) - this.minX) / CELL);
    const z0 = Math.floor((Math.min(tri.az, tri.bz, tri.cz) - this.minZ) / CELL);
    const z1 = Math.floor((Math.max(tri.az, tri.bz, tri.cz) - this.minZ) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        const list = this.cells.get(k);
        if (list) list.push(tri);
        else this.cells.set(k, [tri]);
      }
    }
  }

  /**
   * The surface at (x, z), nearest to `nearY`.
   *
   * Returns null when there is nothing there, which is the honest answer and
   * is what tells a caller it has walked off the edge of the track.
   */
  sample(x: number, z: number, nearY = 0, reach = DEFAULT_REACH): SurfaceHit | null {
    const cx = Math.floor((x - this.minX) / CELL);
    const cz = Math.floor((z - this.minZ) / CELL);
    const list = this.cells.get(this.key(cx, cz));
    if (!list) return null;

    let best: SurfaceHit | null = null;
    let bestGap = Infinity;
    for (const tri of list) {
      const y = heightInTriangle(tri, x, z);
      if (y === null) continue;
      const gap = Math.abs(y - nearY);
      if (gap > reach || gap >= bestGap) continue;
      bestGap = gap;
      best = { y, surface: this.surfaces[tri.surface] };
    }
    return best;
  }

  /** Just the height, or null. */
  heightAt(x: number, z: number, nearY = 0, reach = DEFAULT_REACH): number | null {
    return this.sample(x, z, nearY, reach)?.y ?? null;
  }

  /**
   * How far the surface reaches from `from` in direction `dir`.
   *
   * Walks outward in small steps and stops at the first place the surface
   * stops being one of `accept` -- so "how wide is the tarmac here" is asked by
   * accepting the tarmac keys, and the answer is the distance to the edge. The
   * height is tracked along the way rather than fixed, so the walk follows a
   * banked corner instead of leaving the surface halfway across it.
   */
  edgeFrom(
    from: THREE.Vector3,
    dir: THREE.Vector3,
    maxDistance: number,
    accept: (surface: string) => boolean,
    step = 0.25,
  ): number {
    let y = from.y;
    let last = 0;
    for (let d = step; d <= maxDistance; d += step) {
      const x = from.x + dir.x * d;
      const z = from.z + dir.z * d;
      const hit = this.sample(x, z, y, 3);
      if (!hit || !accept(hit.surface)) return last;
      y = hit.y;
      last = d;
    }
    return maxDistance;
  }
}

/**
 * Height of a triangle's plane at (x, z), or null when the point is outside it.
 *
 * Barycentric, on the XZ projection. A triangle standing exactly on its edge
 * has zero projected area and is skipped -- a wall has no height to report.
 */
function heightInTriangle(t: Tri, x: number, z: number): number | null {
  const v0x = t.cx - t.ax, v0z = t.cz - t.az;
  const v1x = t.bx - t.ax, v1z = t.bz - t.az;
  const denom = v0x * v1z - v1x * v0z;
  if (Math.abs(denom) < 1e-9) return null;

  const v2x = x - t.ax, v2z = z - t.az;
  const u = (v2x * v1z - v1x * v2z) / denom;
  const v = (v0x * v2z - v2x * v0z) / denom;
  // A hair of tolerance, so a point on a shared edge belongs to one of them
  // rather than falling between two triangles.
  if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) return null;
  return t.ay + u * (t.cy - t.ay) + v * (t.by - t.ay);
}
