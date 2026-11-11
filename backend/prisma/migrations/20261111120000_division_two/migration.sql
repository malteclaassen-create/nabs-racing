-- Division 2: a second field racing the same evening on the second server,
-- with teams of its own (Team.tier 3) and standings of its own. Its result
-- sits on a hidden child Race row like a sprint's (parentRaceId), told apart
-- by "division" = 2. "capacity2" is that field's grid size (null = the
-- round's own capacity). Season."division2" switches the division on for a
-- season; Driver."division" = 2 puts a reserve into the Division 2 pool.
-- Mirrored by ensureAppSchema (lib/divisions.js).
ALTER TABLE "Race" ADD COLUMN "division" INTEGER;
ALTER TABLE "Race" ADD COLUMN "capacity2" INTEGER;
ALTER TABLE "Season" ADD COLUMN "division2" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "Driver" ADD COLUMN "division" INTEGER;
