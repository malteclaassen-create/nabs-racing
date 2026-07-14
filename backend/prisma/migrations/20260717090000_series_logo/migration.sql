-- Admin-uploaded dark-mode logo mark per series. null = the shared default
-- logo-dark.png. Mirrored by ensureAppSchema.
ALTER TABLE "Series" ADD COLUMN "logoDarkUrl" TEXT;
