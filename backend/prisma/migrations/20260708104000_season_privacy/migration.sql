-- Season visibility. Existing rows default to public (1); new seasons are
-- created private by the admin route and an active season is forced public.
-- Private seasons are hidden from every public read. Mirrored by ensureAppSchema.
ALTER TABLE "Season" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT 1;
