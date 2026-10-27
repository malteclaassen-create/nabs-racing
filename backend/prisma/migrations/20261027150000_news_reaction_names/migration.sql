-- Who put a reaction on a news article or comment (lib/newsReactions.js): the
-- member's name, copied in when they react.
ALTER TABLE "NewsReaction" ADD COLUMN "authorName" TEXT;
