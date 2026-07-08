// ---------------------------------------------------------------------------
// App-level schema upkeep that runs OUTSIDE `prisma migrate`, in raw SQL, on
// every server boot. Same reasoning as ensureDownloadTables in lib/downloads.js:
// the running dev server locks the generated Prisma client engine on Windows,
// so columns/tables that must be writable while the server is up are added by
// hand here (idempotent) and mirrored by a matching migration for production
// (start:prod runs `prisma migrate deploy` first). Keep this in sync with
// schema.prisma and the migration folders by hand.
// ---------------------------------------------------------------------------

// Add a column only if it isn't already there (SQLite has no
// ADD COLUMN IF NOT EXISTS). `def` is everything after the name, e.g. "INTEGER".
async function addColumn(prisma, table, name, def) {
  const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
  if (!cols.some((c) => c.name === name)) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${def}`);
  }
}

export async function ensureAppSchema(prisma) {
  // --- Phase 1: per-driver-per-race telemetry distilled from the AC race JSON.
  // All nullable: null = "not imported / backfilled for this round yet".
  await addColumn(prisma, "RaceResult", "envContacts", "INTEGER"); // wall / off-track hits
  await addColumn(prisma, "RaceResult", "cuts", "INTEGER"); // sum of per-lap track cuts
  await addColumn(prisma, "RaceResult", "overtakes", "INTEGER"); // estimated on-track passes
  await addColumn(prisma, "RaceResult", "laps", "INTEGER"); // laps completed
  await addColumn(prisma, "RaceResult", "cleanLaps", "INTEGER"); // laps within 10s of own best
  await addColumn(prisma, "RaceResult", "consistencyMs", "REAL"); // stdev of clean laps (ms)
  await addColumn(prisma, "RaceResult", "gamePenalties", "INTEGER"); // in-game penalty count
  await addColumn(prisma, "RaceResult", "gamePenaltySeconds", "REAL"); // in-game penalty seconds

  // --- Phase 6: admin-picked Driver of the Day for a completed race.
  await addColumn(prisma, "Race", "driverOfTheDayId", "TEXT");

  // --- Phase 5: team-level drop rule. null = legacy behaviour (teams inherit
  // each driver's own dropped rounds); 0 = no team drop; N = drop the N lowest
  // single-driver round contributions from each team's total.
  await addColumn(prisma, "Season", "teamDropWorst", "INTEGER");

  // --- Phase 9: season visibility. Existing rows default to public (1). New
  // seasons are created private by the admin route; an active season is forced
  // public on activation. Private seasons are hidden from every public read.
  await addColumn(prisma, "Season", "isPublic", "BOOLEAN NOT NULL DEFAULT 1");

  // --- Phase 3: cross-season person links. One row per driver row that belongs
  // to a person; all driver rows of the same person share one personId.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PersonLink" (
    "driverId" TEXT NOT NULL PRIMARY KEY,
    "personId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PersonLink_personId_idx" ON "PersonLink"("personId")`
  );
}
