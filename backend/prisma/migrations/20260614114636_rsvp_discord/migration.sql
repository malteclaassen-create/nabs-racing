-- AlterTable
ALTER TABLE "Race" ADD COLUMN "discordMessageId" TEXT;

-- CreateTable
CREATE TABLE "RaceRsvp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raceId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RaceRsvp_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RaceRsvp_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RaceRsvp_raceId_driverId_key" ON "RaceRsvp"("raceId", "driverId");
