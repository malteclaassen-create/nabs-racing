-- Track flag country (ISO 3166-1 alpha-2, lowercase) per race. Mirrored by
-- ensureAppSchema for the running dev server; backfill happens there too.
ALTER TABLE "Race" ADD COLUMN "country" TEXT;
