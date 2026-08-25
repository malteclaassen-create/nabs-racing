-- The team a result was driven for, stamped when the round is saved.
--
-- A Driver row holds one team for the whole season, so "the team of this
-- result" used to mean "the team that driver is in today". Moving somebody to
-- another team mid-season therefore rewrote every round they had already
-- driven: the result tables, the race hero and the poster all followed them to
-- the new team. Constructor points were never affected (ConstructorRaceScore
-- freezes those per round), which is why this went unnoticed for so long.
--
-- The backfill copies the state as it is right now, so nothing on the site
-- changes today. It only stops the NEXT transfer from reaching backwards.
-- Mirrored by ensureAppSchema, which backfills the same way on first boot.
ALTER TABLE "RaceResult" ADD COLUMN "teamId" TEXT;

UPDATE "RaceResult"
   SET "teamId" = (SELECT "teamId" FROM "Driver" WHERE "Driver"."id" = "RaceResult"."driverId")
 WHERE "teamId" IS NULL;
