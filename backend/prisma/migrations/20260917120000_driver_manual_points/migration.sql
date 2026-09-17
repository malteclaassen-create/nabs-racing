-- Manual points per driver row (= per season): "pointsAdjust" is added to the
-- computed season total (negative = a deduction), "pointsOverride" replaces it
-- outright. Both null = the season's own scoring decides. Mirrored by
-- ensureAppSchema for dev servers that boot without migrate.
ALTER TABLE "Driver" ADD COLUMN "pointsAdjust" INTEGER;
ALTER TABLE "Driver" ADD COLUMN "pointsOverride" INTEGER;
