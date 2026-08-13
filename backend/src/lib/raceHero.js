// ---------------------------------------------------------------------------
// The main-card photo of ONE round. The Home hero is about the latest race —
// its track name, its podium — so the picture behind it can be of that place
// rather than the season's one photo for all twelve rounds. Upload one for
// Hockenheim and the hero wears it while Hockenheim is the latest round; once
// the next round's results land the hero moves on to that round's photo, or
// back to the season photo if it hasn't got one.
//
// A Race column rather than a Setting blob, because it belongs to the round the
// way its date and its track do, and it travels with every read that already
// selects race columns. Raw-SQL managed (ensureAppSchema) like highlightsUrl
// and qualiMinutes next to it, so it stays writable while a dev server holds
// the generated Prisma client on Windows.
//
// The file itself lands in UPLOADS_DIR/races/ next to the round's gallery
// photos (routes/admin.js), so a host without file-system access can still put
// a picture there — the same reason the season photo is an upload.
// ---------------------------------------------------------------------------

// Map raceId -> photo URL for the given races. A missing column (fresh
// checkout before ensureAppSchema) degrades to an empty map, i.e. every hero
// falls back to the season photo — which is what the site did before.
export async function readRaceHeroes(prisma, raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  try {
    const ph = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "heroImageUrl" FROM "Race" WHERE "id" IN (${ph})`,
      ...ids
    );
    for (const r of rows) if (r.heroImageUrl) out.set(r.id, r.heroImageUrl);
  } catch {
    /* column missing pre-migration */
  }
  return out;
}

// Set (or clear, with null) a round's photo. Raw write for the same reason.
export async function writeRaceHero(prisma, raceId, url) {
  await prisma.$executeRawUnsafe(`UPDATE "Race" SET "heroImageUrl" = ? WHERE "id" = ?`, url, raceId);
}
