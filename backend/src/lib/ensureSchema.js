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
  await addColumn(prisma, "RaceResult", "consistencyPct", "REAL"); // simresults-style consistency %
  await addColumn(prisma, "RaceResult", "gamePenalties", "INTEGER"); // in-game penalty count
  await addColumn(prisma, "RaceResult", "gamePenaltySeconds", "REAL"); // in-game penalty seconds

  // --- Phase 6: admin-picked Driver of the Day for a completed race.
  await addColumn(prisma, "Race", "driverOfTheDayId", "TEXT");
  // Who made the pick (the league's streamer decides each round). Free text.
  await addColumn(prisma, "Race", "driverOfTheDayBy", "TEXT");

  // --- Session format for the announcement (Discord post + upcoming-race
  // panels): qualifying length in minutes, race distance in laps. Optional.
  await addColumn(prisma, "Race", "qualiMinutes", "INTEGER");
  await addColumn(prisma, "Race", "raceLaps", "INTEGER");

  // --- Phase 5: team-level drop rule. null = legacy behaviour (teams inherit
  // each driver's own dropped rounds); 0 = no team drop; N = drop the N lowest
  // single-driver round contributions from each team's total.
  await addColumn(prisma, "Season", "teamDropWorst", "INTEGER");
  // How teamDropWorst counts: null/'results' = single-driver round scores,
  // 'rounds' = whole team round totals (the official sheet's style).
  await addColumn(prisma, "Season", "teamDropMode", "TEXT");

  // --- Phase 9: season visibility. Existing rows default to public (1). New
  // seasons are created private by the admin route; an active season is forced
  // public on activation. Private seasons are hidden from every public read.
  await addColumn(prisma, "Season", "isPublic", "BOOLEAN NOT NULL DEFAULT 1");

  // --- "Coming up" announcement: an upcoming season may advertise itself in
  // the Home/Welcome teaser even while still private. Admin-toggled.
  await addColumn(prisma, "Season", "isAnnounced", "BOOLEAN NOT NULL DEFAULT 0");

  // --- Profile tiles: which of the six headline stat tiles a driver shows on
  // their public profile. JSON array of tile keys; null = all of them.
  await addColumn(prisma, "Driver", "profileTiles", "TEXT");

  // --- Card photo framing: how the profile picture sits on the rating card
  // (JSON {"x":0-100,"y":0-100,"z":1-3}; null = default). Self-service.
  await addColumn(prisma, "Driver", "cardPhotoPos", "TEXT");

  // --- Special league role, shown on the rating card and profile. null =
  // regular driver; 'safety' = safety car driver. Admin-set (Drivers tab).
  await addColumn(prisma, "Driver", "role", "TEXT");

  // --- Self-hosted traffic counter (admin Traffic tab). Aggregated page views
  // per day+path, plus anonymous daily-unique visitor markers (see lib/traffic.js
  // for the privacy story). Raw SQL tables like PersonLink below.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TrafficView" (
    "day"   TEXT NOT NULL,
    "path"  TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("day", "path")
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TrafficVisitor" (
    "day"  TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    PRIMARY KEY ("day", "hash")
  )`);

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
