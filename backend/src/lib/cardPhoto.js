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

// The pictures one driver row can show, best first.
//
// `own` = { cardPhotoUrl, photoUrl, discordAvatar, photoPos } of the row
// itself; `idov` = the person's identity override (lib/persons.js), or
// undefined when the row isn't linked to anybody. `card` includes the
// card-only pictures, which belong on a rating card but never on the round
// profile avatar.
//
// The order says what a picture is worth. An UPLOAD is a choice somebody made
// for that row, so the row's own uploads come first, then the person's from
// their other rows. A DISCORD AVATAR is neither: it is copied from Discord at
// login and its URL dies as soon as the member changes their picture there,
// leaving whichever rows logged in earlier pointing at nothing. So an avatar
// ranks last on both sides, and the PERSON's newest one — the row that logged
// in most recently, the only one still resolving — beats the row's own.
// The framing always travels with the picture it was set for.
function rankedPictures(own, idov, { card }) {
  const { cardPhotoUrl = null, photoUrl = null, discordAvatar = null, photoPos = null } = own || {};
  const out = [];
  if (card && cardPhotoUrl) out.push({ url: cardPhotoUrl, pos: photoPos, own: true });
  if (photoUrl) out.push({ url: photoUrl, pos: photoPos, own: true });
  if (card && idov?.cardPhotoUrl) out.push({ url: idov.cardPhotoUrl, pos: parseCardPhotoPos(idov.cardPhotoPos) });
  if (idov?.photoUrl) out.push({ url: idov.photoUrl, pos: parseCardPhotoPos(idov.photoPos) });
  if (idov?.avatarUrl) out.push({ url: idov.avatarUrl, pos: parseCardPhotoPos(idov.avatarPos) });
  if (discordAvatar) out.push({ url: discordAvatar, pos: photoPos, own: true });
  return out;
}

// The round profile picture for one row: the best non-card picture, or null.
// Takes and returns exactly what the old `row.photoUrl || row.discordAvatar ||
// idov?.photoUrl` did, minus the stale-avatar trap.
export function personPhotoFor(own, idov) {
  return rankedPictures(own, idov, { card: false })[0]?.url || null;
}

// Which picture a rating card shows for one driver row, and how it sits:
// { cardPhotoUrl, photoPos }. RatingCard renders `cardPhotoUrl || photoUrl`,
// so the winner is handed over as cardPhotoUrl whatever it came from, and the
// framing belongs to the row that picture was set on.
export function cardPictureFor(own, idov) {
  const best = rankedPictures(own, idov, { card: true })[0];
  if (!best) return { cardPhotoUrl: null, photoPos: own?.photoPos ?? null };
  return { cardPhotoUrl: best.url, photoPos: best.pos ?? null };
}
