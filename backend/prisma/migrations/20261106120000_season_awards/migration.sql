-- Season awards (lib/seasonAwards.js): the honours the league hands out at the
-- end of a season, typed in by an admin. Won by a driver, team or race of that
-- season, or by a name typed by hand. Mirrored by ensureAppSchema.
CREATE TABLE IF NOT EXISTS "SeasonAward" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "seasonId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "driverId" TEXT,
  "teamId" TEXT,
  "raceId" TEXT,
  "winnerText" TEXT,
  "note" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SeasonAward_seasonId_position_idx" ON "SeasonAward"("seasonId", "position");
