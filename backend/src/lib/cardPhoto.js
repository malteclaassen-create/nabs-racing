// ---------------------------------------------------------------------------
// Card photo framing: how a driver's picture sits on their rating card. Stored
// as JSON in Driver.cardPhotoPos — {"x":0-100,"y":0-100,"z":1-3,"s":0-1,"t":0-1}
// where x/y are the focal point in % (CSS object-position), z the zoom, s the
// saturation (1 = full colour) and t the tint: how strongly the photo takes on
// the card edition's OWN colour (0 = untinted, 1 = a full duotone in the card
// colour), so the picture harmonises with the card instead of clashing with it.
// null = the default framing.
// Managed via raw SQL, since the running dev server's generated Prisma client
// predates the column (same pattern as Driver.profileTiles; see ensureSchema.js).
// ---------------------------------------------------------------------------

export const CARD_PHOTO_DEFAULT = { x: 50, y: 22, z: 1, s: 1, t: 0 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Parse a stored JSON string (or an already-parsed object) into a clean,
// clamped {x,y,z,s}, or null when unset/invalid — bad data can never reach the
// card as NaN/Infinity or an off-card focal point. `s` is optional (older
// stored values have none): missing/invalid falls back to 1 (full colour).
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
  const sRaw = Number(obj?.s);
  const s = Number.isFinite(sRaw) ? clamp(sRaw, 0, 1) : 1;
  const tRaw = Number(obj?.t);
  const t = Number.isFinite(tRaw) ? clamp(tRaw, 0, 1) : 0;
  return {
    x: Math.round(clamp(x, 0, 100) * 10) / 10,
    y: Math.round(clamp(y, 0, 100) * 10) / 10,
    z: Math.round(clamp(z, 1, 3) * 100) / 100,
    s: Math.round(s * 100) / 100,
    t: Math.round(t * 100) / 100,
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
