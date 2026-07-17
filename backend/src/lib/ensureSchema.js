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
  await addColumn(prisma, "RaceResult", "lapsLed", "INTEGER"); // laps led (leader at S/F line each lap)
  await addColumn(prisma, "RaceResult", "laps", "INTEGER"); // laps completed
  await addColumn(prisma, "RaceResult", "cleanLaps", "INTEGER"); // laps within 10s of own best
  await addColumn(prisma, "RaceResult", "consistencyMs", "REAL"); // stdev of clean laps (ms)
  await addColumn(prisma, "RaceResult", "consistencyPct", "REAL"); // simresults-style consistency %
  await addColumn(prisma, "RaceResult", "gamePenalties", "INTEGER"); // in-game penalty count
  await addColumn(prisma, "RaceResult", "gamePenaltySeconds", "REAL"); // in-game penalty seconds

  // --- Qualifying best lap (ms). NOT populated yet: the AC pipeline currently
  // imports RACE JSONs only. Reserved for a future qualifying-session import so
  // PAC can add the sheet's "gap to pole" component (pole = the race's min
  // qualiTimeMs). Read via raw SQL in careerRatingService; null everywhere
  // until the quali files arrive, so the PAC component stays inert (weight 0).
  await addColumn(prisma, "RaceResult", "qualiTimeMs", "INTEGER");

  // --- Phase 6: admin-picked Driver of the Day for a completed race.
  await addColumn(prisma, "Race", "driverOfTheDayId", "TEXT");
  // Who made the pick (the league's streamer decides each round). Free text.
  await addColumn(prisma, "Race", "driverOfTheDayBy", "TEXT");

  // --- Session format for the announcement (Discord post + upcoming-race
  // panels): qualifying length in minutes, race distance in laps. Optional.
  await addColumn(prisma, "Race", "qualiMinutes", "INTEGER");
  await addColumn(prisma, "Race", "raceLaps", "INTEGER");

  // --- Race type (migration race_type): CHAMPIONSHIP | TRAINING | SPECIAL.
  // Backfill: rows flagged isSpecialEvent become SPECIAL once (a CHAMPIONSHIP-
  // typed row with the flag set is by definition unmigrated — TRAINING rows
  // carry the flag too but keep their type). isSpecialEvent stays in sync as
  // the derived "not scored" flag every scoring read already filters on.
  await addColumn(prisma, "Race", "type", "TEXT NOT NULL DEFAULT 'CHAMPIONSHIP'");
  await prisma.$executeRawUnsafe(
    `UPDATE "Race" SET "type" = 'SPECIAL' WHERE "isSpecialEvent" = 1 AND "type" = 'CHAMPIONSHIP'`
  );

  // --- Track flag country (migration race_country): ISO alpha-2 per race, the
  // one source of truth for track flags. Backfill only fills NULLs from the
  // static circuit table (+ known outline-less tracks), so admin edits stick.
  await addColumn(prisma, "Race", "country", "TEXT");
  {
    const { staticCountryFor } = await import("./raceCountries.js");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "track" FROM "Race" WHERE "country" IS NULL`
    );
    for (const r of rows) {
      const code = staticCountryFor(r.track);
      if (code) {
        await prisma.$executeRawUnsafe(`UPDATE "Race" SET "country" = ? WHERE "id" = ?`, code, r.id);
      }
    }
  }

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

  // --- Admin-uploaded hero photo override for the Home/Welcome main card.
  // null = fall back to the static /heroes/s<number>.jpg drop-in convention.
  await addColumn(prisma, "Season", "heroImageUrl", "TEXT");

  // --- Profile tiles: which of the six headline stat tiles a driver shows on
  // their public profile. JSON array of tile keys; null = all of them.
  await addColumn(prisma, "Driver", "profileTiles", "TEXT");

  // --- Card photo framing: how the profile picture sits on the rating card
  // (JSON {"x":0-100,"y":0-100,"z":1-3}; null = default). Self-service.
  await addColumn(prisma, "Driver", "cardPhotoPos", "TEXT");

  // --- Rating card edition: which unlockable card design the driver chose for
  // THIS season row (a key from lib/cardEditions.js; null = classic). Per-row
  // (a season award), not person-wide like the photo. Self-service on /profile.
  await addColumn(prisma, "Driver", "cardStyle", "TEXT");

  // --- Optional card-only picture: a separate image just for the rating card,
  // so a driver can keep one photo for their profile avatar and a different one
  // (a nicer portrait) on the card. null = the card falls back to the profile
  // picture. Self-service on /profile, raw SQL like photoUrl.
  await addColumn(prisma, "Driver", "cardPhotoUrl", "TEXT");

  // --- Rating card animation switch: null = the card keeps its edition's own
  // baseline motion (glow band, sparkle, gloss sweep); 'off' = a fully still
  // card (reuses the look-book's data-anim="none" state). Self-service on the
  // Edit Driver Card page. Per-row like cardStyle.
  await addColumn(prisma, "Driver", "cardAnim", "TEXT");

  // --- Card-unlock notification bookkeeping: a JSON array of the edition keys
  // this row has already been notified about, so newly-earned editions ping the
  // driver's bell exactly once. First computation seeds it silently (no dump of
  // a veteran's backlog). See lib/notifications.js notifyCardUnlocks.
  await addColumn(prisma, "Driver", "cardUnlocksNotified", "TEXT");

  // --- Special league role, shown on the rating card and profile. null =
  // regular driver; 'safety' = safety car driver. Admin-set (Drivers tab).
  await addColumn(prisma, "Driver", "role", "TEXT");

  // --- Admin-set: remove a (deactivated) driver from the public driver
  // standings entirely. Race results and constructor points stay untouched;
  // reactivating the driver clears the flag. Admin Drivers tab.
  await addColumn(prisma, "Driver", "hideFromStandings", "BOOLEAN NOT NULL DEFAULT 0");

  // --- Steam GUID (SteamID64) captured from AC race-result imports (migration
  // driver_steam_id). Stable per-person identity, preferred over fuzzy name
  // matching on future imports (see acJsonParser + raceWriter). Unique PER
  // SEASON: a driver has one row per season, so the same SteamID recurs once
  // per season. SQLite treats NULLs as distinct, so the many rows without a
  // captured GUID never collide on this index.
  await addColumn(prisma, "Driver", "steamId", "TEXT");
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Driver_seasonId_steamId_key" ON "Driver"("seasonId", "steamId")`
  );

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

  // --- Multi-series support (migration series_model): Series table + the
  // Season.seriesId column, with an idempotent backfill so every existing
  // season lives in one default series and the site behaves exactly as before.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Series" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "game" TEXT,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Series_slug_key" ON "Series"("slug")`
  );
  await addColumn(prisma, "Season", "seriesId", "TEXT");
  // Admin-picked accent colour (hex). null = default NABS pink. See the
  // frontend derivation in utils/seriesColor.js.
  await addColumn(prisma, "Series", "accentColor", "TEXT");
  // Admin-uploaded dark-mode logo mark. null = the shared default logo-dark.png.
  await addColumn(prisma, "Series", "logoDarkUrl", "TEXT");
  // Default series: created once; the SLUG is the stable URL identity, the
  // NAME is admin-renamable. Seasons without a series (pre-migration data or
  // a fresh seed) are adopted by the active series on every boot.
  await prisma.$executeRawUnsafe(`INSERT INTO "Series" ("id","name","slug","order","isActive","isPublic")
    SELECT 'friday-f1', 'NABS Racing League', 'friday-f1', 0, 1, 1
    WHERE NOT EXISTS (SELECT 1 FROM "Series")`);
  await prisma.$executeRawUnsafe(`UPDATE "Season"
    SET "seriesId" = (SELECT "id" FROM "Series" WHERE "isActive" = 1 ORDER BY "order" LIMIT 1)
    WHERE "seriesId" IS NULL`);
  // Season numbers are unique PER SERIES now (was: globally), so a second
  // series can start with its own Season 1 — mirrors Race.number per season.
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Season_number_key"`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Season_seriesId_number_key" ON "Season"("seriesId", "number")`
  );

  // --- In-site notifications (migration notifications): the nav-bar bell.
  // recipientId null = broadcast to every member; a discordId = personal.
  // dedupeKey (unique) makes event writes idempotent — see lib/notifications.js.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "recipientId" TEXT,
    "dedupeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Notification_dedupeKey_key" ON "Notification"("dedupeKey")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt")`
  );
  // When this member last opened the bell — everything newer counts as unread.
  await addColumn(prisma, "MemberAccount", "notificationsSeenAt", "DATETIME");

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
