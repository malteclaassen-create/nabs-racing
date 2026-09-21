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
// `own` = { cardPhotoUrl, photoUrl, discordAvatar } of the row itself; `idov`
// = the person's identity override (lib/persons.js), or undefined when the row
// isn't linked to anybody. `card` includes the card-only pictures, which
// belong on a rating card but never on the round profile avatar.
//
// The order says what a picture is worth.
//
// On a CARD, the row's own card picture comes first — that is somebody having
// dressed this season on purpose. Then the person's card picture, i.e. what
// their current card wears: a season nobody dressed follows it, which is the
// whole point. Only then the profile photo, the row's own before the person's,
// because a profile photo is not a card choice at all — it is what a card
// falls back to when no card picture exists anywhere.
//
// A DISCORD AVATAR is not a choice either: it is copied from Discord at login
// and its URL dies as soon as the member changes their picture there, leaving
// whichever rows logged in earlier pointing at nothing. So an avatar ranks
// last on both sides, and the PERSON's newest one — the row that logged in
// most recently, the only one still resolving — beats the row's own.
function rankedPictures(own, idov, { card }) {
  const { cardPhotoUrl = null, photoUrl = null, discordAvatar = null } = own || {};
  const out = [];
  if (card && cardPhotoUrl) out.push(cardPhotoUrl);
  if (card && idov?.cardPhotoUrl) out.push(idov.cardPhotoUrl);
  if (photoUrl) out.push(photoUrl);
  if (idov?.photoUrl) out.push(idov.photoUrl);
  if (idov?.avatarUrl) out.push(idov.avatarUrl);
  if (discordAvatar) out.push(discordAvatar);
  return out;
}

// Every picture this row could show, best first and without repeats.
//
// The ranking is a guess about which URL still resolves, and a guess can be
// wrong: a Discord avatar dies silently, and the row that LOOKS newest (the
// highest season number) is not always the one that logged in last — a season
// that has not started yet ranks last on purpose, and season numbers of two
// different leagues are not really comparable at all. So the browser gets the
// whole chain instead of one URL and walks it as pictures fail to load, which
// is the only test that actually settles the question.
export function pictureChainFor(own, idov, { card = true } = {}) {
  const seen = new Set();
  const out = [];
  for (const url of rankedPictures(own, idov, { card })) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

// The pictures after the one being shown — what an <img> should try next when
// its src turns out to be dead. Empty when there is nothing left to try.
export function photoFallbacksFor(own, idov, opts) {
  return pictureChainFor(own, idov, opts).slice(1);
}

// The round profile picture for one row: the best non-card picture, or null.
export function personPhotoFor(own, idov) {
  return rankedPictures(own, idov, { card: false })[0] || null;
}

// How the picture sits on one row's card, and which picture that is:
// { cardPhotoUrl, photoPos }. RatingCard renders `cardPhotoUrl || photoUrl`,
// so the winning picture is handed over as cardPhotoUrl whatever it came from.
//
// Both halves follow the same rule, and it is the one the league asked for: a
// card the member has actually SET keeps what they set, for good. A card they
// never touched follows the person's newest — so changing this season's card
// carries through to every season still on the default, and leaves every
// season somebody deliberately dressed alone. Clearing a row's own picture or
// framing (the editor's reset buttons) hands it back to that inheritance.
//
// Picture and framing are tracked apart, because a member can pin one without
// the other: framing this season's card must not freeze its picture too.
export function cardPictureFor(own, idov) {
  const chain = rankedPictures(own, idov, { card: true });
  return {
    cardPhotoUrl: chain[0] || null,
    photoPos: own?.photoPos || parseCardPhotoPos(idov?.framingPos) || null,
  };
}
