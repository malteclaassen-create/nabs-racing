-- AlterTable
ALTER TABLE "Series" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Series" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Season" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seriesId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "pointsMode" TEXT NOT NULL DEFAULT 'TABLE',
    "pointsTable" TEXT,
    "raceTables" TEXT,
    "qualiPointsTable" TEXT,
    "dropWorst" INTEGER NOT NULL DEFAULT 0,
    "championId" INTEGER,
    "championNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Season_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- A season with sprint rounds keeps its sprint table as the table of race 1
-- in two-race rounds (race 2, the feature, pays the season's table).
INSERT INTO "new_Season" ("championId", "championNote", "createdAt", "dropWorst", "id", "isCurrent", "name", "pointsTable", "raceTables", "seriesId")
SELECT "championId", "championNote", "createdAt", "dropWorst", "id", "isCurrent", "name", "pointsTable",
    CASE WHEN "sprintPointsTable" IS NOT NULL OR EXISTS (SELECT 1 FROM "Race" WHERE "Race"."seasonId" = "Season"."id" AND "Race"."hasSprint")
        THEN json_object('2', json_array(json(COALESCE("sprintPointsTable", (SELECT "value" FROM "Setting" WHERE "key" = 'sprintPointsTable'), '[8,7,6,5,4,3,2,1]')), NULL))
        ELSE NULL END,
    "seriesId"
FROM "Season";
DROP TABLE "Season";
ALTER TABLE "new_Season" RENAME TO "Season";
CREATE TABLE "new_Race" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "mysteryTrack" BOOLEAN NOT NULL DEFAULT false,
    "car" TEXT,
    "startsAt" DATETIME NOT NULL,
    "notes" TEXT,
    "raceCount" INTEGER NOT NULL DEFAULT 1,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "timetable" TEXT,
    "pointsMultiplier" REAL NOT NULL DEFAULT 1,
    "pointsTable" TEXT,
    "importedAt" DATETIME,
    CONSTRAINT "Race_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- A round with a sprint becomes a round of two races.
INSERT INTO "new_Race" ("id", "importedAt", "name", "notes", "pointsMultiplier", "pointsTable", "raceCount", "round", "seasonId", "startsAt", "track")
SELECT "id", "importedAt", "name", "notes", "pointsMultiplier", "pointsTable", CASE WHEN "hasSprint" THEN 2 ELSE 1 END, "round", "seasonId", "startsAt", "track" FROM "Race";
DROP TABLE "Race";
ALTER TABLE "new_Race" RENAME TO "Race";
CREATE TABLE "new_Result" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "raceId" INTEGER NOT NULL,
    "session" TEXT NOT NULL DEFAULT 'R1',
    "driverId" INTEGER NOT NULL,
    "teamId" INTEGER,
    "position" INTEGER NOT NULL,
    "grid" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'FIN',
    "laps" INTEGER NOT NULL DEFAULT 0,
    "totalTimeMs" INTEGER,
    "bestLapMs" INTEGER,
    "carModel" TEXT,
    "penaltyMs" INTEGER NOT NULL DEFAULT 0,
    "penaltyNote" TEXT,
    "pointsAdjust" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "Result_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Result_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Result_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Result" ("bestLapMs", "carModel", "driverId", "grid", "id", "laps", "penaltyMs", "penaltyNote", "pointsAdjust", "position", "raceId", "session", "status", "teamId", "totalTimeMs") SELECT "bestLapMs", "carModel", "driverId", "grid", "id", "laps", "penaltyMs", "penaltyNote", "pointsAdjust", "position", "raceId",
    -- the sprint was the first race of the day, the feature the last
    CASE WHEN "session" = 'SPRINT' THEN 'R1'
         WHEN (SELECT "raceCount" FROM "Race" WHERE "Race"."id" = "Result"."raceId") = 2 THEN 'R2'
         ELSE 'R1' END,
    "status", "teamId", "totalTimeMs" FROM "Result";
DROP TABLE "Result";
ALTER TABLE "new_Result" RENAME TO "Result";
CREATE UNIQUE INDEX "Result_raceId_session_driverId_key" ON "Result"("raceId", "session", "driverId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- The league no longer has a sprint table of its own.
DELETE FROM "Setting" WHERE "key" = 'sprintPointsTable';
