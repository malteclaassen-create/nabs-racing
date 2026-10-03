-- Second Discord account of the same person: the Discord id of their MAIN
-- account. A login through this account acts as the main one
-- (lib/accountLinks.js). Null for an ordinary account.
--
-- Mirrored by ensureAppSchema, which adds the column at boot.
ALTER TABLE "MemberAccount" ADD COLUMN "mainDiscordId" TEXT;
