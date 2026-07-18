-- Full qualifying classification per race, distilled from the AC QUALIFY
-- result JSON: {track, date, entries: [{position, driverId, name, bestLapMs,
-- carModel}]}. Kept as a JSON blob on the race (a quali entrant may have no
-- RaceResult row at all, e.g. qualified but did not start), while each matched
-- driver's best lap ALSO lands in RaceResult.qualiTimeMs for the ratings.
-- Mirrored by ensureAppSchema (raw SQL) for dev servers that boot without
-- migrate.
ALTER TABLE "Race" ADD COLUMN "qualiJson" TEXT;
