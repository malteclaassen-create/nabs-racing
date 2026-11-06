// ---------------------------------------------------------------------------
// The season car under a cover, unveiled live (during the briefing).
//
// Season.carUnveil holds one of three things:
//   null        the car shows as it always did, the moment it is uploaded
//   "covered"   the car is uploaded but stays under a cover: the site hands
//               out no picture, only the fact that there is a car under it
//   an ISO time the car was unveiled at that moment
//
// While it is covered the picture's address goes to nobody, not even through
// the teaser or the page's link preview. The file on disk carries a random
// name (see renameCarFile), so it cannot be guessed from the season's id
// either. The admin list still has the address, for the preview.
//
// Pages that show the cover ask GET /api/seasons/car-unveil every few seconds;
// the answer that comes back without the cover is what starts the reveal.
// ---------------------------------------------------------------------------
import { randomBytes } from "node:crypto";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";

export const COVERED = "covered";

export function carState(raw) {
  const v = raw == null ? null : String(raw);
  if (v === COVERED) return { covered: true, unveiledAt: null };
  if (v && !Number.isNaN(Date.parse(v))) return { covered: false, unveiledAt: new Date(v).toISOString() };
  return { covered: false, unveiledAt: null };
}

// The car fields of a season as the public sees them: no picture while it is
// under the cover.
export function publicCar(carImageUrl, carUnveil) {
  const { covered, unveiledAt } = carState(carUnveil);
  return {
    carImageUrl: covered ? null : carImageUrl || null,
    carCovered: covered,
    carUnveiledAt: unveiledAt,
  };
}

export async function readCarUnveil(prisma, seasonId) {
  const rows = await prisma
    .$queryRawUnsafe(`SELECT "carImageUrl", "carUnveil" FROM "Season" WHERE "id" = ?`, seasonId)
    .catch(() => []);
  return rows[0] || null;
}

export async function writeCarUnveil(prisma, seasonId, value) {
  await prisma.$executeRawUnsafe(`UPDATE "Season" SET "carUnveil" = ? WHERE "id" = ?`, value, seasonId);
}

// A fresh, unguessable file name for a season's car: "<id>-car-<random>.<ext>".
export function carFileName(seasonId, ext) {
  return `${seasonId}-car-${randomBytes(8).toString("hex")}${ext}`;
}

// The uploaded file behind a car address, if it is one of ours.
export function carFilePath(dir, url) {
  const m = /^\/api\/uploads\/seasons\/([^/?#]+)/.exec(String(url || ""));
  if (!m) return null;
  const name = basename(decodeURIComponent(m[1]));
  return name ? join(dir, name) : null;
}

// Gives an uploaded car a new random name and returns its new address. Used
// when the cover goes on: an address that was handed out before is dead
// afterwards. Returns null when there is no uploaded file to move.
export function renameCarFile(dir, seasonId, url) {
  const from = carFilePath(dir, url);
  if (!from || !existsSync(from)) return null;
  const ext = (/\.[a-z0-9]+$/i.exec(from) || [".jpg"])[0].toLowerCase();
  const name = carFileName(seasonId, ext);
  renameSync(from, join(dir, name));
  return `/api/uploads/seasons/${name}?v=${Date.now()}`;
}

// Removes a replaced upload, so the old picture does not stay reachable.
export function removeCarFile(dir, url) {
  const p = carFilePath(dir, url);
  try {
    if (p && existsSync(p)) unlinkSync(p);
  } catch {
    // Not worth failing an upload over.
  }
}
