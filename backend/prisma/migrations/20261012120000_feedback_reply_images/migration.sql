-- Pictures on a feedback reply: a JSON list of { id, mime, size, name }, the
-- bytes themselves in feedback-files/ (see lib/feedbackFiles.js).
--
-- Written as the whole table, IF NOT EXISTS, rather than as an ALTER TABLE, for
-- the reason spelled out in 20260923090000_report_licence_points: SQLite has no
-- "ADD COLUMN IF NOT EXISTS", and a database a dev server has already booted
-- with this code has the column from ensureAppSchema, so an ALTER here would
-- fail with "duplicate column" and crash-loop the deploy. Where the table
-- already exists this is a no-op and ensureAppSchema adds the column at boot.
CREATE TABLE IF NOT EXISTS "FeedbackReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedbackId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "images" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "FeedbackReply_feedbackId_idx" ON "FeedbackReply"("feedbackId");
