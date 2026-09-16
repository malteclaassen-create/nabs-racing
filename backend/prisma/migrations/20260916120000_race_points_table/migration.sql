-- A round's own points table (JSON array for P1..Pn), null = the season's
-- table. Lets one round pay differently (a double-points finale, a one-off
-- format) without touching the season's rule. Mirrored by ensureAppSchema.
ALTER TABLE "Race" ADD COLUMN "pointsTable" TEXT;
