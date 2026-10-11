// ---------------------------------------------------------------------------
// The home screen widget's driver picture (me.avatar in GET /api/widget).
//
// It is the picture the driver card on the website wears (lib/cardPhoto.js:
// the row's card picture, the person's, then the profile photo, then the
// Discord avatar — and, like the card, the next one when a picture will not
// load). The card draws it under a tinted overlay; this is the picture itself.
//
// Served through its own small route (GET /api/widget/avatar/:driverId)
// rather than as the stored URL, because the stored file is whatever was
// uploaded: often a phone photo several thousand pixels across, sometimes
// landscape. A home screen widget has a tight memory budget and a portrait or
// square slot, so it gets a JPEG at most AVATAR_MAX across, a landscape
// picture cut square around the point the card is framed on.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { UPLOADS_DIR } from "./dataDirs.js";
import { safeUploadPath } from "./safeUpload.js";
import { parseCardPhotoPos, pictureChainFor, cardPictureFor } from "./cardPhoto.js";
import { getIdentityOverrides } from "./persons.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";

export const AVATAR_MAX = 600;

// Where a stored picture URL can be read from: an upload on this server, or
// Discord's CDN (an avatar copied at login). Anything else is not fetched.
const LOCAL = /^\/api\/uploads\/(avatars|cards)\/([^/?#]+)/;
const DISCORD = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//;

export function pictureSource(url) {
  const local = LOCAL.exec(String(url || ""));
  if (local) {
    const path = safeUploadPath(join(UPLOADS_DIR, local[1]), local[2]);
    return path && existsSync(path) ? { kind: "file", path, url } : null;
  }
  return DISCORD.test(String(url || "")) ? { kind: "discord", url } : null;
}

// The card's pictures for one driver row, best first, that can be read at
// all; plus the card's framing. null when the row does not exist or belongs
// to a season the public may not see.
export async function cardPictures(prisma, driverId) {
  const rows = await prisma.$queryRaw`
    SELECT "seasonId","photoUrl","discordAvatar","cardPhotoUrl","cardPhotoPos" FROM "Driver" WHERE "id" = ${driverId}`.catch(
    () => []
  );
  const d = rows[0];
  if (!d) return null;
  if (d.seasonId && (await getPrivateSeasonIds(prisma)).has(d.seasonId)) return null;
  const idov = (await getIdentityOverrides(prisma)).get(driverId);
  const own = {
    cardPhotoUrl: d.cardPhotoUrl || null,
    photoUrl: d.photoUrl || null,
    discordAvatar: d.discordAvatar || null,
    photoPos: parseCardPhotoPos(d.cardPhotoPos),
  };
  return {
    sources: pictureChainFor(own, idov, { card: true }).map(pictureSource).filter(Boolean),
    focusX: cardPictureFor(own, idov).photoPos?.x ?? 50,
  };
}

// me.avatar: the picture's absolute address, or null when the card has none.
// The version names the picture and its framing, so a new upload is a new URL
// and the old one can be cached for a long time.
export async function avatarUrlFor(prisma, driverId, origin) {
  const pics = await cardPictures(prisma, driverId);
  if (!pics?.sources.length) return null;
  const v = createHash("sha1").update(`${pics.sources[0].url}|${pics.focusX}`).digest("hex").slice(0, 10);
  return `${origin}/api/widget/avatar/${encodeURIComponent(driverId)}?v=${v}`;
}

async function readSource(src) {
  if (src.kind === "file") return readFileSync(src.path);
  // Discord sizes on request; an animated avatar comes as its still frame.
  const u = new URL(src.url);
  u.pathname = u.pathname.replace(/\.gif$/i, ".png");
  u.searchParams.set("size", "512");
  const res = await fetch(u, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length <= 8 * 1024 * 1024 ? buf : null;
}

let canvasLib = null;
const canvasModule = async () => (canvasLib ||= await import("@napi-rs/canvas"));

// The crop and size: landscape is cut square around focusX (percent, the
// card's horizontal framing), square and portrait stay whole; the longer side
// then comes down to AVATAR_MAX. Never scaled up.
export function avatarBox(width, height, focusX = 50) {
  let sx = 0;
  let sw = width;
  if (width > height) {
    sw = height;
    sx = Math.round(Math.min(width - sw, Math.max(0, (width * focusX) / 100 - sw / 2)));
  }
  const scale = Math.min(1, AVATAR_MAX / Math.max(sw, height));
  return { sx, sy: 0, sw, sh: height, w: Math.max(1, Math.round(sw * scale)), h: Math.max(1, Math.round(height * scale)) };
}

async function render(buffer, focusX) {
  const { loadImage, createCanvas } = await canvasModule();
  const img = await loadImage(buffer);
  const b = avatarBox(img.width, img.height, focusX);
  const canvas = createCanvas(b.w, b.h);
  const ctx = canvas.getContext("2d");
  // JPEG has no transparency: a cut-out picture sits on the card's dark.
  ctx.fillStyle = "#15151e";
  ctx.fillRect(0, 0, b.w, b.h);
  ctx.drawImage(img, b.sx, b.sy, b.sw, b.sh, 0, 0, b.w, b.h);
  return canvas.encode("jpeg", 85);
}

// A handful of finished pictures kept in memory: the same few drivers ask
// again every time iOS refreshes their widget.
const cache = new Map();
const CACHE_SIZE = 64;

// The JPEG for a driver row, or null when the card has no picture that loads.
export async function avatarImage(prisma, driverId) {
  const pics = await cardPictures(prisma, driverId);
  if (!pics) return null;
  for (const src of pics.sources) {
    const key = `${src.url}|${pics.focusX}`;
    if (cache.has(key)) return cache.get(key);
    try {
      const buffer = await readSource(src);
      if (!buffer) continue;
      const jpeg = await render(buffer, pics.focusX);
      cache.set(key, jpeg);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
      return jpeg;
    } catch {
      // A dead or unreadable picture: the card would try the next one too.
    }
  }
  return null;
}
