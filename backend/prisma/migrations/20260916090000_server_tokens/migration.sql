-- Server tokens: the league's reward currency (racing and invites earn them,
-- a small shop spends them). A TRIAL feature — the whole thing is behind the
-- `tokens_enabled` Setting, which is off on a deployment until an admin says
-- otherwise, so these tables can exist and stay empty.
--
-- No foreign keys on purpose: three self-contained tables that can be dropped
-- again in one go if the league decides against the idea.
--
-- Mirrored by ensureAppSchema, which creates the same tables at boot.

-- One row per member: their own invite code, and who invited THEM.
CREATE TABLE IF NOT EXISTS "TokenAccount" (
    "discordId"  TEXT NOT NULL PRIMARY KEY,
    "code"       TEXT NOT NULL,
    "referredBy" TEXT,
    "referredAt" DATETIME,
    "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "TokenAccount_code_key" ON "TokenAccount"("code");
CREATE INDEX IF NOT EXISTS "TokenAccount_referredBy_idx" ON "TokenAccount"("referredBy");

-- Append-only. A balance is SUM(delta) over these rows and never a stored
-- number; (discordId, refKey) is unique so the reconciliation in lib/tokens.js
-- can run on every page load without ever paying anybody twice.
CREATE TABLE IF NOT EXISTS "TokenLedger" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "discordId" TEXT NOT NULL,
    "delta"     INTEGER NOT NULL,
    "rule"      TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "detail"    TEXT,
    "refKey"    TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "TokenLedger_member_ref_key" ON "TokenLedger"("discordId", "refKey");
CREATE INDEX IF NOT EXISTS "TokenLedger_discordId_idx" ON "TokenLedger"("discordId");

-- A shop order. The member spends, an admin fills it by hand — or declines it,
-- which refunds the tokens.
CREATE TABLE IF NOT EXISTS "TokenRedemption" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "discordId" TEXT NOT NULL,
    "itemKey"   TEXT NOT NULL,
    "itemName"  TEXT NOT NULL,
    "cost"      INTEGER NOT NULL,
    "status"    TEXT NOT NULL DEFAULT 'NEW',
    "note"      TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME
);
CREATE INDEX IF NOT EXISTS "TokenRedemption_discordId_idx" ON "TokenRedemption"("discordId");
