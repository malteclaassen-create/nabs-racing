-- Discord login accounts (admin "Members" tab): every Discord account that has
-- logged in, whether or not it could be linked to a Driver. Enables manual
-- linking and banning. Managed via raw SQL at runtime (see src/lib/members.js).
CREATE TABLE IF NOT EXISTS "MemberAccount" (
    "discordId" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "firstLoginAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loginCount" INTEGER NOT NULL DEFAULT 1
);
