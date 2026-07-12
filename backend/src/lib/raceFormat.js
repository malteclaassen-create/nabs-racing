// Per-race session format (qualifying minutes / race laps) for announcements
// and the site's upcoming-race panels. The columns live outside the generated
// Prisma client (added by ensureAppSchema, raw SQL), so reads go through here.

// Map raceId -> { qualiMinutes, raceLaps } for the given ids. Returns an empty
// map when the columns don't exist yet (fresh checkout before ensureAppSchema).
export async function readRaceFormat(prisma, raceIds) {
  const ids = [...new Set(raceIds)].filter(Boolean);
  if (!ids.length) return new Map();
  try {
    const qs = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "qualiMinutes", "raceLaps" FROM "Race" WHERE "id" IN (${qs})`,
      ...ids
    );
    return new Map(
      rows.map((r) => [
        r.id,
        {
          qualiMinutes: r.qualiMinutes == null ? null : Number(r.qualiMinutes),
          raceLaps: r.raceLaps == null ? null : Number(r.raceLaps),
        },
      ])
    );
  } catch {
    return new Map();
  }
}

// Validate an admin-supplied format value: a positive whole number up to
// `max`, or null/"" to clear. Returns { ok, value } or { error }.
export function parseFormatNumber(raw, label, max) {
  if (raw === undefined) return { ok: false };
  if (raw === null || raw === "") return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    return { error: `${label} must be a whole number between 1 and ${max}` };
  }
  return { ok: true, value: n };
}
