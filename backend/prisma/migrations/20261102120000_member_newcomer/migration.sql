-- A newcomer who signed themselves up (lib/newcomers.js). newDriverAt: when
-- the site made their reserve driver by itself, cleared once an admin keeps
-- them. turnedAwayAt: when an admin turned them away; the site does not sign
-- them up on its own again until an admin links them or creates their driver.
--
-- Mirrored by ensureAppSchema, which adds the columns at boot.
ALTER TABLE "MemberAccount" ADD COLUMN "newDriverAt" DATETIME;
ALTER TABLE "MemberAccount" ADD COLUMN "turnedAwayAt" DATETIME;
