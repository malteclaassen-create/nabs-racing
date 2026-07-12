-- Special league role for a driver row, shown on the rating card and profile.
-- null = regular driver; 'safety' = safety car driver. Room for more roles
-- later (steward, streamer, …). Mirrored by ensureAppSchema.
ALTER TABLE "Driver" ADD COLUMN "role" TEXT;
