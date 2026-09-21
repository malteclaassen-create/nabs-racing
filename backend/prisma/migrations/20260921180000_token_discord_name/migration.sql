-- The name Discord knows a member by, as the league's bot reads it off the
-- server. Only ever a fallback: somebody who was invited into the Discord and
-- has never opened the website has no login and no driver row, and the admin
-- list was left printing their eighteen-digit id where a name goes.
--
-- Mirrored by ensureAppSchema, which adds the same column at boot.
ALTER TABLE "TokenAccount" ADD COLUMN "discordName" TEXT;
