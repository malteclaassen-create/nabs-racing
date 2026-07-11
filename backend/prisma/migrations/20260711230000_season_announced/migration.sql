-- "Coming up" announcement: when ON, an upcoming season advertises itself in
-- the Home/Welcome teaser strip even while it is still private. Mirrored by
-- ensureAppSchema.
ALTER TABLE "Season" ADD COLUMN "isAnnounced" BOOLEAN NOT NULL DEFAULT 0;
