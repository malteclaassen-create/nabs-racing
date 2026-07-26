// ---------------------------------------------------------------------------
// The stat tiles on the public driver profile. The driver picks which ones
// show (self-service on /profile); null (never saved) = the classic default
// set. Stored as a JSON array in Driver.profileTiles — via raw SQL, since the
// running dev server's generated Prisma client predates the column (same
// pattern as MemberAccount/PersonLink; see ensureSchema.js).
// ---------------------------------------------------------------------------

// The classic six a profile shows out of the box.
export const DEFAULT_PROFILE_TILES = ["wins", "podiums", "bestFinish", "avgFinish", "poles", "gained"];

// Everything a driver may opt into. Telemetry-based tiles (overtakes, lapsLed,
// contacts, consistency) only render when the season actually has that data.
//
// Order matters twice over: it is the canonical order a saved selection is
// stored in (routes/me.js filters the request against this list), and it must
// stay in step with PROFILE_TILES in frontend/src/pages/Profile.jsx. A key the
// editor offers but this list omits fails the whole save, not just that tile,
// so the driver loses their name and bio edits too — which is exactly what
// happened to "lapsLed".
export const PROFILE_TILE_KEYS = [
  ...DEFAULT_PROFILE_TILES,
  "top5",
  "top10",
  "pointsFinishes",
  "dnf",
  "avgGrid",
  "fastestLap",
  "overtakes",
  "lapsLed",
  "contacts",
  "consistency",
  "penalties",
];

export async function readProfileTiles(prisma, driverId) {
  try {
    const rows = await prisma.$queryRaw`SELECT "profileTiles" FROM "Driver" WHERE "id" = ${driverId}`;
    const raw = rows[0]?.profileTiles;
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((k) => PROFILE_TILE_KEYS.includes(k)) : null;
  } catch {
    return null;
  }
}
