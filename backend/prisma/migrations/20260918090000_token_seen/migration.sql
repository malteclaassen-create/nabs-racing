-- What a member has already been shown of their own token balance: the number
-- the nav bar last told them, and how far down the ledger that was.
--
-- Everything past those two is news, and news is what the little "+100" over
-- the token count is made of. Both null for an account that has never been
-- shown anything, so nobody's first visit celebrates their whole history.
--
-- Mirrored by ensureAppSchema, which adds the same two columns at boot.
ALTER TABLE "TokenAccount" ADD COLUMN "seenBalance" INTEGER;
ALTER TABLE "TokenAccount" ADD COLUMN "seenRowId" INTEGER;
