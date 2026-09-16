-- The season's champion when the league decided it by a rule the points do
-- not express: a driver id of this season, null = most points wins. Mirrored
-- by ensureAppSchema for dev servers that boot without migrate.
ALTER TABLE "Season" ADD COLUMN "championDriverId" TEXT;
