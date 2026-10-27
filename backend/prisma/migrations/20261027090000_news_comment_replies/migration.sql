-- Replies to news comments (lib/newsComments.js). One level deep: a reply sits
-- under the comment that opened the thread (parentId); an answer to a reply
-- joins the same thread and names whom it answers (replyToName).
ALTER TABLE "NewsComment" ADD COLUMN "parentId" TEXT;
ALTER TABLE "NewsComment" ADD COLUMN "replyToName" TEXT;
CREATE INDEX IF NOT EXISTS "NewsComment_parentId_idx" ON "NewsComment"("parentId");
