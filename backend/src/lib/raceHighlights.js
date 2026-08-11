// ---------------------------------------------------------------------------
// The highlights video of a finished round: one pasted link per race, shown as
// a "Highlights" button on the race results.
//
// A column rather than a Setting blob because it belongs to the race the same
// way its date and its track do — and because Race.highlightsUrl travels with
// every read that already selects race columns. Raw-SQL managed
// (ensureAppSchema) like qualiMinutes/country next to it, so it stays writable
// while a dev server holds the generated Prisma client on Windows.
//
// Any http(s) link is accepted, not only YouTube: the league's cuts have also
// landed on Twitch and in a shared folder. The page decides what to do with it
// (a YouTube link plays inline, anything else opens in a new tab), so nothing
// here needs to know the platform.
// ---------------------------------------------------------------------------
import { safeUrl } from "./videoLinks.js";

// Validate an admin-pasted highlights link. Returns { ok, value } with value
// null to clear, or { error } for something that isn't a usable link.
export function parseHighlightsUrl(raw) {
  if (raw === undefined) return { ok: false };
  if (raw === null || String(raw).trim() === "") return { ok: true, value: null };
  const url = safeUrl(raw);
  if (!url) return { error: "Highlights link must be a full http(s) address" };
  return { ok: true, value: url };
}

// Map raceId -> link for the given races. Missing column (fresh checkout before
// ensureAppSchema) degrades to an empty map, i.e. no button.
export async function readRaceHighlights(prisma, raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  try {
    const ph = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "highlightsUrl" FROM "Race" WHERE "id" IN (${ph})`,
      ...ids
    );
    for (const r of rows) if (r.highlightsUrl) out.set(r.id, r.highlightsUrl);
  } catch {
    /* column missing pre-migration */
  }
  return out;
}

// Set (or clear) a round's highlights link. Raw write for the same reason.
export async function writeRaceHighlights(prisma, raceId, url) {
  await prisma.$executeRawUnsafe(`UPDATE "Race" SET "highlightsUrl" = ? WHERE "id" = ?`, url, raceId);
}
