-- A newcomer who signed themselves up (lib/newcomers.js). newDriverAt: when
-- the site made their reserve driver by itself, cleared once an admin keeps
-- them. turnedAwayAt: when an admin turned them away; the site does not sign
-- them up on its own again until an admin links them or creates their driver.
--
-- manualLinkAt: when an admin took the login off its driver by hand; only an
-- admin links it again. Driver.selfMadeAt: a row the site made by itself for a
-- newcomer nobody has checked, which no name match may land on.
--
-- Mirrored by ensureAppSchema, which adds the columns at boot.
ALTER TABLE "MemberAccount" ADD COLUMN "newDriverAt" DATETIME;
ALTER TABLE "MemberAccount" ADD COLUMN "turnedAwayAt" DATETIME;
ALTER TABLE "MemberAccount" ADD COLUMN "manualLinkAt" DATETIME;
ALTER TABLE "Driver" ADD COLUMN "selfMadeAt" DATETIME;
