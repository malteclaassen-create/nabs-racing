// ---------------------------------------------------------------------------
// How high the ground is under a point, from a track's own road triangles.
//
// The laps record where the car was across the ground (x and z) but not how
// high it was, so the 3D view puts each recorded point back on the surface it
// was driven on. A ray against hundreds of thousands of triangles per point is
// seconds per lap; a flat grid of buckets, each holding the triangles that
// cross it, makes it a handful of tests.
//
// Where the road crosses itself (Suzuka's bridge) a point has two answers.
// `near` picks the one closest to the height a moment earlier, so a car on the
// bridge stays on it instead of dropping to the road underneath.
// ---------------------------------------------------------------------------

const CELL = 8; // metres

// `tris` is a flat array of triangle corners: x, y, z for three corners each.
export function groundGrid(tris) {
  const count = Math.floor(tris.length / 9);
  if (!count) return { heightAt: () => null, count: 0 };
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count * 9; i += 3) {
    const x = tris[i], z = tris[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const nx = Math.max(1, Math.ceil((maxX - minX) / CELL) + 1);
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / CELL) + 1);
  const cellX = (x) => Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / CELL)));
  const cellZ = (z) => Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) / CELL)));

  // Two passes into one flat index list: count per cell, then fill. A Map of
  // arrays per cell was the obvious version and cost more memory than the
  // triangles themselves on a real circuit.
  const counts = new Uint32Array(nx * nz + 1);
  const span = (t) => {
    const o = t * 9;
    const x0 = Math.min(tris[o], tris[o + 3], tris[o + 6]), x1 = Math.max(tris[o], tris[o + 3], tris[o + 6]);
    const z0 = Math.min(tris[o + 2], tris[o + 5], tris[o + 8]), z1 = Math.max(tris[o + 2], tris[o + 5], tris[o + 8]);
    return [cellX(x0), cellX(x1), cellZ(z0), cellZ(z1)];
  };
  for (let t = 0; t < count; t++) {
    const [a, b, c, d] = span(t);
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) counts[j * nx + i + 1]++;
  }
  for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
  const index = new Uint32Array(counts[counts.length - 1]);
  const fill = counts.slice(0, -1);
  for (let t = 0; t < count; t++) {
    const [a, b, c, d] = span(t);
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) index[fill[j * nx + i]++] = t;
  }

  function heightAt(x, z, near = null) {
    if (x < minX - CELL || x > maxX + CELL || z < minZ - CELL || z > maxZ + CELL) return null;
    const cell = cellZ(z) * nx + cellX(x);
    let best = null;
    for (let k = counts[cell]; k < counts[cell + 1]; k++) {
      const o = index[k] * 9;
      const ax = tris[o], az = tris[o + 2], bx = tris[o + 3], bz = tris[o + 5], cx = tris[o + 6], cz = tris[o + 8];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * tris[o + 1] + v * tris[o + 4] + w * tris[o + 7];
      if (best === null || (near === null ? y > best : Math.abs(y - near) < Math.abs(best - near))) best = y;
    }
    return best;
  }

  return { heightAt, count };
}

// Heights for a whole recorded lap (x and z in decimetres, as the laps store
// them), each one taken near the one before. A point with no ground under it —
// a wheel over the grass edge of a track whose grass has no surface, a lap
// from an older version of the circuit — takes the heights either side of it.
export function lapHeights(grid, x, z, n) {
  const out = new Array(n).fill(null);
  let prev = null;
  for (let i = 0; i < n; i++) {
    const y = grid.heightAt(x[i] / 10, z[i] / 10, prev);
    if (y !== null) { out[i] = y; prev = y; }
  }
  return fillGaps(out);
}

export function fillGaps(values) {
  const n = values.length;
  const known = [];
  for (let i = 0; i < n; i++) if (values[i] !== null && Number.isFinite(values[i])) known.push(i);
  if (!known.length) return values.map(() => 0);
  const out = values.slice();
  for (let i = 0; i < known[0]; i++) out[i] = values[known[0]];
  for (let i = known[known.length - 1] + 1; i < n; i++) out[i] = values[known[known.length - 1]];
  for (let k = 0; k < known.length - 1; k++) {
    const a = known[k], b = known[k + 1];
    for (let i = a + 1; i < b; i++) out[i] = values[a] + ((values[b] - values[a]) * (i - a)) / (b - a);
  }
  return out;
}
