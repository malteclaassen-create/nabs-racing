-- Which of the six headline stat tiles a driver shows on their public profile
-- (JSON array of tile keys; null = all of them). Mirrored by ensureAppSchema.
ALTER TABLE "Driver" ADD COLUMN "profileTiles" TEXT;
