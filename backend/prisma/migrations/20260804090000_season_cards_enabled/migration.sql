-- Per-season switch for the driver rating cards. The ratings are distilled from
-- race telemetry the early seasons never produced, so a card there would be a
-- guess dressed up as a number. OFF removes the "Cards" view from that season's
-- driver standings and falls the driver page back to a plain avatar.
-- Mirrored by ensureAppSchema (raw SQL) for dev servers that boot without migrate.
ALTER TABLE "Season" ADD COLUMN "cardsEnabled" BOOLEAN NOT NULL DEFAULT 1;

-- One-time starting point: seasons 1-4 predate the data the cards need. Runs
-- once, here; from then on the admin toggle owns the value.
UPDATE "Season" SET "cardsEnabled" = 0 WHERE "number" <= 4;
