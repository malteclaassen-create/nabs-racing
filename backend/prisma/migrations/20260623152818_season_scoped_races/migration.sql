-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Race" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER,
    "isSpecialEvent" BOOLEAN NOT NULL DEFAULT false,
    "seasonId" TEXT,
    "track" TEXT NOT NULL,
    "date" DATETIME,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER NOT NULL DEFAULT 40,
    "info" TEXT,
    "discordMessageId" TEXT,
    CONSTRAINT "Race_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Race" ("capacity", "date", "discordMessageId", "id", "info", "isCompleted", "number", "seasonId", "track") SELECT "capacity", "date", "discordMessageId", "id", "info", "isCompleted", "number", "seasonId", "track" FROM "Race";
DROP TABLE "Race";
ALTER TABLE "new_Race" RENAME TO "Race";
CREATE UNIQUE INDEX "Race_seasonId_number_key" ON "Race"("seasonId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill logoUrl for the Season 7 teams that already have an image file in
-- frontend/public/teams/<id>.png, so the team mark is fully data-driven.
UPDATE "Team" SET "logoUrl" = '/teams/' || "id" || '.png'
WHERE "id" IN (
  'porsche','mclaren','ferrari','williams','honda','renault','super_aguri',
  'spyker','torro_rosso','redbull','toyota','bmw','jaguar','fiat',
  'lamborghini','ncb_mugen'
) AND ("logoUrl" IS NULL OR "logoUrl" = '');
