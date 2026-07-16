// ---------------------------------------------------------------------------
// Persisted driver-rating weights. The admin ratings panel used to be a preview
// sandbox only; this stores a chosen set of weights in the Setting table so the
// public ratings actually use them. Shape mirrors RATING_DEFAULTS in
// driverRatingsService.js (band, bands, the career window, the EXP
// formula block, and the rtg/pac/rac/aha weight groups). Values are sanitised
// to plain numbers with hard caps; curves/tables to bounded numeric arrays.
// ---------------------------------------------------------------------------
const RATING_WEIGHTS_KEY = "rating_weights";

const clampNum = (v, lo, hi) => {
  if (v === "" || v == null) return null; // blank admin field = "not set", not 0
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

  // Optional per-stat floor/ceiling overrides; a stat without values simply
  // inherits the shared band above (see resolveConfig).
  const bands = {};
  for (const k of ["exp", "pac", "rac", "aha"]) {
    const b = {};
    const l = clampNum(input.bands?.[k]?.low, 0, 99);
    const h = clampNum(input.bands?.[k]?.high, 0, 99);
    if (l != null) b.low = l;
    if (h != null) b.high = h;
    if (Object.keys(b).length) bands[k] = b;
  }
  if (Object.keys(bands).length) out.bands = bands;

  // Career window: size + recency curve (percent, newest season first).
  const window = {};
  const winSeasons = clampNum(input.window?.seasons, 1, 20);
  if (winSeasons != null) window.seasons = Math.round(winSeasons);
  const recency = sanitizeCurve(input.window?.recency, 20);
  if (recency) window.recency = recency;
  if (Object.keys(window).length) out.window = window;

  // EXP formula block.
  const exp = {};
  const expWeights = sanitizeGroup(input.exp?.weights, ["starts", "championship", "finishing", "activity"]);
  if (expWeights) exp.weights = expWeights;
  const fullStarts = clampNum(input.exp?.fullStarts, 1, 500);
  if (fullStarts != null) exp.fullStarts = Math.round(fullStarts);
  const finishThreshold = clampNum(input.exp?.finishThreshold, 0, 100);
  if (finishThreshold != null) exp.finishThreshold = finishThreshold;
  // Progression-curve exponent (1 = linear); same bounds as resolveConfig.
  const progression = clampNum(input.exp?.progression, 0.1, 3);
  if (progression != null) exp.progression = progression;
  const split = sanitizeGroup(input.exp?.split, ["drivers", "constructors"]);
  if (split) exp.split = split;
  const driverCurve = sanitizeCurve(input.exp?.driverCurve, 40);
  if (driverCurve) exp.driverCurve = driverCurve;
  const constructors = {};
  const preTier = sanitizeCurve(input.exp?.constructors?.preTier, 40);
  if (preTier) constructors.preTier = preTier;
  const tier1 = sanitizeTierTables(input.exp?.constructors?.tier1);
  if (tier1) constructors.tier1 = tier1;
  const tier2 = sanitizeTierTables(input.exp?.constructors?.tier2);
  if (tier2) constructors.tier2 = tier2;
  if (Object.keys(constructors).length) exp.constructors = constructors;
  if (Object.keys(exp).length) out.exp = exp;

  const rtg = sanitizeGroup(input.rtg, ["rac", "pac", "aha", "exp"]);
  const pac = sanitizeGroup(input.pac, ["quali", "bestLap", "consistency", "poleGap"]);
  const rac = sanitizeGroup(input.rac, ["finish", "gained", "overtakes", "podium"]);
  const aha = sanitizeGroup(input.aha, ["finishRate", "dnf", "consistency", "contacts", "env", "penalties", "cuts"]);
  if (rtg) out.rtg = rtg;
  if (pac) out.pac = pac;
  if (rac) out.rac = rac;
  if (aha) out.aha = aha;

  return Object.keys(out).length ? out : null;
}

// A percent curve: bounded numeric array (0..100 each), capped in length.
// Returns undefined when nothing usable was sent.
function sanitizeCurve(input, maxLen) {
  if (!Array.isArray(input)) return undefined;
  const clean = input
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .map((v) => Math.max(0, Math.min(100, v)))
    .slice(0, maxLen);
  return clean.length ? clean : undefined;
}

// Constructor tables per team count: [{ teams, values }], both bounded.
function sanitizeTierTables(input) {
  if (!Array.isArray(input)) return undefined;
  const clean = input
    .map((t) => {
      const teams = clampNum(t?.teams, 2, 30);
      const values = sanitizeCurve(t?.values, 30);
      return teams != null && values ? { teams: Math.round(teams), values } : null;
    })
    .filter(Boolean)
    .slice(0, 10);
  return clean.length ? clean : undefined;
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
