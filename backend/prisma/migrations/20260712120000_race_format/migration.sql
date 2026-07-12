-- Per-race session format for the announcement post and the website's
-- upcoming-race panels: qualifying length in minutes and race distance in
-- laps. Both optional (null = not announced). Mirrored by ensureAppSchema.
ALTER TABLE "Race" ADD COLUMN "qualiMinutes" INTEGER;
ALTER TABLE "Race" ADD COLUMN "raceLaps" INTEGER;
