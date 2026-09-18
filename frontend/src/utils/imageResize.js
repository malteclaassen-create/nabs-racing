// Shrink a picked image in the browser before it is uploaded.
//
// Race screenshots come off a 4K monitor at 8-12 MB each, and a gallery of
// twenty of those is a page nobody on mobile data will ever finish loading (and
// a server upload limit nobody will ever get past). Doing it here rather than
// on the server keeps the backend free of a native image library, and the
// upload itself becomes small enough to be quick on a home connection.
//
// Anything it can't handle is returned untouched, so a failure costs quality,
// never the upload.

const SKIP_TYPES = new Set([
  // An animated GIF drawn onto a canvas comes back as its first frame — the
  // one thing worse than a heavy GIF is a still one.
  "image/gif",
]);

// Above this, a JPEG is re-encoded even when its dimensions are already fine.
// A 1920x1080 screenshot exported at maximum quality is several megabytes, and
// the old "right size, so leave it alone" rule waved exactly those through at
// full weight — the one case where somebody notices their photos went up
// untouched. A 1920px JPEG at the quality below lands well under this, so
// anything heavier has something to give back.
export const REENCODE_OVER_BYTES = 500 * 1024;

// `keepAlpha` is for pictures whose transparency is the point: a driver cut out
// of their background, a logo, a badge. JPEG has no alpha, so the normal path
// below lays the picture on black first, which turns a cut-out into a portrait
// in a black box. With this on, a PNG or WebP stays one, and the background
// stays see-through.
export async function shrinkImage(
  file,
  { maxSide = 1920, quality = 0.82, maxBytes = REENCODE_OVER_BYTES, keepAlpha = false } = {}
) {
  if (!file || !file.type?.startsWith("image/") || SKIP_TYPES.has(file.type)) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    // Nothing to gain: already within the size limit, already a compressed
    // format, and not heavy enough to be worth re-encoding.
    if (scale === 1 && file.type === "image/jpeg" && file.size <= maxBytes) return file;
    // Keeping the alpha means keeping the format, and re-encoding a PNG that is
    // already small enough only ever makes it bigger.
    const alpha = keepAlpha && (file.type === "image/png" || file.type === "image/webp");
    if (alpha && scale === 1) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // A PNG screenshot may carry transparency; JPEG can't, and without this the
    // transparent pixels come out black instead of white. Not done when the
    // transparency is being kept on purpose — that black IS the bug there.
    if (!alpha) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const type = alpha ? "image/png" : "image/jpeg";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, alpha ? undefined : quality));
    if (!blob) return file;
    // If the "optimised" version came out bigger (small images do that), keep
    // the original — the point is a smaller upload, not a converted one. A
    // resized PNG is the exception: it is the smaller PICTURE that was wanted,
    // and PNG happily spends more bytes on fewer pixels.
    if (blob.size >= file.size && !alpha) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + (alpha ? ".png" : ".jpg");
    return new File([blob], name, { type, lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}

// The whole picked batch, one after another. Sequential on purpose: decoding a
// dozen 12-megapixel images at once is what makes a browser tab go white.
export async function shrinkImages(files, opts) {
  const out = [];
  for (const f of files) out.push(await shrinkImage(f, opts));
  return out;
}
