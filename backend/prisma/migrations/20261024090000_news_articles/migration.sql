-- The news desk (lib/news.js): the league's articles. Drafts and published
-- ones, written by a person or by the site itself after a round (source AUTO,
-- at most one per round via the partial unique index).
CREATE TABLE IF NOT EXISTS "NewsArticle" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "body" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT 'RACES',
  "coverUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "raceId" TEXT,
  "authorDiscordId" TEXT,
  "authorName" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS "NewsArticle_slug_key" ON "NewsArticle"("slug");
CREATE INDEX IF NOT EXISTS "NewsArticle_status_publishedAt_idx" ON "NewsArticle"("status", "publishedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "NewsArticle_auto_race_key" ON "NewsArticle"("raceId") WHERE "source" = 'AUTO';
