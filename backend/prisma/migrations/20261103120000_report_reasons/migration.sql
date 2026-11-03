-- Why the stewards decided as they did (decisionReason, a code from
-- lib/reports.js DECISION_REASONS), and a report its driver withdrew with a
-- reason (withdrawReason, withdrawnAt; status WITHDRAWN).
--
-- The whole table, IF NOT EXISTS, for the reason 20260923090000 gives: the
-- Report table is created and extended at boot by ensureAppSchema, so an ALTER
-- here fails on a fresh database (no table yet) and on a booted one (duplicate
-- column). On an existing database this is a no-op and ensureAppSchema adds
-- the three columns at boot.
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
    "licencePoints" INTEGER,
    "decisionReason" TEXT,
    "withdrawReason" TEXT,
    "withdrawnAt" DATETIME
);
CREATE INDEX IF NOT EXISTS "Report_raceId_idx" ON "Report"("raceId");
CREATE INDEX IF NOT EXISTS "Report_createdAt_idx" ON "Report"("createdAt");
