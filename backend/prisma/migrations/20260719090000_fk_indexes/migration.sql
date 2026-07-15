-- Foreign-key indexes. Prisma does not create indexes on FK columns for
-- SQLite, so every FK below was an unindexed full-table scan on join/filter.
-- Columns already covered as the LEFTMOST column of a unique index are
-- deliberately omitted (RaceResult.raceId, Race.seasonId, Season.seriesId) —
-- their composite unique index already serves lookups on that column.

-- CreateIndex
CREATE INDEX "ConstructorRaceScore_teamId_idx" ON "ConstructorRaceScore"("teamId");

-- CreateIndex
CREATE INDEX "Driver_seasonId_idx" ON "Driver"("seasonId");

-- CreateIndex
CREATE INDEX "Driver_teamId_idx" ON "Driver"("teamId");

-- CreateIndex
CREATE INDEX "RaceResult_driverId_idx" ON "RaceResult"("driverId");

-- CreateIndex
CREATE INDEX "RaceResult_subForTeamId_idx" ON "RaceResult"("subForTeamId");

-- CreateIndex
CREATE INDEX "RaceRsvp_driverId_idx" ON "RaceRsvp"("driverId");

-- CreateIndex
CREATE INDEX "Team_seasonId_idx" ON "Team"("seasonId");
