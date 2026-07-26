-- The Steam account a member proved through "Sign in through Steam".
-- Kept on the LOGIN account, not on the driver row: a fresh Discord login has
-- no Driver row yet (an admin may create it weeks later), and Driver.steamId is
-- per season anyway. The value is copied onto the driver row as soon as one
-- exists, so the AC result import can match a newcomer on their first race.
--
-- Mirrored idempotently in src/lib/ensureSchema.js for the dev database, which
-- is where the running server adds columns while the generated client is locked.
ALTER TABLE "MemberAccount" ADD COLUMN "steamId" TEXT;
ALTER TABLE "MemberAccount" ADD COLUMN "steamVerifiedAt" DATETIME;

-- One Steam account backs exactly one login. SQLite treats NULLs as distinct,
-- so every account without a linked Steam account stays unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "MemberAccount_steamId_key" ON "MemberAccount"("steamId");
