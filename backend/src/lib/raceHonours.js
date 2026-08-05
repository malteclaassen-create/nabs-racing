// ---------------------------------------------------------------------------
// Manual race honours for archive rounds (admin Results tab, "Race honours").
// The early seasons carry no AC data, so "who took pole / the fastest lap" can
// be recorded by hand:
//   * pole        -> stored as RaceResult.grid = 1 (no extra column; every
//                    consumer already counts grid 1 as a pole),
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
