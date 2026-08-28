// ---------------------------------------------------------------------------
// The hotlap videos of ONE event: the laps shown under that event's sign-up.
//
// The circuit already carries laps of its own (lib/trackInfo.js), and those are
// the right thing most of the time — a lap of Monza is a lap of Monza whichever
// season is racing it. But a track can host two events in the same season with
// two different cars (a training session next to the championship round), and
// then one lap per circuit is the wrong unit: the training car's lap has
// nothing to say about the round, and the other way round. So an event may
// carry its own list, and when it does, that list is what its sign-up shows —
// the circuit's laps stay put for every event that has none.
//
// A column rather than a Setting blob, for the same reason as highlightsUrl
// next door: it belongs to the race like its date and its track do, and it
// travels with the reads that already select race columns. Raw-SQL managed
// (ensureAppSchema) so it stays writable while a dev server holds the generated
// Prisma client on Windows.
// ---------------------------------------------------------------------------
import { sanitizeVideoList } from "./videoLinks.js";

// Same ceiling as the circuit's list: a handful is plenty, and the player is a
// picker either way.
const MAX_VIDEOS = 6;
const MAX_TITLE = 80;

export function sanitizeRaceHotlaps(videos) {
  return sanitizeVideoList(videos, { max: MAX_VIDEOS, maxTitle: MAX_TITLE });
}

// Map raceId -> videos[] for the given races, entries only for races that have
// any. Missing column (fresh checkout before ensureAppSchema) or a corrupt blob
// degrades to "no own laps", i.e. the circuit's list is used.
export async function readRaceHotlaps(prisma, raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  try {
    const ph = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "hotlapVideos" FROM "Race" WHERE "id" IN (${ph}) AND "hotlapVideos" IS NOT NULL`,
      ...ids
    );
    for (const r of rows) {
      let parsed;
      try {
        parsed = JSON.parse(r.hotlapVideos);
      } catch {
        continue; // one corrupt blob must not cost the whole feed
      }
      const clean = sanitizeRaceHotlaps(parsed);
      if (clean.length) out.set(r.id, clean);
    }
  } catch {
    /* column missing pre-migration */
  }
  return out;
}

// Set (or clear) one event's own laps. An empty list clears the column rather
// than storing "[]", so "this event has nothing of its own" is one state and
// not two — that is exactly the state that falls back to the circuit.
export async function writeRaceHotlaps(prisma, raceId, videos) {
  const clean = sanitizeRaceHotlaps(videos);
  await prisma.$executeRawUnsafe(
    `UPDATE "Race" SET "hotlapVideos" = ? WHERE "id" = ?`,
    clean.length ? JSON.stringify(clean) : null,
    raceId
  );
  return clean;
}
