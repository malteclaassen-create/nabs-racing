-- Push notifications (lib/push.js): one row per device a member switched push
-- on for. `endpoint` is the browser's address at its push service; the two
-- keys are what the message is encrypted for. `discordId` is who the member
-- acts as, `loginId` the account that signed in on that device.
--
-- The member's choice of what gets pushed lives on the account
-- (MemberAccount.pushPrefs) and is NOT added here: an ALTER TABLE on a table
-- ensureAppSchema keeps fails with "duplicate column" on a database that has
-- already booted this code, and crash-loops the deploy (the full story is in
-- 20260923090000_report_licence_points). ensureAppSchema adds that column at
-- boot, the way it added every MemberAccount column before it.
CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "endpoint" TEXT NOT NULL PRIMARY KEY,
    "discordId" TEXT NOT NULL,
    "loginId" TEXT,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "device" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" DATETIME,
    "failures" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "PushSubscription_discordId_idx" ON "PushSubscription"("discordId");
