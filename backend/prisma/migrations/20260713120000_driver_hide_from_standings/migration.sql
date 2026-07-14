-- Admin-set: remove a (deactivated) driver from the public driver standings
-- entirely. Race results and constructor points stay untouched; reactivating
-- the driver clears the flag. Mirrored by ensureAppSchema.
ALTER TABLE "Driver" ADD COLUMN "hideFromStandings" BOOLEAN NOT NULL DEFAULT 0;
