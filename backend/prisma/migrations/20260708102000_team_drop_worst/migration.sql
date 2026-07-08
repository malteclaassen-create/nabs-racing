-- Team-level drop rule. null = legacy behaviour (teams inherit each driver's
-- own dropped rounds); 0 = no team drop; N = drop the N lowest single-driver
-- round contributions from each team's total. Mirrored by ensureAppSchema.
ALTER TABLE "Season" ADD COLUMN "teamDropWorst" INTEGER;
