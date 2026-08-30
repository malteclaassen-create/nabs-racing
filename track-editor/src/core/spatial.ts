import type * as THREE from 'three';

/**
 * Uniform grid lookup for "which of these points is closest to x, z".
 * Used to work out how far the track is from the pit lane at every cross
 * section, which would otherwise be an O(track x pit) sweep on every rebuild.
 */
export class PointIndex {
  private cells = new Map<number, number[]>();
  private cell: number;
  private points: THREE.Vector3[];
  /** Occupied cell range, so a huge search radius cannot run away. */
  private minCX = 0;
  private maxCX = 0;
  private minCZ = 0;
  private maxCZ = 0;

  constructor(points: THREE.Vector3[], cell = 25) {
    this.points = points;
    this.cell = Math.max(1, cell);
    let first = true;
    points.forEach((p, i) => {
      const cx = Math.floor(p.x / this.cell);
      const cz = Math.floor(p.z / this.cell);
      if (first) {
        this.minCX = this.maxCX = cx;
        this.minCZ = this.maxCZ = cz;
        first = false;
      } else {
        if (cx < this.minCX) this.minCX = cx;
        if (cx > this.maxCX) this.maxCX = cx;
        if (cz < this.minCZ) this.minCZ = cz;
        if (cz > this.maxCZ) this.maxCZ = cz;
      }
      const key = cx * 73856093 + cz * 19349663;
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    });
  }

  /**
   * Visit every point within `radius` of (x, z), in no particular order.
   *
   * `nearest` answers "which one is closest", which is the wrong question when
   * a cross section can be hemmed in by several stretches of track at once and
   * only the tightest of them decides how wide the corridor may be.
   */
  within(x: number, z: number, radius: number, visit: (i: number, distanceSq: number) => void): void {
    if (this.points.length === 0 || !(radius > 0)) return;
    const r2 = radius * radius;
    const cx0 = Math.max(this.minCX, Math.floor((x - radius) / this.cell));
    const cx1 = Math.min(this.maxCX, Math.floor((x + radius) / this.cell));
    const cz0 = Math.max(this.minCZ, Math.floor((z - radius) / this.cell));
    const cz1 = Math.min(this.maxCZ, Math.floor((z + radius) / this.cell));

    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells.get(cx * 73856093 + cz * 19349663);
        if (!list) continue;
        for (const i of list) {
          const p = this.points[i];
          const dx = p.x - x;
          const dz = p.z - z;
          // The squared distance goes out with it: every caller wants it, and
          // this one is on a path that runs hundreds of thousands of times per
          // road rebuild -- working it out twice is measurable.
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) visit(i, d2);
        }
      }
    }
  }

  private scanCell(cx: number, cz: number, x: number, z: number, best: { i: number; d: number }) {
    const list = this.cells.get(cx * 73856093 + cz * 19349663);
    if (!list) return;
    for (const i of list) {
      const p = this.points[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < best.d) {
        best.d = d;
        best.i = i;
      }
    }
  }

  /**
   * Index of the nearest point within `radius`, or -1.
   *
   * Rings are scanned outwards and the search stops as soon as the best hit so
   * far cannot be beaten by anything further out. Sizing the loop from the
   * radius instead would scan millions of empty cells when the caller passes a
   * large or unbounded radius, which is exactly what a "just find the closest
   * one" call does.
   */
  nearest(x: number, z: number, radius = Infinity): number {
    if (this.points.length === 0) return -1;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);

    // Far enough out to have covered every occupied cell.
    const maxRings = Math.max(
      Math.abs(cx - this.minCX),
      Math.abs(cx - this.maxCX),
      Math.abs(cz - this.minCZ),
      Math.abs(cz - this.maxCZ),
    );
    const radiusRings = Number.isFinite(radius) ? Math.ceil(radius / this.cell) + 1 : maxRings;
    const limit = Math.min(maxRings, radiusRings);

    // Every point lives inside the occupied box, so rings closer than the box
    // are empty by construction and can be skipped outright. Without this a
    // query far from the track walks thousands of empty rings.
    const startRing = Math.max(
      0,
      Math.max(this.minCX - cx, cx - this.maxCX),
      Math.max(this.minCZ - cz, cz - this.maxCZ),
    );

    const best = { i: -1, d: Number.isFinite(radius) ? radius * radius : Infinity };

    if (startRing > 0) {
      // The query sits outside the occupied box entirely. Walking rings from
      // there means grinding through the whole box one ring at a time, and the
      // early exit cannot help because everything is far away. Scanning the
      // points directly is both exact and cheaper.
      for (let i = 0; i < this.points.length; i++) {
        const p = this.points[i];
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < best.d) {
          best.d = d;
          best.i = i;
        }
      }
      return best.i;
    }

    for (let r = startRing; r <= limit; r++) {
      if (r === 0) {
        this.scanCell(cx, cz, x, z, best);
      } else {
        // Clamp each side of the ring to the occupied box, so a long perimeter
        // that mostly sits in empty space costs nothing.
        const lo = Math.max(cx - r, this.minCX);
        const hi = Math.min(cx + r, this.maxCX);
        if (cz - r >= this.minCZ && cz - r <= this.maxCZ) {
          for (let ix = lo; ix <= hi; ix++) this.scanCell(ix, cz - r, x, z, best);
        }
        if (cz + r >= this.minCZ && cz + r <= this.maxCZ) {
          for (let ix = lo; ix <= hi; ix++) this.scanCell(ix, cz + r, x, z, best);
        }
        const loZ = Math.max(cz - r + 1, this.minCZ);
        const hiZ = Math.min(cz + r - 1, this.maxCZ);
        if (cx - r >= this.minCX && cx - r <= this.maxCX) {
          for (let iz = loZ; iz <= hiZ; iz++) this.scanCell(cx - r, iz, x, z, best);
        }
        if (cx + r >= this.minCX && cx + r <= this.maxCX) {
          for (let iz = loZ; iz <= hiZ; iz++) this.scanCell(cx + r, iz, x, z, best);
        }
      }
      // Anything in a ring further out is at least r cells away, so once the
      // current best beats that distance nothing can improve on it.
      if (best.i >= 0) {
        const guaranteed = r * this.cell;
        if (best.d <= guaranteed * guaranteed) break;
      }
    }

    return best.i;
  }
}
