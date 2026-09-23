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
// ---------------------------------------------------------------------------
import { join } from "path";
import { readFileSync } from "fs";
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
const empty = () => ({ facts: [], mapImageUrl: null, mapImages: {}, mapImageSizes: {}, mapRotation: 0, videos: [], types: null, corners: null });

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
