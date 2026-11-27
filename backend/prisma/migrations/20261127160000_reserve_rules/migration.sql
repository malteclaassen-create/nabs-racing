-- What a reserve may do, set per driver by an admin (lib/reserveRules.js).
-- div1Rule: null = signs up for Division 1 like any reserve, 'never' = may
-- not, 'cover' = only for a round where one of the drivers in div1Cover (a
-- JSON array of driver ids of the same season) is out. noSubIn: may not take
-- over a seat on the Driver Market.
--
-- Mirrored by ensureAppSchema, which adds the columns at boot.
ALTER TABLE "Driver" ADD COLUMN "div1Rule" TEXT;
ALTER TABLE "Driver" ADD COLUMN "div1Cover" TEXT;
ALTER TABLE "Driver" ADD COLUMN "noSubIn" BOOLEAN NOT NULL DEFAULT 0;
