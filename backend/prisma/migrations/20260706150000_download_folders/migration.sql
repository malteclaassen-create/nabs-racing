-- Download folders: admin-created groups for the public Downloads page.
-- NOTE: on the live dev DB these statements are also applied at server boot by
-- ensureDownloadTables() in src/lib/downloads.js (raw SQL, IF NOT EXISTS /
-- guarded ALTER), because the running dev server locks the Prisma client on
-- Windows. This file keeps `prisma migrate` in sync for fresh databases.

CREATE TABLE IF NOT EXISTS "DownloadFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE "Download" ADD COLUMN "folderId" TEXT;
