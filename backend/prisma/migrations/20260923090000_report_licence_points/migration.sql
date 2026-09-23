-- Licence points and the kind of a steward's penalty (TIME, WARNING, GRID,
-- DSQ) on an incident report. See lib/reports.js.
--
-- Written as the WHOLE table, IF NOT EXISTS, rather than as two ALTER TABLEs,
-- and that is on purpose. The Report table has never had a migration of its
-- own: it is created at boot by ensureAppSchema, which also adds every column
-- that came after it (contactKph, appliedSeconds, ...). SQLite has no
-- "ADD COLUMN IF NOT EXISTS", so an ALTER here fails both ways it can run:
--   * on a fresh database, where `migrate deploy` runs before the first boot
--     and there is no Report table yet to alter, and
--   * on a database a dev server has already booted with this code, where
--     ensureAppSchema added the column first — "duplicate column", P3009, and
--     the deploy crash-loops (see DEPLOYMENT.md).
-- As one CREATE TABLE IF NOT EXISTS it cannot fail: a fresh database gets the
-- table in its current shape, new columns included, and on one that already
-- has a Report table this is a no-op and ensureAppSchema adds the two columns
-- at boot, the same way it added every Report column before them.
CREATE TABLE IF NOT EXISTS "Report" (
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
    "updatedAt" DATETIME,
    "contactKph" INTEGER,
    "contactSecond" INTEGER,
    "contactIndex" INTEGER,
    "incidentGroupId" TEXT,
    "appliedSeconds" INTEGER,
    "appliedAt" DATETIME,
    "penaltyKind" TEXT,
    "licencePoints" INTEGER
);
CREATE INDEX IF NOT EXISTS "Report_raceId_idx" ON "Report"("raceId");
CREATE INDEX IF NOT EXISTS "Report_createdAt_idx" ON "Report"("createdAt");
