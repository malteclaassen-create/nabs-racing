// ---------------------------------------------------------------------------
// Admin-editable per-track extras: custom fun facts, an optional uploaded
// track map image and the circuit's hotlap videos, layered on top of the
// computed track history. Stored as a Setting blob keyed by the canonical track
// key (see lib/trackKeys.js). Same pattern as raceInfo.js / welcomeFaq.js.
//
// The map image comes in two layers: the shared one (`mapImageUrl`), shown to
// every series, and one per series (`mapImages`, keyed by series slug) for a
// league that wants its own picture of the circuit — its own colours, its own
// facts box — on its own pages. A series with an image of its own sees that;
// every other series sees the shared one (mapImageFor). The slug is a series'
// URL identity and never changes (lib/series.js), which is what makes it a
// safe key here.
//
// The outline (`outlineUrl`) is a second, separate picture: a line drawing of
// the circuit on a transparent background, for a circuit the site has no
// outline of its own for (frontend data/circuits.js). Wherever the site draws
// outlines (the race calendar cards, the Tracks list on the profiles) it then
// draws this one, in its own colours and at its own line weight
// (components/CircuitMap.jsx). It is shrunk and cropped to the drawing on
// upload (shrinkTrackOutline), which also measures how thick its line is
// (`outlineLine`, in the stored picture's pixels, with its size in
// `outlineSize`): the page thickens a thin line to the weight it draws its own
// outlines at, so a downloaded drawing needs no editing first. One file per
// circuit, so a new upload replaces the old one on disk.
// ---------------------------------------------------------------------------
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import { sanitizeVideoList } from "./videoLinks.js";
import { imageSize } from "./socialFeed.js";
import { UPLOADS_DIR } from "./dataDirs.js";
import { sanitizeTypes, sanitizeCorners } from "./trackProfile.js";

const KEY_PREFIX = "track_info_";
const MAX_FACTS = 8;
const MAX_LABEL = 80;
const MAX_VALUE = 160;
// Hotlap videos: a handful per circuit is plenty (one per season's car, plus an
// onboard or two). The attendance page shows them as a picker over one player.
const MAX_VIDEOS = 6;
const MAX_TITLE = 80;

const cap = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");

// The shape every reader gets, including for an unknown or unsaved track.
// `types` and `corners` are the circuit's kind and its corner names
// (lib/trackProfile.js); both stay null until an admin sets them, which is
// what lets the circuit's defaults apply.
const empty = () => ({ facts: [], mapImageUrl: null, mapImages: {}, mapImageSizes: {}, mapRotation: 0, outlineUrl: null, outlineLine: null, outlineSize: null, videos: [], types: null, corners: null });

// A series slug as lib/series.js makes them: lowercase letters, digits and
// hyphens. Anything else in the map is not a series and is dropped.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function sanitizeTrackInfo(input) {
  const out = empty();
  if (input && Array.isArray(input.facts)) {
    out.facts = input.facts
      .map((f) => ({ label: cap(f?.label, MAX_LABEL).trim(), value: cap(f?.value, MAX_VALUE).trim() }))
      .filter((f) => f.label || f.value)
      .slice(0, MAX_FACTS);
  }
  if (input && typeof input.mapImageUrl === "string" && input.mapImageUrl.trim()) {
    out.mapImageUrl = input.mapImageUrl.trim().slice(0, 300);
  }
  if (input && input.mapImages && typeof input.mapImages === "object") {
    for (const [slug, url] of Object.entries(input.mapImages)) {
      if (!SLUG_RE.test(slug) || typeof url !== "string" || !url.trim()) continue;
      out.mapImages[slug] = url.trim().slice(0, 300);
    }
  }
  // `photoUrl` is what the first version of this upload was called.
  const outline = input?.outlineUrl ?? input?.photoUrl;
  if (typeof outline === "string" && outline.trim()) {
    out.outlineUrl = outline.trim().slice(0, 300);
    const line = Number(input.outlineLine);
    const w = Number(input.outlineSize?.w);
    const h = Number(input.outlineSize?.h);
    if (line > 0 && line < 1000 && Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) {
      out.outlineLine = Math.round(line * 100) / 100;
      out.outlineSize = { w, h };
    }
  }
  // The pixel size of each uploaded picture, keyed by its path (the URL
  // without the cache-busting query), so the page can hold the picture's
  // height open before a byte of it has arrived (mapImageSizeFor).
  if (input && input.mapImageSizes && typeof input.mapImageSizes === "object") {
    for (const [path, size] of Object.entries(input.mapImageSizes)) {
      const w = Number(size?.w);
      const h = Number(size?.h);
      if (!path || path.length > 300 || !Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) continue;
      out.mapImageSizes[imageKeyOf(path)] = { w, h };
    }
  }
  // Rotation (degrees) for the built-in outline, so it can be turned to fill
  // the upcoming-race panel. Normalised to 0..359; 0 = as drawn.
  const rot = Number(input?.mapRotation);
  if (Number.isFinite(rot)) out.mapRotation = ((Math.round(rot) % 360) + 360) % 360;
  // Hotlap videos, cleaned by the shared rule (see sanitizeVideoList): only
  // what we can actually embed survives, and the id is resolved here, once, so
  // every reader gets it without re-parsing.
  out.videos = sanitizeVideoList(input?.videos, { max: MAX_VIDEOS, maxTitle: MAX_TITLE });
  out.types = sanitizeTypes(input?.types);
  out.corners = sanitizeCorners(input?.corners);
  return out;
}

