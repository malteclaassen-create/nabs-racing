-- A driver transfer, recorded against a ROUND instead of against "now".
--
-- "Maltegoat drives for Ferrari from round 5" points both ways in time: the
-- round may still be ahead (the change has to wait for it) or long past (the
-- rounds since were attributed to the wrong team, constructor points included).
-- One row says it either way; services/driverTransfers.js works out the rest.
--
-- Mirrored by ensureAppSchema, which creates the same table at boot.
CREATE TABLE IF NOT EXISTS "DriverTeamChange" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "driverId"  TEXT NOT NULL,
    "seasonId"  TEXT,
    "fromRound" INTEGER NOT NULL,
    "teamId"    TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One statement per driver and round: entering the same round twice replaces
-- the earlier answer rather than stacking two contradictory ones.
CREATE UNIQUE INDEX IF NOT EXISTS "DriverTeamChange_driverId_fromRound_key" ON "DriverTeamChange"("driverId", "fromRound");
CREATE INDEX IF NOT EXISTS "DriverTeamChange_seasonId_idx" ON "DriverTeamChange"("seasonId");
