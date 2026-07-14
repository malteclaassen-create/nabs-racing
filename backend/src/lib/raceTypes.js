// ---------------------------------------------------------------------------
// Race types. CHAMPIONSHIP = a scored round with a number; TRAINING = a
// practice session (not scored, no round number, but RSVP works for session
// planning); SPECIAL = a special event. The old isSpecialEvent flag lives on
// as a DERIVED column (true for every non-CHAMPIONSHIP type) because all
// scoring/round-numbering reads filter on it — keeping it in sync means a
// training race can never leak into standings by accident.
//
// The `type` column is raw-SQL managed (ensureAppSchema) like the session
// format columns, so it stays writable while the dev server holds the
// generated Prisma client.
// ---------------------------------------------------------------------------

export const RACE_TYPES = ["CHAMPIONSHIP", "TRAINING", "SPECIAL"];

// Map raceId -> type for the given races. Missing column (fresh checkout
// before ensureAppSchema) degrades to the isSpecialEvent-derived defaults the
// callers already handle.
export async function readRaceTypes(prisma, raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const ph = ids.map(() => "?").join(",");
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "type", "isSpecialEvent" FROM "Race" WHERE "id" IN (${ph})`,
      ...ids
    );
    for (const r of rows) {
      const t = RACE_TYPES.includes(r.type) ? r.type : Number(r.isSpecialEvent) ? "SPECIAL" : "CHAMPIONSHIP";
      out.set(r.id, t);
    }
  } catch {
    /* column missing pre-migration — callers fall back to isSpecialEvent */
  }
  return out;
}

// Set a race's type; isSpecialEvent follows as the derived flag. Returns the
// stored type.
export async function writeRaceType(prisma, raceId, type) {
  const t = RACE_TYPES.includes(type) ? type : "CHAMPIONSHIP";
  await prisma.$executeRawUnsafe(
    `UPDATE "Race" SET "type" = ?, "isSpecialEvent" = ? WHERE "id" = ?`,
    t,
    t === "CHAMPIONSHIP" ? 0 : 1,
    raceId
  );
  return t;
}
