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
// Season.carUnveilAt can name the moment the cover comes off by itself (the
// start of the briefing): from then on the car reads as unveiled at that time,
// with nobody pressing anything. "Unveil now" still works before it.
// Season.carVideoUrl is the film played after the reveal, hidden the same way.
//
// Pages that show the cover count down to carUnveilAt on the server's clock
// (serverNow) and ask GET /api/seasons/car-unveil every few seconds; the
// answer that comes back without the cover is what starts the reveal.
// ---------------------------------------------------------------------------
import { randomBytes } from "node:crypto";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";

export const COVERED = "covered";

// The car columns every read of a season's car needs.
export const CAR_COLUMNS = `"carImageUrl", "carUnveil", "carUnveilAt", "carVideoUrl"`;

const iso = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

// covered: still under the cover now. unveiledAt: when it came off.
// unveilAt: when it is set to come off by itself (only while covered).
export function carState(raw, at = null, now = Date.now()) {
  const v = raw == null ? null : String(raw);
  const planned = iso(at);
  if (v === COVERED) {
    if (planned && now >= Date.parse(planned)) return { covered: false, unveiledAt: planned, unveilAt: null };
    return { covered: true, unveiledAt: null, unveilAt: planned };
  }
  return { covered: false, unveiledAt: iso(v), unveilAt: null };
}

// The car fields of a season as the public sees them: no picture and no film
// while it is under the cover.
export function publicCar(row, now = Date.now()) {
  const s = carState(row?.carUnveil, row?.carUnveilAt, now);
  return {
    carImageUrl: s.covered ? null : row?.carImageUrl || null,
    carVideoUrl: s.covered ? null : row?.carVideoUrl || null,
    carCovered: s.covered,
    carUnveiledAt: s.unveiledAt,
    carUnveilAt: s.unveilAt,
  };
}

export async function readCarUnveil(prisma, seasonId) {
  const rows = await prisma
    .$queryRawUnsafe(`SELECT ${CAR_COLUMNS} FROM "Season" WHERE "id" = ?`, seasonId)
    .catch(() => []);
  return rows[0] || null;
}

export async function writeCarUnveilAt(prisma, seasonId, value) {
  await prisma.$executeRawUnsafe(`UPDATE "Season" SET "carUnveilAt" = ? WHERE "id" = ?`, value, seasonId);
}

export async function writeCarVideo(prisma, seasonId, url) {
  await prisma.$executeRawUnsafe(`UPDATE "Season" SET "carVideoUrl" = ? WHERE "id" = ?`, url, seasonId);
}

export async function writeCarUnveil(prisma, seasonId, value) {
  await prisma.$executeRawUnsafe(`UPDATE "Season" SET "carUnveil" = ? WHERE "id" = ?`, value, seasonId);
}

// A fresh, unguessable file name for a season's car (or its film, stem
// "carfilm"): "<id>-car-<random>.<ext>".
export function carFileName(seasonId, ext, stem = "car") {
  return `${seasonId}-${stem}-${randomBytes(8).toString("hex")}${ext}`;
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
export function renameCarFile(dir, seasonId, url, stem = "car") {
  const from = carFilePath(dir, url);
  if (!from || !existsSync(from)) return null;
  const ext = (/\.[a-z0-9]+$/i.exec(from) || [".jpg"])[0].toLowerCase();
  const name = carFileName(seasonId, ext, stem);
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
