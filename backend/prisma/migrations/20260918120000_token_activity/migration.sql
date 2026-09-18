-- How active a member is on Discord, one row per member per DAY: the messages
-- they wrote and the minutes they sat in a voice channel.
--
-- The multiplier (backend/src/lib/tokenRules.js) sums the last thirty days,
-- counted afresh every day rather than per calendar month. That is why this is
-- a row per day and not a running total: a total can only grow, and a
-- multiplier that measures "lately" has to be able to fall back again.
--
-- Written by the league's Discord bot, which does not exist yet, so every
-- multiplier is a plain 1.0x until it does.
--
-- Mirrored by ensureAppSchema, which creates the same table at boot.
CREATE TABLE IF NOT EXISTS "TokenActivity" (
    "discordId" TEXT NOT NULL,
    "day"       TEXT NOT NULL,
    "messages"  INTEGER NOT NULL DEFAULT 0,
    "minutes"   INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("discordId", "day")
);
CREATE INDEX IF NOT EXISTS "TokenActivity_day_idx" ON "TokenActivity"("day");
