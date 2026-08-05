-- Admin-recorded fastest-lap holder for archive rounds without AC data. Where
-- lap times exist the fastest lap is derived from bestLapMs; a set flag wins
-- over that derivation (admin Results tab, "Race honours"). Poles need no
-- column of their own: recording one writes grid = 1, which every consumer
-- already counts as a pole.
-- Mirrored by ensureAppSchema (raw SQL) for dev servers that boot without migrate.
ALTER TABLE "RaceResult" ADD COLUMN "fastestLap" BOOLEAN NOT NULL DEFAULT 0;
