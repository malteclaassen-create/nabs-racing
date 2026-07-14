-- In-site notifications behind the nav-bar bell. recipientId null = broadcast
-- every member sees; a discordId = personal. dedupeKey (unique) makes event
-- writes idempotent. Mirrored by ensureAppSchema (raw SQL) for dev servers
-- that boot without migrate, hence IF NOT EXISTS everywhere.
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "recipientId" TEXT,
    "dedupeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");

-- When a member last opened the bell — everything newer counts as unread.
ALTER TABLE "MemberAccount" ADD COLUMN "notificationsSeenAt" DATETIME;
