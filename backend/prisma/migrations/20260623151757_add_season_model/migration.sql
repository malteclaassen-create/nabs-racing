-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "game" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Driver" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "discordName" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "seasonId" TEXT,
    "tier" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "discordUserId" TEXT,
    "photoUrl" TEXT,
    "discordAvatar" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Driver_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Driver_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Driver" ("createdAt", "discordAvatar", "discordName", "discordUserId", "id", "isActive", "name", "photoUrl", "teamId", "tier") SELECT "createdAt", "discordAvatar", "discordName", "discordUserId", "id", "isActive", "name", "photoUrl", "teamId", "tier" FROM "Driver";
DROP TABLE "Driver";
ALTER TABLE "new_Driver" RENAME TO "Driver";
CREATE UNIQUE INDEX "Driver_discordUserId_key" ON "Driver"("discordUserId");
CREATE TABLE "new_Race" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "seasonId" TEXT,
    "track" TEXT NOT NULL,
    "date" DATETIME,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER NOT NULL DEFAULT 40,
    "info" TEXT,
    "discordMessageId" TEXT,
    CONSTRAINT "Race_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Race" ("capacity", "date", "discordMessageId", "id", "info", "isCompleted", "number", "track") SELECT "capacity", "date", "discordMessageId", "id", "info", "isCompleted", "number", "track" FROM "Race";
DROP TABLE "Race";
ALTER TABLE "new_Race" RENAME TO "Race";
CREATE UNIQUE INDEX "Race_number_key" ON "Race"("number");
CREATE TABLE "new_Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "logoUrl" TEXT,
    "seasonId" TEXT,
    CONSTRAINT "Team_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Team" ("color", "id", "name", "tier") SELECT "color", "id", "name", "tier" FROM "Team";
DROP TABLE "Team";
ALTER TABLE "new_Team" RENAME TO "Team";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Season_number_key" ON "Season"("number");

-- Backfill: create Season 7 and attach all existing teams, drivers and races.
-- (Existing data predates the season model; it all belongs to Season 7.)
INSERT INTO "Season" ("id", "number", "name", "game", "isActive")
VALUES ('season7', 7, 'Season 7', 'F1 2007 · Assetto Corsa', true);
UPDATE "Team" SET "seasonId" = 'season7' WHERE "seasonId" IS NULL;
UPDATE "Driver" SET "seasonId" = 'season7' WHERE "seasonId" IS NULL;
UPDATE "Race" SET "seasonId" = 'season7' WHERE "seasonId" IS NULL;
