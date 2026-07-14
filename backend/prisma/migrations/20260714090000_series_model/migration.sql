-- Multi-series support: a Series is the level above Season (Friday F1, Sunday
-- GT, ...). Additive + idempotent backfill: all existing seasons land in one
-- default series ("friday-f1"), which becomes the active/primary one, so a
-- single-series site looks and behaves exactly as before. Mirrored by
-- ensureAppSchema (raw SQL) for dev servers that boot without migrate.
CREATE TABLE IF NOT EXISTS "Series" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "game" TEXT,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Series_slug_key" ON "Series"("slug");

-- Which series a season belongs to. Plain TEXT column (no FK) so it can be
-- added without a table rebuild — same pattern as the other raw-SQL columns.
ALTER TABLE "Season" ADD COLUMN "seriesId" TEXT;

-- Backfill: one default series carrying every existing season. The slug is the
-- URL identity and must stay stable after creation; the NAME is what the admin
-- may rename later.
INSERT INTO "Series" ("id", "name", "slug", "order", "isActive", "isPublic")
SELECT 'friday-f1', 'NABS Racing League', 'friday-f1', 0, true, true
WHERE NOT EXISTS (SELECT 1 FROM "Series");

UPDATE "Season"
SET "seriesId" = (SELECT "id" FROM "Series" WHERE "isActive" = true ORDER BY "order" LIMIT 1)
WHERE "seriesId" IS NULL;

-- Season numbers are now unique PER SERIES (a second series can have its own
-- "Season 1"), mirroring how Race.number is unique per season.
DROP INDEX IF EXISTS "Season_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Season_seriesId_number_key" ON "Season"("seriesId", "number");
