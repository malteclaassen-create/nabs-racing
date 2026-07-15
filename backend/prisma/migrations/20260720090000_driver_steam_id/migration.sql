-- Steam GUID (SteamID64) captured from AC race-result imports. Stable
-- per-person identity, preferred over fuzzy name matching on future imports.
-- Unique PER SEASON: a driver has one row per season, so the same SteamID
-- legitimately recurs once per season. SQLite treats NULLs as distinct, so the
-- many rows with no captured GUID do not collide on this index.

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN "steamId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Driver_seasonId_steamId_key" ON "Driver"("seasonId", "steamId");
