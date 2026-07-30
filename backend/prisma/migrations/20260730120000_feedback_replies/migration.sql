-- The conversation about a piece of feedback: the admins' answer (author ADMIN)
-- and the sender writing back (author SENDER). Only feedback from a signed-in
-- member can have a thread — a logged-out sender has no account to answer to.
-- Mirrored by ensureAppSchema (raw SQL) for dev servers that boot without
-- migrate, hence IF NOT EXISTS everywhere.
CREATE TABLE IF NOT EXISTS "FeedbackReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedbackId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "FeedbackReply_feedbackId_idx" ON "FeedbackReply"("feedbackId");
