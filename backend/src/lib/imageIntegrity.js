// ---------------------------------------------------------------------------
// Is this upload a WHOLE picture?
//
// An upload can arrive short. A phone on a bad connection, a photo the gallery
// is still fetching from the cloud, a tab closed mid-post: the request ends
// early and what reaches the route is the first part of a file. Written to disk
// as-is it is a valid-LOOKING image — the header is intact, so `file` reports
// its size and a browser happily draws the rows it has and leaves the rest
// blank. Which is how a team's wordmark ends up on the poster with its bottom
// half missing, with nothing anywhere saying anything went wrong.
//
// That is the failure this catches. It does not decode anything: every format
// here carries its own idea of where it ENDS, and comparing that to the bytes
// actually received is enough to tell a whole file from half of one.
//
//   PNG   a chain of length-prefixed chunks, ending with IEND. Walking it has
//         to land exactly on the last byte.
//   JPEG  starts FFD8, ends FFD9. Cameras and phones leave the odd byte of
//         padding after the marker, so the tail is scanned rather than pinned.
//   WEBP  a RIFF container whose header states the size of everything after it.
//   SVG   text, and text that has not closed its root element is not a drawing.
//
// Anything else is waved through: this is a check for a known truncation, not a
// list of what may be uploaded — that is the route's business, and refusing a
// format we simply do not parse would be this file inventing a rule.
// ---------------------------------------------------------------------------

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// What the BYTES say this is, which is not always what the upload claims. A
// phone that hands over a HEIC under a .png name is a picture the poster cannot
// draw, and the honest place to say so is here rather than three weeks later
// when somebody wonders why one team has no logo.
export function sniffImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(PNG_MAGIC)) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  // SVG is text and may open with a declaration, a comment or whitespace, so
  // the tag is looked for rather than expected first.
  const head = buf.subarray(0, 1024).toString("utf8").trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--")) {
    if (/<svg[\s>]/i.test(buf.subarray(0, 4096).toString("utf8"))) return "image/svg+xml";
  }
  return null;
}

// `{ whole }`, and when it is not, `declared`: how far the chunk chain says the
// file goes. That number is the useful half of the answer — a file that always
// stops at the same byte is a broken file, and one that stops somewhere new
// every time is a broken connection, and only the number can tell you which.
function pngWalk(buf) {
  let pos = PNG_MAGIC.length;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("latin1");
    // Chunk = 4 length + 4 type + data + 4 CRC. A chunk claiming more than the
    // file holds is the truncation itself.
    pos += 12 + len;
    if (pos > buf.length) return { whole: false, declared: pos };
    // Trailing bytes after IEND are junk but harmless; missing IEND is not.
    if (type === "IEND") return { whole: true };
  }
  return { whole: false, declared: null };
}

function jpegIsComplete(buf) {
  // The end-of-image marker, allowing for the padding some encoders leave.
  const tail = buf.subarray(Math.max(0, buf.length - 64));
  for (let i = tail.length - 2; i >= 0; i--) {
    if (tail[i] === 0xff && tail[i + 1] === 0xd9) return true;
  }
  return false;
}

function webpIsComplete(buf) {
  // The RIFF size counts everything after the first 8 bytes, and a chunk of odd
  // length carries a pad byte that some writers count and some do not.
  const stated = buf.readUInt32LE(4) + 8;
  return buf.length >= stated && buf.length <= stated + 1;
}

function svgIsComplete(buf) {
  return /<\/svg\s*>/i.test(buf.subarray(Math.max(0, buf.length - 4096)).toString("utf8"));
}

// `{ ok: true }`, or `{ ok: false, error }` with the sentence to hand back.
//
// `declared` is the type the upload came in as. It is checked against the bytes
// only when the bytes are a format we recognise: an upload we cannot sniff is
// not evidence of anything, and the route has already said which types it takes.
export function checkImageUpload(buf, declared = null) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, error: "That file arrived empty. Try the upload again." };

  const kind = sniffImageType(buf);
  if (kind && declared && kind !== declared) {
    return {
      ok: false,
      error: `That file is a ${kind.replace("image/", "").toUpperCase()} under a ${declared
        .replace("image/", "")
        .toUpperCase()} name. Save it as the format it says it is and upload it again.`,
    };
  }

  const walk =
    kind === "image/png"
      ? pngWalk(buf)
      : kind === "image/jpeg"
        ? { whole: jpegIsComplete(buf) }
        : kind === "image/webp"
          ? { whole: webpIsComplete(buf), declared: buf.readUInt32LE(4) + 8 }
          : kind === "image/svg+xml"
            ? { whole: svgIsComplete(buf) }
            : { whole: true };

  if (!walk.whole) {
    // The sizes, in the sentence, because they are what somebody can act on.
    // The same two numbers twice means the file on the phone is the broken
    // thing; two different ones means the upload is being cut on the way.
    const sizes = walk.declared
      ? ` It arrived as ${buf.length.toLocaleString("en-GB")} bytes of the ${walk.declared.toLocaleString("en-GB")} it says it has.`
      : ` It arrived as ${buf.length.toLocaleString("en-GB")} bytes and never reaches its own end.`;
    return {
      ok: false,
      short: true,
      received: buf.length,
      declared: walk.declared || null,
      error: `That picture only arrived in part — half a file would be drawn with its bottom missing.${sizes} Try it again, and if the same two numbers come back, the file itself is the incomplete one: open it, re-save it, and upload that.`,
    };
  }
  return { ok: true };
}
