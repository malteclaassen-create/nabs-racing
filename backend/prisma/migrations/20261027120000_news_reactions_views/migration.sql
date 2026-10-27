-- Emoji reactions on news articles and their comments, and how often an
-- article has been opened (lib/newsReactions.js).
CREATE TABLE IF NOT EXISTS "NewsReaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "articleId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "discordId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "NewsReaction_target_member_emoji_key" ON "NewsReaction"("targetType", "targetId", "discordId", "emoji");
CREATE INDEX IF NOT EXISTS "NewsReaction_articleId_idx" ON "NewsReaction"("articleId");

CREATE TABLE IF NOT EXISTS "NewsView" (
  "articleId" TEXT NOT NULL PRIMARY KEY,
  "views" INTEGER NOT NULL DEFAULT 0
);
