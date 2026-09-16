-- Bonus points for the fastest race lap, per season (admin Seasons tab). Paid
-- on top of the finishing points to the classified finisher who set the race's
-- best lap; 0 = none. Mirrored by ensureAppSchema for dev servers that boot
-- without migrate.
ALTER TABLE "Season" ADD COLUMN "fastestLapPoints" INTEGER NOT NULL DEFAULT 0;
