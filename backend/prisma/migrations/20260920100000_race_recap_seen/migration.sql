-- The round whose race recap a member has already been shown. The recap only
-- ever offers the newest finished round, so one id is the whole state: same
-- id as the newest round means nothing to show.
--
-- Mirrored by ensureAppSchema, which adds the column at boot.
ALTER TABLE "MemberAccount" ADD COLUMN "recapSeenRaceId" TEXT;
