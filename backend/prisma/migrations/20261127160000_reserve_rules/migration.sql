-- Which seats a reserve may take over on the Driver Market, set per driver by
-- an admin (lib/reserveRules.js). div1Rule: null = any Division 1 seat,
-- 'never' = none, 'cover' = only for a round where one of the drivers in
-- div1Cover (a JSON array of driver ids of the same season) is out. noSubIn:
-- no seat at all, in either division.
--
-- Mirrored by ensureAppSchema, which adds the columns at boot.
ALTER TABLE "Driver" ADD COLUMN "div1Rule" TEXT;
ALTER TABLE "Driver" ADD COLUMN "div1Cover" TEXT;
ALTER TABLE "Driver" ADD COLUMN "noSubIn" BOOLEAN NOT NULL DEFAULT 0;
