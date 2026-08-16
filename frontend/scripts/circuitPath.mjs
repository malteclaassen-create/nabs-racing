// Projection and normalisation for a circuit outline, in its own file so the
// generator and anything that patches a single track afterwards cannot drift
// apart. A second copy of this maths is a second answer to "where is turn 3".
// Project [lon,lat] degrees -> planar metres-ish (equirectangular, lat-corrected),
// then normalize into a viewBox whose largest side is ~100 with padding.
export function toPath(coords) {
  const meanLat = (coords.reduce((a, c) => a + c[1], 0) / coords.length) * (Math.PI / 180);
  const k = Math.cos(meanLat);
  const pts = coords.map(([lon, lat]) => [lon * k, lat]);

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;

  const D = 100, pad = 6;
  const scale = (D - 2 * pad) / Math.max(spanX, spanY);
  const W = +(spanX * scale + 2 * pad).toFixed(1);
  const H = +(spanY * scale + 2 * pad).toFixed(1);

  let d = "";
  let prev = null;
  for (const [x, y] of pts) {
    const px = +(pad + (x - minX) * scale).toFixed(1);
    const py = +(pad + (maxY - y) * scale).toFixed(1); // flip Y for SVG
    if (prev && prev[0] === px && prev[1] === py) continue; // drop dupes
    d += (d ? " L" : "M") + px + "," + py;
    prev = [px, py];
  }
  d += " Z";
  return { d, box: `0 0 ${W} ${H}` };
}
