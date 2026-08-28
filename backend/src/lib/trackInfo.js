// ---------------------------------------------------------------------------
// Admin-editable per-track extras: custom fun facts, an optional uploaded
// track map image and the circuit's hotlap videos, layered on top of the
// computed track history. Stored as a Setting blob keyed by the canonical track
// key (see lib/trackKeys.js). Same pattern as raceInfo.js / welcomeFaq.js.
// ---------------------------------------------------------------------------
import { sanitizeVideoList } from "./videoLinks.js";

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
  // Hotlap videos, cleaned by the shared rule (see sanitizeVideoList): only
  // what we can actually embed survives, and the id is resolved here, once, so
  // every reader gets it without re-parsing.
  out.videos = sanitizeVideoList(input?.videos, { max: MAX_VIDEOS, maxTitle: MAX_TITLE });
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
