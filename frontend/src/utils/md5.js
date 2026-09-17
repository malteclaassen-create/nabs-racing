// ---------------------------------------------------------------------------
// MD5, because Assetto Corsa checksums with it.
//
// The browser's own crypto.subtle does SHA-1 and up but NOT MD5 — deliberately,
// it is not a safe hash any more. That does not matter here: nothing is being
// secured, the number is only compared with what the race server computed for
// the same file (see pages/ContentCheck.jsx), and it has to be MD5 because
// that is what the game uses.
//
// Input is a Uint8Array, output lowercase hex. Written against RFC 1321 and
// verified byte for byte against Node's crypto.createHash("md5") over the
// awkward lengths (0, 55, 56, 63, 64, 65) and random buffers up to a megabyte
// — the block-boundary cases are exactly where a hand-written MD5 goes wrong.
//
// The files this hashes are a few hundred kB each (a car's data.acd, a track's
// surfaces.ini), so it reads the padding on the fly instead of copying the
// whole buffer to append it.
// ---------------------------------------------------------------------------

// Per-round left-rotation amounts.
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i + 1)) * 2^32), the constants of the spec.
const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

const HEX = [];
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, "0"));

export function md5(bytes) {
  const len = bytes.length;
  // The message plus the 0x80 marker and the 8-byte length, rounded up to
  // whole 64-byte blocks.
  const padded = (len + 9 + 63) & ~63;
  // Byte j of that padded message, computed rather than stored.
  const byteAt = (j) => (j < len ? bytes[j] : j === len ? 0x80 : 0);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const M = new Uint32Array(16);

  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      M[i] = (byteAt(j) | (byteAt(j + 1) << 8) | (byteAt(j + 2) << 16) | (byteAt(j + 3) << 24)) >>> 0;
    }
    // The last block carries the message length in BITS, little-endian across
    // its final two words. Computed by division rather than shifts: a file
    // over 512 MB overflows a 32-bit shift and would hash wrong.
    if (off + 64 === padded) {
      M[14] = (len * 8) % 4294967296 >>> 0;
      M[15] = Math.floor(len / 536870912) >>> 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + K[i] + M[g]) >>> 0;
      const rot = (sum << S[i]) | (sum >>> (32 - S[i]));
      b = (b + rot) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0]
    .map((w) => HEX[w & 0xff] + HEX[(w >>> 8) & 0xff] + HEX[(w >>> 16) & 0xff] + HEX[(w >>> 24) & 0xff])
    .join("");
}

// Hash a File / Blob the browser handed us. Kept beside the algorithm so a
// caller never has to think about ArrayBuffers.
export async function md5File(file) {
  const buf = await file.arrayBuffer();
  return md5(new Uint8Array(buf));
}
