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
const empty = () => ({ facts: [], mapImageUrl: null, mapImages: {}, mapRotation: 0, videos: [] });

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

// The map image a series sees: its own when it has one, else the shared one,
// else nothing (the site draws the built-in outline). Pure.
export function mapImageFor(info, seriesSlug) {
  const own = seriesSlug ? info?.mapImages?.[seriesSlug] : null;
  return own || info?.mapImageUrl || null;
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
