-- Comments under news articles (lib/newsComments.js): text, a GIF, or both,
-- from any signed-in member. The author's name and picture are copied in when
-- the comment is written.
CREATE TABLE IF NOT EXISTS "NewsComment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "articleId" TEXT NOT NULL,
  "discordId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "driverId" TEXT,
  "body" TEXT NOT NULL DEFAULT '',
  "gifUrl" TEXT,
  "gifWidth" INTEGER,
  "gifHeight" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "NewsComment_articleId_createdAt_idx" ON "NewsComment"("articleId", "createdAt");
