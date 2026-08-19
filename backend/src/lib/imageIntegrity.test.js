import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { checkImageUpload, sniffImageType } from "./imageIntegrity.js";

// A real, tiny PNG, built rather than checked in: the point of these tests is
// what happens when the END of one is missing, and that needs a file whose
// chunk lengths are honest.
function png(w = 4, h = 3) {
  const raw = Buffer.alloc((w * 3 + 1) * h); // filter byte + RGB, all black
  const idat = zlib.deflateSync(raw);
  const table = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const tb = Buffer.from(type);
    let c = 0xffffffff;
    for (const b of Buffer.concat([tb, data])) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, tb, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const jpeg = (tail = Buffer.from([0xff, 0xd9])) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64), tail]);

function webp(bodyLen = 32, stated = null) {
  const buf = Buffer.alloc(8 + bodyLen);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(stated ?? bodyLen, 4);
  buf.write("WEBP", 8, "latin1");
  return buf;
}

describe("sniffImageType", () => {
  it("reads the format off the bytes", () => {
    expect(sniffImageType(png())).toBe("image/png");
    expect(sniffImageType(jpeg())).toBe("image/jpeg");
    expect(sniffImageType(webp())).toBe("image/webp");
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("image/svg+xml");
  });

  it("has no opinion about something it does not know", () => {
    expect(sniffImageType(Buffer.from("just some text, honestly"))).toBe(null);
  });
});

describe("checkImageUpload", () => {
  it("takes a whole picture", () => {
    expect(checkImageUpload(png(), "image/png").ok).toBe(true);
    expect(checkImageUpload(jpeg(), "image/jpeg").ok).toBe(true);
    expect(checkImageUpload(webp(), "image/webp").ok).toBe(true);
    expect(checkImageUpload(Buffer.from("<svg><rect/></svg>"), "image/svg+xml").ok).toBe(true);
  });

  // The one this exists for: the upload that stopped early. The header is
  // intact, so everything downstream treats it as a picture — and draws the
  // rows it has with the rest blank.
  it("refuses a PNG that stops mid-file, and says how short it came", () => {
    const half = png(40, 40).subarray(0, 60);
    const res = checkImageUpload(half, "image/png");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only arrived in part/i);
    // The two numbers are the point: the same pair twice means the file itself
    // is short, a different pair each time means the upload is being cut.
    expect(res.received).toBe(60);
    expect(res.declared).toBeGreaterThan(60);
    expect(res.error).toContain("60 bytes of the");
  });

  it("refuses a PNG whose last chunk claims more than the file holds", () => {
    const whole = png(40, 40);
    // Everything but the last four bytes: the chunk table now overruns the end.
    expect(checkImageUpload(whole.subarray(0, whole.length - 4), "image/png").ok).toBe(false);
  });

  it("refuses a JPEG with no end marker", () => {
    expect(checkImageUpload(jpeg(Buffer.alloc(2)), "image/jpeg").ok).toBe(false);
  });

  // What phones actually write. A Samsung photo carries its motion-photo data
  // AFTER the end marker, and a picture whose trailer is bigger than its
  // picture is still a whole picture — judging one by "does it end exactly at
  // FFD9" refuses every photo off the device.
  it("takes a JPEG with a trailer after the end marker", () => {
    const trailer = Buffer.concat([Buffer.from([0xff, 0xd9]), Buffer.from("SEFH"), Buffer.alloc(400_000, 7)]);
    expect(checkImageUpload(jpeg(trailer), "image/jpeg").ok).toBe(true);
    expect(checkImageUpload(jpeg(Buffer.from([0xff, 0xd9, 0x00, 0x00])), "image/jpeg").ok).toBe(true);
  });

  it("refuses a WEBP shorter than its own header says, and takes one with a trailer", () => {
    expect(checkImageUpload(webp(20, 400), "image/webp").ok).toBe(false);
    expect(checkImageUpload(webp(21, 20), "image/webp").ok).toBe(true);
    expect(checkImageUpload(webp(4000, 20), "image/webp").ok).toBe(true);
  });

  it("refuses an SVG that never closes, and takes one with anything after it", () => {
    expect(checkImageUpload(Buffer.from('<svg xmlns="x"><rect/>'), "image/svg+xml").ok).toBe(false);
    expect(checkImageUpload(Buffer.from("<svg></svg>\n<!-- exported by something -->\n"), "image/svg+xml").ok).toBe(true);
  });

  // A PNG can carry anything after IEND, and a chain this cannot follow is not
  // evidence of anything either: the only PNG refused is one whose own chunk
  // table runs past the end of the file.
  it("takes a PNG with bytes after IEND, and one whose chain it cannot follow", () => {
    expect(checkImageUpload(Buffer.concat([png(), Buffer.alloc(5000, 3)]), "image/png").ok).toBe(true);
    // A chain that ends on a chunk boundary without ever reaching IEND: not
    // something this can call broken, so it is not called broken. Fail-open
    // costs the odd truncation that lands exactly there; the alternative costs
    // people uploads that were fine.
    expect(checkImageUpload(png().subarray(0, 33), "image/png").ok).toBe(true);
  });

  it("refuses an empty upload", () => {
    expect(checkImageUpload(Buffer.alloc(0), "image/png").ok).toBe(false);
  });

  it("says so when the bytes are a different format from the name", () => {
    const res = checkImageUpload(png(), "image/jpeg");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/PNG under a JPEG name/i);
  });

  it("waves through what it cannot parse rather than inventing a rule", () => {
    expect(checkImageUpload(Buffer.from("not an image at all"), "image/tiff").ok).toBe(true);
  });
});
