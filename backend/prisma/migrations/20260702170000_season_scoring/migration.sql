-- Per-season scoring rules, editable in the admin panel:
--   dropWorst   = how many lowest-scoring rounds are dropped from season totals (0 = none)
--   pointsTable = JSON array of points for P1..Pn; NULL = league default table
ALTER TABLE "Season" ADD COLUMN "dropWorst" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Season" ADD COLUMN "pointsTable" TEXT;
