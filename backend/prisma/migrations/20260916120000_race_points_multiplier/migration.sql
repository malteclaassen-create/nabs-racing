-- Points multiplier of a round (1 = ordinary, 2 = double points, …), applied
-- to the points a result derives from its position in every classification
-- of the round. Mirrored by ensureAppSchema for dev servers that boot without
-- migrate.
ALTER TABLE "Race" ADD COLUMN "pointsMultiplier" INTEGER NOT NULL DEFAULT 1;
