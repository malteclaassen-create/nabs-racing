-- The highlights video of a finished round: one pasted link per race, shown as
-- a "Highlights" button on the race results next to Report and Replay. Any
-- http(s) address (YouTube plays inline, anything else opens in a new tab).
-- Mirrored by ensureAppSchema (raw SQL) for dev servers that boot without migrate.
ALTER TABLE "Race" ADD COLUMN "highlightsUrl" TEXT;
