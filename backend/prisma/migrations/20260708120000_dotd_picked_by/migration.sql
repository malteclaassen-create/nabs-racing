-- Who picked the Driver of the Day (the league's streamer decides each round).
-- Mirrored by ensureAppSchema (backend/src/lib/ensureSchema.js) for the running
-- dev server.
ALTER TABLE "Race" ADD COLUMN "driverOfTheDayBy" TEXT;
