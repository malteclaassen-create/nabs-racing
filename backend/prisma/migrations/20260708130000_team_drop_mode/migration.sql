-- How the team drop (teamDropWorst) counts: null/'results' = the N lowest
-- single-driver round scores, 'rounds' = the N lowest whole team round totals
-- (the official sheet's style). Mirrored by ensureAppSchema for the dev server.
ALTER TABLE "Season" ADD COLUMN "teamDropMode" TEXT;