// The map image a series sees: its own when it has one, else the shared one,
// else nothing (the site draws the built-in outline). Pure.
export function mapImageFor(info, seriesSlug) {
  const own = seriesSlug ? info?.mapImages?.[seriesSlug] : null;
  return own || info?.mapImageUrl || null;
}

// The key a picture's size is stored under: its path, without the ?v= the
// upload appends to defeat caches — a re-upload of the same scope keeps the
// path and replaces the size.
export function imageKeyOf(url) {
  return String(url || "").split("?")[0];
}

// The stored pixel size of a map image, or null when it was never measured.
export function mapImageSizeFor(info, url) {
  return (url && info?.mapImageSizes?.[imageKeyOf(url)]) || null;
}

// Width and height out of an upload's own bytes: the raster formats through
// the reader the social feed already has, SVG from its viewBox (or width and
// height) — a drawing with neither has no shape to reserve. null when unknown.
export function imageSizeOf(buffer) {
  const raster = imageSize(buffer);
  if (raster && raster.width > 0 && raster.height > 0) return { w: raster.width, h: raster.height };
  const head = Buffer.isBuffer(buffer) ? buffer.subarray(0, 4096).toString("utf8") : String(buffer || "");
  if (!/<svg[\s>]/i.test(head)) return null;
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(head);
  if (vb) {
    const w = Math.round(Number(vb[1]));
    const h = Math.round(Number(vb[2]));
    if (w > 0 && h > 0) return { w, h };
  }
  const wm = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(head);
  const hm = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(head);
  if (wm && hm) {
    const w = Math.round(Number(wm[1]));
    const h = Math.round(Number(hm[1]));
    if (w > 0 && h > 0) return { w, h };
  }
  return null;
}

// The size of the picture at `url`, measured once and kept: the stored size
// when there is one, else read off the file on disk (pictures uploaded before
// sizes were kept) and written back for next time. Best-effort — a picture
// that cannot be measured simply answers null, and the page lets it load
// without a reserved height, as it always did.
export async function ensureMapImageSize(prisma, key, info, url) {
  const stored = mapImageSizeFor(info, url);
  if (stored) return stored;
  const path = imageKeyOf(url);
  const m = /^\/api\/uploads\/tracks\/([A-Za-z0-9._-]+)$/.exec(path);
  if (!m) return null;
  try {
    const size = imageSizeOf(readFileSync(join(UPLOADS_DIR, "tracks", m[1])));
    if (!size) return null;
    await writeTrackInfo(prisma, key, { ...info, mapImageSizes: { ...info.mapImageSizes, [path]: size } });
    return size;
  } catch {
    return null;
  }
}

export async function readTrackInfo(prisma, key) {
  if (!key) return empty();
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY_PREFIX + key } });
    if (!row?.value) return empty();
    return sanitizeTrackInfo(JSON.parse(row.value));
  } catch {
    return empty();
  }
}

// A circuit with no lap on file used to play a "stand-in lap" — the rickroll,
// as a running joke. It is gone: the attendance page now says the hotlap is
// coming soon, which is both true and useful to somebody learning the track.
// The old admin switch and its `hotlap_fallback` Setting row went with it.

export async function writeTrackInfo(prisma, key, value) {
  const clean = sanitizeTrackInfo(value);
  const json = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: KEY_PREFIX + key },
    create: { key: KEY_PREFIX + key, value: json },
    update: { value: json },
  });
  return clean;
}

