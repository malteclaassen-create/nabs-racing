// ---------------------------------------------------------------------------
// The circuit as a vector shape, traced from the map the server publishes.
//
// Assetto Corsa's map.png paints the track surface and nothing else. Drawn as
// an image it is a blur past a few times zoom; traced, its edges are crisp at
// any zoom and the two racing lines sit where they really were on the road.
// Marching squares over the pixel mask gives every boundary — the outer edge
// and the infield hole alike — as closed loops; an evenodd fill puts the hole
// back. Pure functions here, tested; the pixel reading lives in the map.
// ---------------------------------------------------------------------------

// Boundaries of a binary mask (1 = track), as closed loops of [x, y] in pixel
// coordinates where the integer (x, y) is a pixel centre. Cells run one past
// the image on every side so a track touching the edge still closes.
export function contoursFromMask(mask, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  const segs = [];
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const c = at(x, y) * 8 + at(x + 1, y) * 4 + at(x + 1, y + 1) * 2 + at(x, y + 1);
      if (c === 0 || c === 15) continue;
      const T = [x + 0.5, y], R = [x + 1, y + 0.5], B = [x + 0.5, y + 1], L = [x, y + 0.5];
      switch (c) {
        case 1: segs.push([L, B]); break;
        case 2: segs.push([B, R]); break;
        case 3: segs.push([L, R]); break;
        case 4: segs.push([T, R]); break;
        case 5: segs.push([L, T], [B, R]); break;
        case 6: segs.push([T, B]); break;
        case 7: segs.push([L, T]); break;
        case 8: segs.push([T, L]); break;
        case 9: segs.push([T, B]); break;
        case 10: segs.push([T, R], [B, L]); break;
        case 11: segs.push([T, R]); break;
        case 12: segs.push([R, L]); break;
        case 13: segs.push([R, B]); break;
        case 14: segs.push([B, L]); break;
        default:
      }
    }
  }
  const key = (p) => `${p[0] * 2}|${p[1] * 2}`;
  const adj = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segs[i][0], segs[i][1]];
    let cur = segs[i][1];
    for (;;) {
      const next = (adj.get(key(cur)) || []).find((j) => !used[j]);
      if (next == null) break;
      used[next] = 1;
      const s = segs[next];
      const p = key(s[0]) === key(cur) ? s[1] : s[0];
      if (key(p) === key(loop[0])) break;
      loop.push(p);
      cur = p;
    }
    if (loop.length >= 8) loops.push(loop);
  }
  return loops;
}

// Every `step`-th point of a closed loop.
export function decimate(points, step = 2) {
  if (step <= 1) return points;
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  return out;
}

// Chaikin's corner cutting on a closed loop: pixel staircases become curves.
export function chaikin(points, iterations = 2) {
  let pts = points;
  for (let k = 0; k < iterations; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    pts = out;
  }
  return pts;
}

// A binary mask from RGBA pixels. AC's map.png is an opaque track on a
// transparent ground; a map with no transparency is read as light-on-dark.
export function maskFromPixels(data, w, h) {
  const n = w * h;
  const mask = new Uint8Array(n);
  let aMin = 255, aMax = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
  }
  const byAlpha = aMax - aMin > 100;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    mask[i] = byAlpha ? (data[o + 3] > 128 ? 1 : 0) : ((data[o] + data[o + 1] + data[o + 2]) / 3 > 128 ? 1 : 0);
  }
  return mask;
}

// The whole thing as one SVG path in image-pixel coordinates, holes included
// (draw it with fill-rule evenodd). Loops shorter than `minPoints` are noise.
export function trackPathFromMask(mask, w, h, { minPoints = 40, smooth = 2 } = {}) {
  const loops = contoursFromMask(mask, w, h).filter((l) => l.length >= minPoints);
  const parts = loops.map((loop) => {
    const pts = chaikin(decimate(loop, 2), smooth);
    return `M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L")}Z`;
  });
  return { d: parts.join(""), loops: loops.length };
}
