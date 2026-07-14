// ---------------------------------------------------------------------------
// Per-season hero photo override, for the Home/Welcome main card. Admin
// uploads a photo (Seasons tab) — stored on disk under UPLOADS_DIR/seasons/
// and the URL kept on Season.heroImageUrl. Raw-SQL column (ensureAppSchema),
// like the other season extras — the running dev server locks the generated
// Prisma client on Windows.
//
// A season without an override falls back (frontend/src/utils/heroImage.js)
// to the static /heroes/s<number>.jpg drop-in convention, then /hero.jpg —
// that convention still works for anyone with file-system access; the upload
// exists for admins who only have the website (e.g. on Railway, no SFTP).
// ---------------------------------------------------------------------------

// Reads of heroImageUrl are inlined alongside the other raw season fields
// (teamDropWorst, isPublic, ...) in routes/admin.js and routes/seasons.js —
// same one-query-per-list pattern already used there. This helper only
// covers the write side (admin upload/clear), which nothing else touches.
export async function writeSeasonHero(prisma, seasonId, url) {
  await prisma.$executeRawUnsafe(`UPDATE "Season" SET "heroImageUrl" = ? WHERE "id" = ?`, url, seasonId);
}
