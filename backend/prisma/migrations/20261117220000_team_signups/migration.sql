-- Team sign-ups for a coming season: the form on a series' home page where a
-- member asks for a team and names the two drivers (the second may stay
-- empty). One entry per Discord account per sign-up (series + its name, e.g.
-- "Season 7"). Mirrored by ensureAppSchema (lib/teamSignups.js), hence
-- IF NOT EXISTS everywhere.
CREATE TABLE IF NOT EXISTS "TeamSignup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "senderName" TEXT,
    "teamName" TEXT NOT NULL,
    "driver1" TEXT NOT NULL,
    "driver2" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS "TeamSignup_seriesId_label_discordId_key" ON "TeamSignup"("seriesId", "label", "discordId");
