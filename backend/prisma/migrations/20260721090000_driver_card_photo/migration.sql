-- Optional card-only picture: a separate image just for the rating card, so a
-- driver can keep one photo as their profile avatar and a different one on the
-- card. null = the card falls back to the profile picture. Mirrored by
-- ensureAppSchema (raw SQL) for dev servers.
ALTER TABLE "Driver" ADD COLUMN "cardPhotoUrl" TEXT;
