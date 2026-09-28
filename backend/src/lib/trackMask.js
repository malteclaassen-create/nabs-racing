// Where the track is, read off the server manager's map.png.
//
// AC draws that map as the road surface on transparency, so an opaque pixel is
// tarmac and a clear one is grass, gravel or wall. From it we build, once per
// track, how far every pixel is from the nearest tarmac, and "how far off the
// road is this car" becomes a lookup. An estimate: kerbs and run-off that the
// map does not paint count as off.
import { inflateSync } from "node:zlib";

// Just enough PNG: 8-bit, not interlaced, any colour type. Returns the alpha
// (or, without alpha, 255 for anything not black) per pixel.
export function decodePngAlpha(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace) throw new Error(`unsupported png (${bitDepth} bit, interlace ${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = x * channels;
      if (colorType === 6) out[y * width + x] = cur[o + 3];
      else if (colorType === 4) out[y * width + x] = cur[o + 1];
      else out[y * width + x] = cur[o] || (channels === 3 && (cur[o + 1] || cur[o + 2])) ? 255 : 0;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, alpha: out };
}

// Distance (in pixels) from every pixel to the nearest opaque one. Two-pass
// chamfer transform, good to a few percent.
function distanceToTarmac(width, height, solid) {
  const INF = 1e9;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = solid[i] ? 0 : INF;
  const A = 1, B = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + A);
      if (y > 0) {
        v = Math.min(v, d[i - width] + A);
        if (x > 0) v = Math.min(v, d[i - width - 1] + B);
        if (x < width - 1) v = Math.min(v, d[i - width + 1] + B);
      }
      d[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < width - 1) v = Math.min(v, d[i + 1] + A);
      if (y < height - 1) {
        v = Math.min(v, d[i + width] + A);
        if (x < width - 1) v = Math.min(v, d[i + width + 1] + B);
        if (x > 0) v = Math.min(v, d[i + width - 1] + B);
      }
      d[i] = v;
    }
  }
  return d;
}

// calib = { scaleFactor, xOffset, zOffset, padding } (the live board's map).
// Returns (x, z) => metres from the painted road (0 on it), or null if the
// point is off the picture altogether.
//
// Worked at half resolution (a 2x2 block counts as road if any of it is) and
// kept as one byte per cell: Interlagos' map is 1680 x 2598, and a float per
// pixel would be 17 MB held for the evening, per server. This is about 1 MB,
// and half a pixel is still well under a metre on every map we have.
const STEP = 2;
export function buildTrackMask(png, calib) {
  const img = decodePngAlpha(png);
  const w = Math.ceil(img.width / STEP);
  const h = Math.ceil(img.height / STEP);
  const solid = new Uint8Array(w * h);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.alpha[y * img.width + x] > 40) solid[((y / STEP) | 0) * w + ((x / STEP) | 0)] = 1;
    }
  }
  const df = distanceToTarmac(w, h, solid);
  const cells = new Uint8Array(w * h);
  for (let i = 0; i < df.length; i++) cells[i] = Math.min(255, Math.round(df[i]));
  const cellM = calib.scaleFactor * STEP;
  const pad = calib.padding || 0;
  return (x, z) => {
    const px = ((x + calib.xOffset) / calib.scaleFactor + pad) / STEP;
    const py = ((z + calib.zOffset) / calib.scaleFactor + pad) / STEP;
    const cx = Math.round(px), cy = Math.round(py);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return null;
    return cells[cy * w + cx] * cellM;
  };
}
