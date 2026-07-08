// ---------------------------------------------------------------------------
// Admin-editable per-track extras: custom fun facts and an optional uploaded
// track map image, layered on top of the computed track history. Stored as a
// Setting blob keyed by the canonical track key (see lib/trackKeys.js).
// Same pattern as raceInfo.js / welcomeFaq.js.
// ---------------------------------------------------------------------------
const KEY_PREFIX = "track_info_";
const MAX_FACTS = 8;
const MAX_LABEL = 80;
const MAX_VALUE = 160;

const cap = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");

export function sanitizeTrackInfo(input) {
  const out = { facts: [], mapImageUrl: null };
  if (input && Array.isArray(input.facts)) {
    out.facts = input.facts
      .map((f) => ({ label: cap(f?.label, MAX_LABEL).trim(), value: cap(f?.value, MAX_VALUE).trim() }))
      .filter((f) => f.label || f.value)
      .slice(0, MAX_FACTS);
  }
  if (input && typeof input.mapImageUrl === "string" && input.mapImageUrl.trim()) {
    out.mapImageUrl = input.mapImageUrl.trim().slice(0, 300);
  }
  return out;
}

export async function readTrackInfo(prisma, key) {
  if (!key) return { facts: [], mapImageUrl: null };
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY_PREFIX + key } });
    if (!row?.value) return { facts: [], mapImageUrl: null };
    return sanitizeTrackInfo(JSON.parse(row.value));
  } catch {
    return { facts: [], mapImageUrl: null };
  }
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
