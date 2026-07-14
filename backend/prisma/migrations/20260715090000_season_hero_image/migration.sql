-- Admin-uploaded hero photo override for a season's Home/Welcome main card.
-- null = fall back to the static /heroes/s<number>.jpg drop-in convention,
-- then the shared /hero.jpg. Mirrored by ensureAppSchema.
ALTER TABLE "Season" ADD COLUMN "heroImageUrl" TEXT;
