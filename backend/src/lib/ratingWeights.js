// ---------------------------------------------------------------------------
// Persisted driver-rating weights. The admin ratings panel used to be a preview
// sandbox only; this stores a chosen set of weights in the Setting table so the
// public ratings actually use them. Shape mirrors RATING_DEFAULTS in
// driverRatingsService.js (band, dominance, fullXpShare, and the rtg/pac/rac/aha
// weight groups). Values are sanitised to plain numbers with hard caps.
// ---------------------------------------------------------------------------
const RATING_WEIGHTS_KEY = "rating_weights";

const clampNum = (v, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
};

// Keep only known groups/keys, coerce to numbers. Weight groups accept any
// non-negative numbers (they're normalised proportionally at read time).
function sanitizeGroup(input, keys) {
  if (!input || typeof input !== "object") return undefined;
  const out = {};
  for (const k of keys) {
    const n = clampNum(input[k], 0, 1000);
    if (n != null) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

export function sanitizeRatingWeights(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};
  const band = {};
  const low = clampNum(input.band?.low, 0, 99);
  const high = clampNum(input.band?.high, 0, 99);
  if (low != null) band.low = low;
  if (high != null) band.high = high;
  if (Object.keys(band).length) out.band = band;

  const dom = {};
  const max = clampNum(input.dominance?.max, 0, 20);
  const fullAt = clampNum(input.dominance?.fullAt, 0.05, 1);
  if (max != null) dom.max = max;
  if (fullAt != null) dom.fullAt = fullAt;
  if (Object.keys(dom).length) out.dominance = dom;

  const fxs = clampNum(input.fullXpShare, 0.1, 1);
  if (fxs != null) out.fullXpShare = fxs;

  const rtg = sanitizeGroup(input.rtg, ["rac", "pac", "aha", "exp"]);
  const pac = sanitizeGroup(input.pac, ["lap", "grid"]);
  const rac = sanitizeGroup(input.rac, ["finish", "gained", "overtakes", "podium"]);
  const aha = sanitizeGroup(input.aha, ["finishRate", "dnf", "consistency", "contacts", "env", "penalties", "cuts"]);
  if (rtg) out.rtg = rtg;
  if (pac) out.pac = pac;
  if (rac) out.rac = rac;
  if (aha) out.aha = aha;

  return Object.keys(out).length ? out : null;
}

export async function readRatingWeights(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: RATING_WEIGHTS_KEY } });
    if (!row?.value) return null;
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

// value = sanitised object, or null to clear (fall back to defaults).
export async function writeRatingWeights(prisma, value) {
  const clean = sanitizeRatingWeights(value);
  if (!clean) {
    await prisma.setting.deleteMany({ where: { key: RATING_WEIGHTS_KEY } });
    return null;
  }
  const json = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: RATING_WEIGHTS_KEY },
    create: { key: RATING_WEIGHTS_KEY, value: json },
    update: { value: json },
  });
  return clean;
}
