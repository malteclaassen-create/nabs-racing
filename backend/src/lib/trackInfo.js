// ---------------------------------------------------------------------------
// Admin-editable per-track extras: custom fun facts, an optional uploaded
// track map image and the circuit's hotlap videos, layered on top of the
// computed track history. Stored as a Setting blob keyed by the canonical track
// key (see lib/trackKeys.js). Same pattern as raceInfo.js / welcomeFaq.js.
// ---------------------------------------------------------------------------
import { youtubeId } from "./videoLinks.js";

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
const empty = () => ({ facts: [], mapImageUrl: null, mapRotation: 0, videos: [] });

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
  // Rotation (degrees) for the built-in outline, so it can be turned to fill
  // the upcoming-race panel. Normalised to 0..359; 0 = as drawn.
  const rot = Number(input?.mapRotation);
  if (Number.isFinite(rot)) out.mapRotation = ((Math.round(rot) % 360) + 360) % 360;
  // Hotlap videos. Only what we can actually embed survives: a row whose link
  // isn't a YouTube video is dropped rather than stored as a dead player. The
  // id is resolved here, once, so every reader gets it without re-parsing.
  // Note this runs on the way IN and on the way OUT, so it has to accept the
  // stored shape ({ id }) as readily as the editor's ({ url }) — reading a
  // saved track back must not empty it.
  if (input && Array.isArray(input.videos)) {
    const seen = new Set();
    for (const v of input.videos) {
      const id = youtubeId(v?.url ?? v?.videoId ?? v?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.videos.push({ id, title: cap(v?.title, MAX_TITLE).trim() });
      if (out.videos.length >= MAX_VIDEOS) break;
    }
  }
  return out;
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

// ---------------------------------------------------------------------------
// The stand-in lap: what the attendance page plays for a circuit nobody has put
// a real hotlap on yet. It is a running joke, not a feature — the default video
// is the one everybody has been sent at least once — so it carries a plain
// on/off switch and shows no still image, which would give it away before the
// click. A circuit WITH a real lap never sees it.
// ---------------------------------------------------------------------------
const FALLBACK_KEY = "hotlap_fallback";

export const FALLBACK_DEFAULTS = {
  enabled: true,
  videoId: "dQw4w9WgXcQ",
  // Empty means "<Track> hotlap", which is what a real one would be called.
  label: "",
};

export function sanitizeFallback(input) {
  const out = { ...FALLBACK_DEFAULTS };
  if (!input || typeof input !== "object") return out;
  out.enabled = input.enabled !== false;
  const id = youtubeId(input.videoId ?? input.url);
  if (id) out.videoId = id;
  out.label = cap(input.label, MAX_TITLE).trim();
  return out;
}

export async function readHotlapFallback(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: FALLBACK_KEY } });
    return row?.value ? sanitizeFallback(JSON.parse(row.value)) : { ...FALLBACK_DEFAULTS };
  } catch {
    return { ...FALLBACK_DEFAULTS };
  }
}

export async function writeHotlapFallback(prisma, value) {
  const clean = sanitizeFallback(value);
  const json = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: FALLBACK_KEY },
    create: { key: FALLBACK_KEY, value: json },
    update: { value: json },
  });
  return clean;
}

// The list the attendance page should show for a track: the real laps, or the
// stand-in when there are none and it's switched on. `poster: false` is what
// keeps the joke intact — see above.
export function videosWithFallback(videos, fallback, trackName) {
  if (videos?.length) return videos;
  if (!fallback?.enabled || !fallback.videoId) return [];
  return [{ id: fallback.videoId, title: fallback.label || `${trackName} hotlap`, poster: false }];
}

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
