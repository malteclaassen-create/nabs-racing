// ---------------------------------------------------------------------------
// Manual race honours for archive rounds (admin Results tab, "Race honours").
// The early seasons carry no AC data, so "who took pole / the fastest lap" can
// be recorded by hand:
//   * pole        -> stored as RaceResult.grid = 1 (no extra column). Every
//                    consumer resolves poles through readPoleHolders below,
//                    which lets an imported qualifying session win over the
//                    grid — so this hand-recorded grid slot only counts for a
//                    round WITHOUT a quali on file,
//   * fastest lap -> the RaceResult.fastestLap flag (raw-SQL column, see
//                    ensureAppSchema), plus the real bestLapMs when the lap
//                    time is known (that also feeds the track records).
// Every reader that DERIVES the fastest lap from bestLapMs must let the flag
// win; this helper is their single source for the recorded holders. Raw SQL
// like lib/telemetryRead.js, tolerant of a database from before the column.
// ---------------------------------------------------------------------------

// Map<raceId, driverId> of every admin-recorded fastest-lap holder, optionally
// restricted to a set of races. At most one flagged row exists per race (the
// write path clears the race's flags before setting one).
export async function readManualFastestLaps(prisma, raceIds = null) {
  try {
    let rows;
    if (raceIds) {
      const ids = [...raceIds];
      if (!ids.length) return new Map();
      const placeholders = ids.map(() => "?").join(",");
      rows = await prisma.$queryRawUnsafe(
        `SELECT "raceId", "driverId" FROM "RaceResult" WHERE "fastestLap" = 1 AND "raceId" IN (${placeholders})`,
        ...ids
      );
    } else {
      rows = await prisma.$queryRawUnsafe(
        `SELECT "raceId", "driverId" FROM "RaceResult" WHERE "fastestLap" = 1`
      );
    }
    return new Map(rows.map((r) => [r.raceId, r.driverId]));
  } catch {
    // Column missing (database from before the migration): nothing recorded.
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// WHO TOOK POLE. Two sources, in this order:
//   1. the imported qualifying session (Race.qualiJson): the entrant classified
//      first with a real lap. This is THE pole — a reverse-grid feature race
//      still has one car in grid slot 1, and that car did not qualify there.
//   2. failing a quali on file, the grid: the result row with grid = 1, which
//      is also how the admin records a pole by hand (Race honours).
// A race WITH a quali whose fastest entrant never matched a roster driver has
// no pole on record rather than a fallback to the grid, because the grid of
// such a round is exactly the number that was wrong.
// ---------------------------------------------------------------------------

// The pole sitter of a parsed quali blob: the driver id of the fastest
// classified entrant, or null when the fastest entrant is unmatched / nobody
// set a lap. Pure, exported for the test.
export function poleFromQuali(blob) {
  const entries = Array.isArray(blob?.entries) ? blob.entries : [];
  const timed = entries.filter((e) => e && e.bestLapMs != null && e.bestLapMs > 0 && e.bestLapMs <= 1_800_000);
  if (!timed.length) return null;
  // Rank by position (the parser's own order), then by lap — a blob written
  // before positions existed still resolves the same way.
  timed.sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.bestLapMs - b.bestLapMs);
  return timed[0].driverId || null;
}

const CHUNK = 400; // keep IN (...) lists well under SQLite's bind limit

// Map<raceId, driverId> of the pole sitter of each given race (rounds without
// one on record are simply absent). Quali-derived where a session is on file,
// grid-1 otherwise; see the header above.
export async function readPoleHolders(prisma, raceIds) {
  const ids = [...new Set([...(raceIds || [])].filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;

  // 1. Qualifying sessions on file. Column missing (pre-migration): none.
  const withQuali = new Set();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    let rows = [];
    try {
      rows = await prisma.$queryRawUnsafe(
        `SELECT "id", "qualiJson" FROM "Race" WHERE "qualiJson" IS NOT NULL AND "id" IN (${slice.map(() => "?").join(",")})`,
        ...slice
      );
    } catch {
      rows = [];
    }
    for (const row of rows) {
      if (!row?.qualiJson) continue;
      let blob;
      try {
        blob = JSON.parse(row.qualiJson);
      } catch {
        continue; // a corrupt blob falls back to the grid like a missing one
      }
      withQuali.add(row.id);
      const driverId = poleFromQuali(blob);
      if (driverId) out.set(row.id, driverId);
    }
  }

  // 2. The grid, for the rounds without a session.
  const rest = ids.filter((id) => !withQuali.has(id));
  for (let i = 0; i < rest.length; i += CHUNK) {
    const slice = rest.slice(i, i + CHUNK);
    let rows = [];
    try {
      rows = await prisma.$queryRawUnsafe(
        `SELECT "raceId", "driverId" FROM "RaceResult" WHERE "grid" = 1 AND "raceId" IN (${slice.map(() => "?").join(",")})`,
        ...slice
      );
    } catch {
      rows = [];
    }
    for (const r of rows) if (r?.raceId && r.driverId && !out.has(r.raceId)) out.set(r.raceId, r.driverId);
  }
  return out;
}
