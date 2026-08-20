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
// Returns true when the column was actually created, so a caller can run a
// one-time backfill exactly once per database.
async function addColumn(prisma, table, name, def) {
  const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
  // A table with no columns is a table that isn't there. Say so and carry on
  // rather than throwing: the whole upkeep is one promise chain with one catch
  // (src/index.js), so a single missing table used to take every section below
  // it down with it — and the sections are independent of each other. The line
  // in the log names the table, which is the thing worth knowing.
  if (!cols.length) {
    console.warn(`schema upkeep: no "${table}" table — skipping column "${name}"`);
    return false;
  }
  if (cols.some((c) => c.name === name)) return false;
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${def}`);
  return true;
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

  // --- Full qualifying classification (migration race_quali_json): JSON blob
  // per race from the AC QUALIFY result file — {track, date, entries: [...]}.
  // A blob rather than rows because a quali entrant may have no RaceResult at
  // all (qualified, did not start). Matched drivers' laps also populate
  // RaceResult.qualiTimeMs above. Shown as the Qualifying tab on race results.
  await addColumn(prisma, "Race", "qualiJson", "TEXT");

  // --- Tyre stints (migration result_stints): JSON [{tyre, laps}] distilled
  // from the AC result file's per-lap Tyre field. Feeds the expandable
  // strategy row on stored race results. null = imported before this existed.
  await addColumn(prisma, "RaceResult", "stints", "TEXT");

  // --- Manual race honours (migration result_fastest_lap): the admin can
  // record who took the FASTEST LAP of an archive round by hand (Results tab,
  // "Race honours"), because the early seasons have no AC data to derive it
  // from. A set flag wins over the bestLapMs derivation everywhere (see
  // lib/raceHonours.js). Poles need no column of their own: recording one
  // writes grid = 1, which every consumer already counts.
  await addColumn(prisma, "RaceResult", "fastestLap", "BOOLEAN NOT NULL DEFAULT 0");

  // --- Phase 6: admin-picked Driver of the Day for a completed race.
  await addColumn(prisma, "Race", "driverOfTheDayId", "TEXT");
  // Who made the pick (the league's streamer decides each round). Free text.
  await addColumn(prisma, "Race", "driverOfTheDayBy", "TEXT");

  // --- Session format for the announcement (Discord post + upcoming-race
  // panels): qualifying length in minutes, race distance in laps. Optional.
  await addColumn(prisma, "Race", "qualiMinutes", "INTEGER");
  await addColumn(prisma, "Race", "raceLaps", "INTEGER");

  // --- Highlights video of a finished round (migration race_highlights): one
  // pasted link, shown as the Highlights button on the race results. Any
  // http(s) address; see lib/raceHighlights.js.
  await addColumn(prisma, "Race", "highlightsUrl", "TEXT");

  // --- Per-round main-card photo: the Home hero shows the latest round, so
  // each round can carry its own picture of the place it was run at. Without
  // one the hero keeps the season photo, exactly as before (lib/raceHero.js).
  await addColumn(prisma, "Race", "heroImageUrl", "TEXT");

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

  // --- Admin-uploaded car image for the "coming soon" hero panel (migration
  // season_car_image). null = the static /cars/s<number>.jpg convention; if
  // that's missing too the panel disappears entirely (no placeholder).
  await addColumn(prisma, "Season", "carImageUrl", "TEXT");

  // --- Driver rating cards per season (migration season_cards_enabled). The
  // ratings are distilled from race telemetry the early seasons never produced,
  // so a card there would be a guess dressed up as a number. OFF removes the
  // "Cards" view from that season's driver standings and falls the driver page
  // back to a plain avatar. The backfill runs ONCE, at column creation: from
  // then on the admin toggle (Seasons tab) owns the value, so a season switched
  // back on doesn't get switched off again on the next boot.
  {
    const fresh = await addColumn(prisma, "Season", "cardsEnabled", "BOOLEAN NOT NULL DEFAULT 1");
    if (fresh) {
      await prisma.$executeRawUnsafe(`UPDATE "Season" SET "cardsEnabled" = 0 WHERE "number" <= 4`);
    }
  }

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

  // --- Cockpit (private driver area): self-set season goals as a JSON array
  // ([{id, text, metric?, target?}]) — private to the driver, per season row.
  await addColumn(prisma, "Driver", "cockpitGoals", "TEXT");
  // Achievements a driver pinned onto their PUBLIC profile (JSON key array,
  // max 3). null = nothing pinned.
  await addColumn(prisma, "Driver", "achievementsPinned", "TEXT");
  // Achievement-unlock bookkeeping, exactly like cardUnlocksNotified: the keys
  // already announced via the bell; the first computation seeds silently.
  await addColumn(prisma, "Driver", "achievementsNotified", "TEXT");

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

  // --- What a driver writes about themselves in their own profile: a short
  // "about me" line and an optional racing number.
  //
  // These two are in schema.prisma and in NO migration — they reached the
  // running database through `prisma db push` and have been there ever since,
  // which is why nothing ever noticed. A database built the documented way
  // (`prisma migrate deploy`) has neither, and the seed dies on the first
  // driver it writes. Here rather than in a new migration on purpose: a
  // migration adding a column the live database already has fails, and
  // `start:prod` runs `prisma migrate deploy` before the server, so the deploy
  // that carried the fix would be the one that stopped booting. addColumn asks
  // first and does nothing when the column is there.
  await addColumn(prisma, "Driver", "bio", "TEXT");
  await addColumn(prisma, "Driver", "number", "INTEGER");

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
  // --- The Discord login itself. Every column below hangs off this table, and
  // until now nothing created it: it is in schema.prisma, in no migration, and
  // reached the running database through `prisma db push`. On a database built
  // the documented way the next line hit a table that wasn't there, the upkeep
  // threw, and — because the whole chain is one promise with one catch
  // (src/index.js) — everything defined AFTER this point never ran either:
  // feedback, reports, series, person links, the traffic counter. A fresh
  // install came up looking healthy and fell over on the first login.
  //
  // Read and written in raw SQL throughout (lib/members.js, lib/notifications.js),
  // so this DDL is the whole definition, not a mirror of a Prisma-managed one.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MemberAccount" (
    "discordId" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "banned" BOOLEAN NOT NULL DEFAULT 0,
    "banReason" TEXT,
    "firstLoginAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loginCount" INTEGER NOT NULL DEFAULT 1
  )`);
  // When this member last opened the bell — everything newer counts as unread.
  await addColumn(prisma, "MemberAccount", "notificationsSeenAt", "DATETIME");
  // "I want to race": a logged-in account with no driver profile can raise a
  // hand from the Attendance page. Stamp + free-text (race name) shown in the
  // admin Members tab; cleared when the account gets linked or a driver is
  // created for it.
  await addColumn(prisma, "MemberAccount", "raceRequestAt", "DATETIME");
  await addColumn(prisma, "MemberAccount", "raceRequestText", "TEXT");
  // Steam account proved via "Sign in through Steam". Lives on the ACCOUNT
  // because a fresh login has no Driver row yet; copied onto Driver.steamId as
  // soon as one exists (see lib/members.js applyMemberSteamId). Unique, so one
  // Steam account cannot be claimed by two logins — NULLs stay distinct in
  // SQLite, so accounts without one never collide.
  await addColumn(prisma, "MemberAccount", "steamId", "TEXT");
  await addColumn(prisma, "MemberAccount", "steamVerifiedAt", "DATETIME");
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "MemberAccount_steamId_key" ON "MemberAccount"("steamId")`
  );

  // --- Feedback from the site's visitors (migration feedback): bug reports and
  // feature wishes sent from the floating Feedback button. discordId is set
  // when the sender was signed in, null for a logged-out visitor (who may
  // leave a contact line instead). See lib/feedback.js.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "pageUrl" TEXT,
    "userAgent" TEXT,
    "discordId" TEXT,
    "senderName" TEXT,
    "contact" TEXT,
    "adminNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Feedback_createdAt_idx" ON "Feedback"("createdAt")`
  );

  // --- The thread on a piece of feedback (migration feedback_replies): the
  // admins' answer (author ADMIN) and the sender writing back (author SENDER).
  // Only feedback from a signed-in member can have one. See lib/feedback.js.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "FeedbackReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedbackId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "FeedbackReply_feedbackId_idx" ON "FeedbackReply"("feedbackId")`
  );

  // --- Incident reports (migration reports): "someone hit me on lap 14".
  // A report is a private conversation between the person who filed it, the
  // driver it names, the admins, and anybody an admin lets in — never public.
  // `source` is SITE for one written on the site and INGAME for one the
  // webPenalty app fired mid-race, which carries a timestamp instead of a lap.
  // See lib/reports.js.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raceId" TEXT,
    "lap" INTEGER,
    "reporterDiscordId" TEXT,
    "reporterName" TEXT,
    "accusedDriverId" TEXT,
    "accusedName" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'SITE',
    "incidentAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "verdict" TEXT,
    "penaltySeconds" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME
  )`);
  // How hard the contact was, in km/h, when the report was pinned to one of the
  // round's recorded contacts. The lap and the wall-clock moment go in the
  // columns that already exist ("lap" and "incidentAt"); this is the only part
  // with nowhere to live.
  await addColumn(prisma, "Report", "contactKph", "INTEGER");
  // How far into the session it happened, in seconds. The one anchor that no
  // clock, date or timezone can spoil: a steward drags the replay's own
  // timeline to it. `incidentAt` says WHEN in the world, this says WHERE in the
  // race, and only the second one survives a server in another country.
  await addColumn(prisma, "Report", "contactSecond", "INTEGER");
  // Which entry of the round's result file the contact is, counting from one.
  // The steward tool the league already runs numbers its own incident list the
  // same way, so this is the fastest way to say "that one" across two programs
  // that share nothing but the file. Counts every event in the file, so the
  // numbers a report carries are not consecutive.
  await addColumn(prisma, "Report", "contactIndex", "INTEGER");
  // How much of a decided penalty has actually reached a classification, and
  // when it did. Deciding "five seconds" in the Reports tab still does not put
  // them on the driver by itself — the results editor owns the points — but
  // that editor now fills the number in for you when you open the round, and
  // these two columns are what let it tell a penalty it has already written
  // from one it has not. Without them every visit would stack the same five
  // seconds on again. A steward correcting 5s to 10s afterwards leaves the two
  // differing by five, which is exactly what the editor still has to add.
  await addColumn(prisma, "Report", "appliedSeconds", "INTEGER");
  await addColumn(prisma, "Report", "appliedAt", "DATETIME");
  // Reports already filed by the in-game app carry a line quoting the app's own
  // wall clock, which was appended unconditionally. It is the same moment as
  // the report's timestamp seen from another timezone (the relaying machine
  // runs on UTC, the league reads its site from Berlin), so every one of those
  // reports showed two times two hours apart and nothing to say which one a
  // steward should scrub to — see lib/reportClock.js, which now only writes
  // that line when the clocks genuinely disagree.
  //
  // Strips the sentence off the ones already in the table. Idempotent by
  // construction: it only matches text this app generated, and once removed
  // there is nothing left to match. The note is always the last paragraph, so
  // taking everything from the marker on leaves the driver's own words intact.
  await prisma
    .$executeRawUnsafe(
      `UPDATE "Report"
          SET "body" = substr("body", 1, instr("body", char(10) || char(10) || '(The app''s clock read ') - 1)
        WHERE "source" = 'INGAME'
          AND instr("body", char(10) || char(10) || '(The app''s clock read ') > 0`
    )
    .catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Report_raceId_idx" ON "Report"("raceId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Report_createdAt_idx" ON "Report"("createdAt")`);

  // --- The conversation on a report. `author` is REPORTER, ACCUSED or ADMIN;
  // the byline is stored so a thread still reads correctly after a rename.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ReportMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorDiscordId" TEXT,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ReportMessage_reportId_idx" ON "ReportMessage"("reportId")`
  );

  // --- Pictures, clips and files hung on one message of a thread.
  //
  // The file itself is NOT under uploads/: that folder is served statically to
  // anybody who knows a URL, and a report is a private conversation. These live
  // in report-files/ and only ever come back through an endpoint that runs the
  // same read check as the thread. `storedName` is the name on disk (a random
  // id plus an extension), `name` is what the uploader called it.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ReportAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "messageId" TEXT,
    "storedName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "uploaderDiscordId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Set when the housekeeping sweep has taken the FILE off disk. The row
    -- stays so the thread can say a picture was here and has gone, rather than
    -- a message that used to be a clip becoming silently empty.
    "removedAt" DATETIME
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ReportAttachment_reportId_idx" ON "ReportAttachment"("reportId")`
  );
  await addColumn(prisma, "ReportAttachment", "removedAt", "DATETIME");

  // --- Extra people an admin has let into one report's thread (a witness, a
  // team mate). Membership is per report, never a blanket permission.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ReportViewer" (
    "reportId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("reportId", "discordId")
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
