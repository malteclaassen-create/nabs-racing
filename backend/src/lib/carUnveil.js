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
// Season.carUnveilAt is the time the pages count down to (the briefing). At
// zero nothing happens by itself: the pages say the reveal is coming, and an
// admin presents the car when the moment is right ("Unveil now").
// Season.carCoverUrl is the league's own picture of the car under its foil,
// shown while it is covered (it gives nothing away, so it is public).
// Season.carVideoUrl is the film for after the reveal. It stays hidden until
// an admin releases it (Season.carFilmAt), and then plays on every open page.
//
// Pages count down on the server's clock (serverNow) and ask
// GET /api/seasons/car-unveil every few seconds; an answer without the cover
// starts the reveal, an answer with the film released starts the film.
// ---------------------------------------------------------------------------
import { randomBytes } from "node:crypto";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";

export const COVERED = "covered";

// The car columns every read of a season's car needs.
export const CAR_COLUMNS = `"carImageUrl", "carUnveil", "carUnveilAt", "carVideoUrl", "carCoverUrl", "carFilmAt"`;

const iso = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

// covered: still under the cover. unveiledAt: when it came off.
// unveilAt: the time the pages count down to (only while covered).
export function carState(raw, at = null) {
  const v = raw == null ? null : String(raw);
  if (v === COVERED) return { covered: true, unveiledAt: null, unveilAt: iso(at) };
  return { covered: false, unveiledAt: iso(v), unveilAt: null };
}

// The car fields of a season as the public sees them: no picture while it is
// under the cover, and no film until it is released.
export function publicCar(row) {
  const s = carState(row?.carUnveil, row?.carUnveilAt);
  const filmAt = s.covered ? null : iso(row?.carFilmAt);
  return {
    carImageUrl: s.covered ? null : row?.carImageUrl || null,
    carCovered: s.covered,
    carUnveiledAt: s.unveiledAt,
    carUnveilAt: s.unveilAt,
    carCoverUrl: row?.carCoverUrl || null,
    // Whether a film is waiting, so pages keep listening for its release.
    carHasFilm: !!row?.carVideoUrl,
    carFilmAt: filmAt,
    carVideoUrl: filmAt ? row?.carVideoUrl || null : null,
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

export async function writeCarFilmAt(prisma, seasonId, value) {
  await prisma.$executeRawUnsafe(`UPDATE "Season" SET "carFilmAt" = ? WHERE "id" = ?`, value, seasonId);
}

export async function writeCarCover(prisma, seasonId, url) {
  await prisma.$executeRawUnsafe(`UPDATE "Season" SET "carCoverUrl" = ? WHERE "id" = ?`, url, seasonId);
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
