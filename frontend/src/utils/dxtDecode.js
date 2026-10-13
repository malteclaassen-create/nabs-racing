// ---------------------------------------------------------------------------
// DXT1 / DXT3 / DXT5 (S3TC) unpacked into plain RGBA, for a graphics chip that
// cannot take them compressed. AC's track textures are nearly all DDS in
// these formats, and phone GPUs almost never support them, so without this a
// phone would draw every track in flat placeholder colours.
//
// Only ever run on a small mip level (utils/acTrackScene.js picks one around
// 256 px): a 256² texture is 256 KB unpacked, and a few hundred of them is
// what a phone can hold.
// ---------------------------------------------------------------------------

function rgb565(c, out) {
  out[0] = ((c >> 11) & 31) * 255 / 31;
  out[1] = ((c >> 5) & 63) * 255 / 63;
  out[2] = (c & 31) * 255 / 31;
}

// The four (or three plus transparent) colours of one block's palette.
function palette(c0, c1, fourColour) {
  const a = [0, 0, 0], b = [0, 0, 0];
  rgb565(c0, a);
  rgb565(c1, b);
  const p = [[...a, 255], [...b, 255]];
  if (fourColour || c0 > c1) {
    p.push([(2 * a[0] + b[0]) / 3, (2 * a[1] + b[1]) / 3, (2 * a[2] + b[2]) / 3, 255]);
    p.push([(a[0] + 2 * b[0]) / 3, (a[1] + 2 * b[1]) / 3, (a[2] + 2 * b[2]) / 3, 255]);
  } else {
    p.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 255]);
    p.push([0, 0, 0, 0]);
  }
  return p;
}

// `kind` is 1, 3 or 5. Returns width × height × 4 bytes.
export function decodeDxt(data, width, height, kind) {
  const out = new Uint8Array(width * height * 4);
  const blockBytes = kind === 1 ? 8 : 16;
  const bw = Math.max(1, Math.ceil(width / 4)), bh = Math.max(1, Math.ceil(height / 4));
  const alpha = new Uint8Array(16);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const o = (by * bw + bx) * blockBytes;
      if (o + blockBytes > data.length) return out;
      let c = o;
      if (kind === 3) {
        for (let i = 0; i < 16; i++) alpha[i] = ((data[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
        c = o + 8;
      } else if (kind === 5) {
        const a0 = data[o], a1 = data[o + 1];
        const table = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) table.push(((7 - i) * a0 + i * a1) / 7);
        else { for (let i = 1; i < 5; i++) table.push(((5 - i) * a0 + i * a1) / 5); table.push(0, 255); }
        // 48 bits of 3-bit indices, little endian, across bytes 2..7.
        let bits = 0, have = 0, at = o + 2;
        for (let i = 0; i < 16; i++) {
          if (have < 3) { bits |= data[at++] << have; have += 8; }
          alpha[i] = table[bits & 7];
          bits >>= 3;
          have -= 3;
        }
        c = o + 8;
      }
      const c0 = data[c] | (data[c + 1] << 8), c1 = data[c + 2] | (data[c + 3] << 8);
      const pal = palette(c0, c1, kind !== 1);
      const idx = data[c + 4] | (data[c + 5] << 8) | (data[c + 6] << 16) | (data[c + 7] << 24);
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
        if (x >= width || y >= height) continue;
        const col = pal[(idx >>> (i * 2)) & 3];
        const q = (y * width + x) * 4;
        out[q] = col[0];
        out[q + 1] = col[1];
        out[q + 2] = col[2];
        out[q + 3] = kind === 1 ? col[3] : alpha[i];
      }
    }
  }
  return out;
}
