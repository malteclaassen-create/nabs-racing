// Small copies of uploaded profile pictures, for the places that show them as
// a 24-56px disc (standings rows, the tab bar, nav chips).
//
// Uploads are stored exactly as they arrived: a photo straight off a phone is
// often 3-4000px and several megabytes (the limit is 8MB). Shown at 44px, the
// phone still has to download and DECODE the whole thing, and an installed app
// on an iPhone drops decoded pictures from memory readily — so every page
// switch decoded every face in the list again, and they visibly loaded in one
// after another each time.
//
// `GET /api/uploads/avatars/<file>?w=<size>` answers with a square-ish WebP
// whose short side is <size> (one of SIZES), made on first request and kept
// on disk next to the originals. The name carries the original's mtime, so a
// re-upload (same file name, new picture) makes a new copy instead of serving
// the old face. Anything unusual — another size, a GIF (it may be animated), a
// missing file, a picture the decoder refuses — falls through to the original
// via express.static, so this can only ever make a picture smaller, never
// break one.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { UPLOADS_DIR } from "./dataDirs.js";

export const THUMB_SIZES = [96, 192, 384];
const AVATAR_DIR = join(UPLOADS_DIR, "avatars");
const THUMB_DIR = join(AVATAR_DIR, "_thumbs");
const NAME = /^[\w-]+\.(png|jpe?g|webp)$/i;

let canvasLib = null;
const canvasModule = async () => (canvasLib ||= await import("@napi-rs/canvas"));

// One render per (file, size) at a time: a standings page asks for the same
// face from several components at once on a cold cache.
const pending = new Map();

async function render(src, dest, w) {
  const { loadImage, createCanvas } = await canvasModule();
  const img = await loadImage(readFileSync(src));
  const scale = Math.min(1, w / Math.min(img.width, img.height));
  const cw = Math.max(1, Math.round(img.width * scale));
  const ch = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(cw, ch);
  canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
  const buf = await canvas.encode("webp", 82);
  mkdirSync(THUMB_DIR, { recursive: true });
  writeFileSync(dest, buf);
}

// The path of the small copy, making it if needed; null = serve the original.
export async function avatarThumbPath(file, w) {
  if (!THUMB_SIZES.includes(w) || !NAME.test(file)) return null;
  const src = join(AVATAR_DIR, file);
  if (!existsSync(src)) return null;
  const stem = file.slice(0, -extname(file).length);
  const dest = join(THUMB_DIR, `${stem}-${Math.round(statSync(src).mtimeMs)}-${w}.webp`);
  if (existsSync(dest)) return dest;
  if (!pending.has(dest)) {
    pending.set(
      dest,
      render(src, dest, w).finally(() => pending.delete(dest))
    );
  }
  try {
    await pending.get(dest);
    return dest;
  } catch {
    return null;
  }
}

// Express handler, mounted ahead of the static /api/uploads route.
export async function avatarThumbRoute(req, res, next) {
  const w = Number(req.query.w);
  if (!w) return next();
  try {
    const path = await avatarThumbPath(req.params.file, w);
    if (!path) return next();
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type("image/webp");
    res.sendFile(path);
  } catch {
    next();
  }
}
