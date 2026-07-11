// ---------------------------------------------------------------------------
// Card photo framing: how a driver's profile picture sits on their rating
// card. Stored as JSON in Driver.cardPhotoPos — {"x":0-100,"y":0-100,"z":1-3}
// where x/y are the focal point in % (CSS object-position) and z the zoom.
// null = the default framing (50% / 22%, no zoom). Managed via raw SQL, since
// the running dev server's generated Prisma client predates the column (same
// pattern as Driver.profileTiles; see ensureSchema.js).
// ---------------------------------------------------------------------------

export const CARD_PHOTO_DEFAULT = { x: 50, y: 22, z: 1 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Parse a stored JSON string (or an already-parsed object) into a clean,
// clamped {x,y,z}, or null when unset/invalid — bad data can never reach the
// card as NaN/Infinity or an off-card focal point.
export function parseCardPhotoPos(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const x = Number(obj?.x);
  const y = Number(obj?.y);
  const z = Number(obj?.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return {
    x: Math.round(clamp(x, 0, 100) * 10) / 10,
    y: Math.round(clamp(y, 0, 100) * 10) / 10,
    z: Math.round(clamp(z, 1, 3) * 100) / 100,
  };
}

// The stored framing for one driver (null = default). Raw read, column-safe.
export async function readCardPhotoPos(prisma, driverId) {
  try {
    const rows = await prisma.$queryRaw`SELECT "cardPhotoPos" FROM "Driver" WHERE "id" = ${driverId}`;
    return parseCardPhotoPos(rows[0]?.cardPhotoPos);
  } catch {
    return null;
  }
}
