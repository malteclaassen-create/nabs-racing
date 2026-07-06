-- Official final standings for archived seasons (Seasons 1-6), imported from
-- the old league sheets. JSON: { "drivers":[{driverId,points}], "teams":[{teamId,points}] }.
-- When set, these totals & their order are authoritative in the standings service.
ALTER TABLE "Season" ADD COLUMN "finalStandings" TEXT;
