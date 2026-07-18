-- Admin-uploaded car image for the season's "coming soon" hero panel (the
-- showroom shot of the season's mod). null = fall back to the static
-- /cars/s<number>.jpg drop-in convention; if that is missing too, the hero
-- simply shows no car panel at all (no placeholder). Mirrored by
-- ensureAppSchema (raw SQL) for dev servers that boot without migrate.
ALTER TABLE "Season" ADD COLUMN "carImageUrl" TEXT;
