-- Per-driver-per-race telemetry distilled from the AC race JSON. All nullable:
-- null = not imported / backfilled for this round yet. Mirrored by the raw-SQL
-- ensureAppSchema (backend/src/lib/ensureSchema.js) for the running dev server.
ALTER TABLE "RaceResult" ADD COLUMN "envContacts" INTEGER;
ALTER TABLE "RaceResult" ADD COLUMN "cuts" INTEGER;
ALTER TABLE "RaceResult" ADD COLUMN "overtakes" INTEGER;
ALTER TABLE "RaceResult" ADD COLUMN "laps" INTEGER;
ALTER TABLE "RaceResult" ADD COLUMN "cleanLaps" INTEGER;
ALTER TABLE "RaceResult" ADD COLUMN "consistencyMs" REAL;
ALTER TABLE "RaceResult" ADD COLUMN "gamePenalties" INTEGER;
ALTER TABLE "RaceResult" ADD COLUMN "gamePenaltySeconds" REAL;
