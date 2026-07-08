-- Admin-picked Driver of the Day for a completed race. Mirrored by
-- ensureAppSchema (backend/src/lib/ensureSchema.js) for the running dev server.
ALTER TABLE "Race" ADD COLUMN "driverOfTheDayId" TEXT;
