-- Feedback from the site's visitors: bug reports and feature wishes sent from
-- the floating Feedback button. discordId is filled in when the sender was
-- signed in, null for a logged-out visitor (who may leave a contact line).
-- Mirrored by ensureAppSchema (raw SQL) for dev servers that boot without
-- migrate, hence IF NOT EXISTS everywhere.
CREATE TABLE IF NOT EXISTS "Feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "pageUrl" TEXT,
    "userAgent" TEXT,
    "discordId" TEXT,
    "senderName" TEXT,
    "contact" TEXT,
    "adminNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME
);
CREATE INDEX IF NOT EXISTS "Feedback_createdAt_idx" ON "Feedback"("createdAt");
