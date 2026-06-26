-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RaceResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raceId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "position" INTEGER,
    "points" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'FINISHED',
    "subForTeamId" TEXT,
    "penaltyPositions" INTEGER NOT NULL DEFAULT 0,
    "penaltySeconds" INTEGER NOT NULL DEFAULT 0,
    "grid" INTEGER,
    "bestLapMs" INTEGER,
    "totalTimeMs" INTEGER,
    CONSTRAINT "RaceResult_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RaceResult_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RaceResult_subForTeamId_fkey" FOREIGN KEY ("subForTeamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RaceResult" ("bestLapMs", "driverId", "grid", "id", "penaltyPositions", "points", "position", "raceId", "status", "subForTeamId") SELECT "bestLapMs", "driverId", "grid", "id", "penaltyPositions", "points", "position", "raceId", "status", "subForTeamId" FROM "RaceResult";
DROP TABLE "RaceResult";
ALTER TABLE "new_RaceResult" RENAME TO "RaceResult";
CREATE UNIQUE INDEX "RaceResult_raceId_driverId_key" ON "RaceResult"("raceId", "driverId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
