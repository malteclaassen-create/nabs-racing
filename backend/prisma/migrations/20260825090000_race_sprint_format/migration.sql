-- Sprint + feature race weekends (F2 style): one event that runs a shorter
-- sprint before the main race. `raceFormat` says which shape the weekend has
-- ('SINGLE' = one race, as every round was until now; 'SPRINT_FEATURE' = sprint
-- then feature), `sprintLaps` is the sprint distance (optional, null = TBA).
-- The existing `raceLaps` stays the main race — the feature — so nothing that
-- already reads it has to change. Mirrored by ensureAppSchema.
ALTER TABLE "Race" ADD COLUMN "raceFormat" TEXT NOT NULL DEFAULT 'SINGLE';
ALTER TABLE "Race" ADD COLUMN "sprintLaps" INTEGER;
