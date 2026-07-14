-- Race type: CHAMPIONSHIP (scored round), TRAINING (practice session — not
-- scored, no round number, RSVP works) or SPECIAL (special event). Backfill
-- from the old isSpecialEvent flag, which stays in sync as a derived
-- "not scored" flag (every scoring read filters on it, TRAINING rows carry it
-- too). Mirrored by ensureAppSchema.
ALTER TABLE "Race" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'CHAMPIONSHIP';
UPDATE "Race" SET "type" = 'SPECIAL' WHERE "isSpecialEvent" = 1 AND "type" = 'CHAMPIONSHIP';
