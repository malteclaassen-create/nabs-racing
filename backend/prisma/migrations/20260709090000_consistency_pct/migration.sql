-- simresults-style consistency percentage per driver per race (matches the
-- Discord result posts). Mirrored by ensureAppSchema (backend/src/lib/
-- ensureSchema.js) for the running dev server.
ALTER TABLE "RaceResult" ADD COLUMN "consistencyPct" REAL;