// The longest side an outline is kept at. A calendar card is the largest place
// it shows, so this is generous, and it keeps an upload of several megabytes
// down to a few KB on the server.
export const TRACK_OUTLINE_MAX = 960;

// An outline as it is stored: WebP, no side longer than TRACK_OUTLINE_MAX,
// cropped to the drawing with a small margin, so it fills its box the way the
// built-in outlines fill theirs. `line` is how thick its line is, in the
// stored picture's pixels: twice the drawn area over its edge, which for a
// line of width w and length L is 2·wL / 2L. `transparent` says whether the
// background is see-through: the site paints the drawing's shape in its own
// colour, so a picture without one would come out as a solid block. Throws
// when the picture does not decode.
export async function shrinkTrackOutline(buffer, max = TRACK_OUTLINE_MAX) {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const img = await loadImage(buffer);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const ink = (x, y) => px[(y * w + x) * 4 + 3] >= 128;
  let area = 0;
  let edge = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!ink(x, y)) continue;
      area += 1;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !ink(x - 1, y) || !ink(x + 1, y) || !ink(x, y - 1) || !ink(x, y + 1))
        edge += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  // A few see-through pixels at a ragged edge are not a transparent background.
  const transparent = w * h - area > (w * h) / 20;
  const line = edge ? Math.max(1, (2 * area) / edge) : 1;
  if (!area) return { buffer: await canvas.encode("webp", 80), width: w, height: h, transparent, line };
  // Room around the drawing for the thicker line the page may give it.
  const pad = Math.ceil(Math.max(line, Math.max(x1 - x0, y1 - y0) * 0.03)) + 2;
  const cx = Math.max(0, x0 - pad);
  const cy = Math.max(0, y0 - pad);
  const cw = Math.min(w, x1 + pad + 1) - cx;
  const ch = Math.min(h, y1 + pad + 1) - cy;
  const cropped = createCanvas(cw, ch);
  cropped.getContext("2d").drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
  return { buffer: await cropped.encode("webp", 80), width: cw, height: ch, transparent, line };
}

// What the page needs of an outline: where it is, its size and its line.
const outlineShape = (info) =>
  info.outlineLine ? { url: info.outlineUrl, line: info.outlineLine, w: info.outlineSize.w, h: info.outlineSize.h } : null;

// An outline uploaded before its line was measured: measure and crop it now,
// once, from the file on disk. null when the file is not there.
async function upgradeOutline(prisma, key, info) {
  const file = /^\/api\/uploads\/tracks\/([\w.-]+?)(?:\?|$)/.exec(info.outlineUrl || "")?.[1];
  if (!file) return null;
  try {
    const out = await shrinkTrackOutline(readFileSync(join(UPLOADS_DIR, "tracks", file)));
    const name = `${key}__outline.webp`;
    writeFileSync(join(UPLOADS_DIR, "tracks", name), out.buffer);
    const saved = await writeTrackInfo(prisma, key, {
      ...info,
      outlineUrl: `/api/uploads/tracks/${name}?v=${Date.now()}`,
      outlineLine: out.line,
      outlineSize: { w: out.width, h: out.height },
    });
    return outlineShape(saved);
  } catch {
    return null;
  }
}

// Every uploaded outline, { <trackKey>: { url, line, w, h } }: the site loads
// this once and draws these where it has no outline of its own. An outline
// that cannot be measured (its file is gone) is left out.
let upgrading = null;
export async function readTrackOutlines(prisma) {
  const out = {};
  const stale = [];
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: KEY_PREFIX } } });
  for (const row of rows) {
    try {
      const info = sanitizeTrackInfo(JSON.parse(row.value));
      if (!info.outlineUrl) continue;
      const key = row.key.slice(KEY_PREFIX.length);
      const shape = outlineShape(info);
      if (shape) out[key] = shape;
      else stale.push([key, info]);
    } catch {
      /* a broken row has no outline */
    }
  }
  if (stale.length) {
    // One upgrade at a time, however many visitors ask at once.
    upgrading ||= (async () => {
      const done = {};
      for (const [key, info] of stale) {
        const shape = await upgradeOutline(prisma, key, info);
        if (shape) done[key] = shape;
      }
      return done;
    })().finally(() => {
      upgrading = null;
    });
    Object.assign(out, await upgrading);
  }
  return out;
}
