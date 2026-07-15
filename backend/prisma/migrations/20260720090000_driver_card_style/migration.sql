-- Which unlockable rating-card edition the driver picked for this season row
-- (a key from lib/cardEditions.js; null = classic). Per-row, since editions are
-- a season award. Mirrored by ensureAppSchema (raw SQL) for dev servers.
ALTER TABLE "Driver" ADD COLUMN "cardStyle" TEXT;
