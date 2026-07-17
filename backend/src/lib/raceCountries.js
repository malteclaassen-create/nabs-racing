// ---------------------------------------------------------------------------
// Per-race country (ISO 3166-1 alpha-2, lowercase) for the track flag. Stored
// on Race.country — the ONE source of truth the flag icons derive from. The
// static circuit table (trackKeys.js) only serves as the boot-time backfill
// and the fallback for rows created before the column existed; the admin
// Tracks tab edits the code per circuit, which fans out to every race of that
// circuit across all seasons.
//
// The column is raw-SQL managed (ensureAppSchema) like Race.type, so it stays
// writable while the dev server holds the generated Prisma client on Windows.
// ---------------------------------------------------------------------------
import { groupKeyFor, countryFor } from "./trackKeys.js";

// Tracks WITHOUT a drawn circuit outline (so they're absent from the static
// CIRCUITS table) whose country is still known. Seeds the boot backfill.
export const EXTRA_TRACK_COUNTRIES = {
  donington: "gb",
  donnington: "gb", // the S1 archive stores it with a double n
  doningtonpark: "gb",
};

export const isCountryCode = (c) => typeof c === "string" && /^[a-z]{2}$/.test(c);

// English country name for a code ("fr" -> "France"), for search matching and
// labels. Falls back to the upper-cased code if ICU data is missing.
const REGION_NAMES = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

export function countryNameOf(code) {
  if (!isCountryCode(code)) return "";
  try {
    return REGION_NAMES?.of(code.toUpperCase()) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

// Best static guess for a raw track string (outline table first, then the
// outline-less extras). null when unknown — the admin fills those in.
export function staticCountryFor(track) {
  return countryFor(track) || EXTRA_TRACK_COUNTRIES[groupKeyFor(track)] || null;
}

// Map raceId -> stored country for the given races. Missing column (fresh
// checkout before ensureAppSchema) degrades to an empty map; callers fall back
// to staticCountryFor.
export async function readRaceCountries(prisma, raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const ph = ids.map(() => "?").join(",");
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "country" FROM "Race" WHERE "id" IN (${ph})`,
      ...ids
    );
    for (const r of rows) if (isCountryCode(r.country)) out.set(r.id, r.country);
  } catch {
    /* column missing pre-migration */
  }
  return out;
}

// Distinct trackKey -> country across ALL races (any season) where a country is
// stored. Feeds the public /api/tracks/countries endpoint the frontend loads
// once so flags outside race payloads (search, admin) resolve too.
export async function readTrackCountries(prisma) {
  const out = {};
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "track", "country" FROM "Race" WHERE "country" IS NOT NULL`
    );
    for (const r of rows) if (isCountryCode(r.country)) out[groupKeyFor(r.track)] = r.country;
  } catch {
    /* column missing pre-migration */
  }
  return out;
}

// Stamp a freshly created race's country: an admin-set code on any existing
// race of the same circuit wins, else the static table. Raw SQL because the
// generated client may not know the column yet. No-op when unknown.
export async function seedRaceCountry(prisma, raceId, track) {
  try {
    const overrides = await readTrackCountries(prisma);
    const code = overrides[groupKeyFor(track)] || staticCountryFor(track) || null;
    // Always write (also on a track RENAME, where the old circuit's flag must
    // not linger) — null when the circuit is unknown, for the admin to fill in.
    await prisma.$executeRawUnsafe(`UPDATE "Race" SET "country" = ? WHERE "id" = ?`, code, raceId);
  } catch {
    /* column missing pre-migration */
  }
}

// Set (or clear, country=null) the country of every race run at the given
// circuit, across all seasons — one edit fixes e.g. Donington everywhere.
// Returns how many races were touched.
export async function writeTrackCountry(prisma, key, country) {
  const code = country == null || country === "" ? null : String(country).toLowerCase();
  if (code !== null && !isCountryCode(code)) throw new Error("country must be a two-letter ISO code");
  const races = await prisma.$queryRawUnsafe(`SELECT "id", "track" FROM "Race"`);
  const ids = races.filter((r) => groupKeyFor(r.track) === key).map((r) => r.id);
  if (!ids.length) return 0;
  const ph = ids.map(() => "?").join(",");
  await prisma.$executeRawUnsafe(
    `UPDATE "Race" SET "country" = ? WHERE "id" IN (${ph})`,
    code,
    ...ids
  );
  return ids.length;
}
