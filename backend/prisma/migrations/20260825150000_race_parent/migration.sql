-- Sprint classifications of a sprint+feature weekend (see 20260825090000):
-- the sprint's result lives on its own hidden Race row pointing back at the
-- event it belongs to. RaceResult is unique per (race, driver), so a second
-- classification for the same evening needs a second race row — this link is
-- what keeps that row glued to its event instead of floating in the calendar.
-- Mirrored by ensureAppSchema.
ALTER TABLE "Race" ADD COLUMN "parentRaceId" TEXT;
