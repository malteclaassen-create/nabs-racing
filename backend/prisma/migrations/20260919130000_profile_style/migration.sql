-- What a member has put on their public profile page from the profile studio:
-- one row per member, one column per slot (the design id, owned via
-- TokenRedemption), plus the personal settings as JSON.
CREATE TABLE IF NOT EXISTS "ProfileStyle" (
  "discordId" TEXT NOT NULL PRIMARY KEY,
  "theme" TEXT, "banner" TEXT, "frame" TEXT, "nameplate" TEXT,
  "stats" TEXT, "trophies" TEXT, "showcase" TEXT, "effect" TEXT,
  "content" TEXT,
  "updatedAt" DATETIME
);
