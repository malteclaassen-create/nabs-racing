-- Several series side by side, entry lists, transfers, sprint sessions,
-- qualifying and points rules. Existing seasons and teams move into one
-- series ("Rain Racers", slug main), and every driver who raced in a
-- season, or had a team, gets an entry there.

-- CreateTable
CREATE TABLE "Series" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "schedule" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "liveWsUrl" TEXT,
    "liveOrigin" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Home for what is already there (only when there is something).
INSERT INTO "Series" ("name", "slug", "order")
SELECT 'Rain Racers', 'main', 0
WHERE EXISTS (SELECT 1 FROM "Season") OR EXISTS (SELECT 1 FROM "Team");

-- CreateTable
CREATE TABLE "Entry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "teamId" INTEGER,
    "number" INTEGER,
    CONSTRAINT "Entry_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entry_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Entry_seasonId_driverId_key" ON "Entry"("seasonId", "driverId");

-- Entry lists from the old data, while Driver still has its teamId: everyone
-- who raced in a season, then everyone with a team in the current season.
INSERT OR IGNORE INTO "Entry" ("seasonId", "driverId", "teamId")
SELECT DISTINCT r."seasonId", res."driverId", d."teamId"
FROM "Result" res
JOIN "Race" r ON r."id" = res."raceId"
JOIN "Driver" d ON d."id" = res."driverId";
INSERT OR IGNORE INTO "Entry" ("seasonId", "driverId", "teamId")
SELECT s."id", d."id", d."teamId"
FROM "Driver" d, "Season" s
WHERE s."isCurrent" = 1 AND d."teamId" IS NOT NULL;

-- CreateTable
CREATE TABLE "Transfer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "teamId" INTEGER,
    "fromRound" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transfer_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transfer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transfer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QualiResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "raceId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "bestLapMs" INTEGER,
    CONSTRAINT "QualiResult_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QualiResult_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ManualPoints" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "points" REAL NOT NULL,
    "note" TEXT,
    CONSTRAINT "ManualPoints_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ManualPoints_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Driver" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "number" INTEGER,
    "country" TEXT,
    "steamGuid" TEXT,
    "userId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Driver" ("country", "createdAt", "id", "name", "number", "steamGuid", "userId") SELECT "country", "createdAt", "id", "name", "number", "steamGuid", "userId" FROM "Driver";
DROP TABLE "Driver";
ALTER TABLE "new_Driver" RENAME TO "Driver";
CREATE UNIQUE INDEX "Driver_steamGuid_key" ON "Driver"("steamGuid");
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");
CREATE TABLE "new_Race" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "notes" TEXT,
    "hasSprint" BOOLEAN NOT NULL DEFAULT false,
    "pointsMultiplier" REAL NOT NULL DEFAULT 1,
    "pointsTable" TEXT,
    "importedAt" DATETIME,
    CONSTRAINT "Race_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Race" ("id", "importedAt", "name", "notes", "pointsMultiplier", "round", "seasonId", "startsAt", "track") SELECT "id", "importedAt", "name", "notes", "pointsMultiplier", "round", "seasonId", "startsAt", "track" FROM "Race";
DROP TABLE "Race";
ALTER TABLE "new_Race" RENAME TO "Race";
CREATE TABLE "new_Result" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "raceId" INTEGER NOT NULL,
    "session" TEXT NOT NULL DEFAULT 'FEATURE',
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
INSERT INTO "new_Result" ("bestLapMs", "carModel", "driverId", "id", "laps", "pointsAdjust", "position", "raceId", "status", "teamId", "totalTimeMs") SELECT "bestLapMs", "carModel", "driverId", "id", "laps", "pointsAdjust", "position", "raceId", "status", "teamId", "totalTimeMs" FROM "Result";
DROP TABLE "Result";
ALTER TABLE "new_Result" RENAME TO "Result";
CREATE UNIQUE INDEX "Result_raceId_session_driverId_key" ON "Result"("raceId", "session", "driverId");
CREATE TABLE "new_Season" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seriesId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "pointsTable" TEXT,
    "sprintPointsTable" TEXT,
    "dropWorst" INTEGER NOT NULL DEFAULT 0,
    "championId" INTEGER,
    "championNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Season_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Season" ("createdAt", "id", "isCurrent", "name", "seriesId") SELECT "createdAt", "id", "isCurrent", "name", (SELECT "id" FROM "Series" WHERE "slug" = 'main') FROM "Season";
DROP TABLE "Season";
ALTER TABLE "new_Season" RENAME TO "Season";
CREATE TABLE "new_Team" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seriesId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Team_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Team" ("archived", "color", "id", "name", "seriesId") SELECT "archived", "color", "id", "name", (SELECT "id" FROM "Series" WHERE "slug" = 'main') FROM "Team";
DROP TABLE "Team";
ALTER TABLE "new_Team" RENAME TO "Team";
CREATE UNIQUE INDEX "Team_seriesId_name_key" ON "Team"("seriesId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Series_slug_key" ON "Series"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "QualiResult_raceId_driverId_key" ON "QualiResult"("raceId", "driverId");

