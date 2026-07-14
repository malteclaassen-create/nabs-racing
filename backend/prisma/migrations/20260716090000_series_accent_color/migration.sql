-- Admin-picked accent colour per series (hex, e.g. "#6de0fc"). null = the
-- default NABS pink. Mirrored by ensureAppSchema.
ALTER TABLE "Series" ADD COLUMN "accentColor" TEXT;
