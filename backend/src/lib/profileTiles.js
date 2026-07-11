// ---------------------------------------------------------------------------
// The stat tiles on the public driver profile. The driver picks which ones
// show (self-service on /profile); null (never saved) = the classic default
// set. Stored as a JSON array in Driver.profileTiles — via raw SQL, since the
// running dev server's generated Prisma client predates the column (same
// pattern as MemberAccount/PersonLink; see ensureSchema.js).
// ---------------------------------------------------------------------------

// The classic six a profile shows out of the box.
export const DEFAULT_PROFILE_TILES = ["wins", "podiums", "bestFinish", "avgFinish", "poles", "gained"];

// Everything a driver may opt into. Telemetry-based tiles (overtakes, contacts,
// consistency) only render when the season actually has that data.
export const PROFILE_TILE_KEYS = [
  ...DEFAULT_PROFILE_TILES,
  "top5",
  "top10",
  "pointsFinishes",
  "dnf",
  "avgGrid",
  "fastestLap",
  "overtakes",
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
