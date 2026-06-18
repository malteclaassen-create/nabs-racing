-- AlterTable
ALTER TABLE "Driver" ADD COLUMN "discordAvatar" TEXT;
ALTER TABLE "Driver" ADD COLUMN "photoUrl" TEXT;

-- AlterTable
ALTER TABLE "RaceResult" ADD COLUMN "bestLapMs" INTEGER;
ALTER TABLE "RaceResult" ADD COLUMN "grid" INTEGER;
