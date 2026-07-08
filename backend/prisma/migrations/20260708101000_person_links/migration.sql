-- Cross-season person links: one row per driver row that belongs to a person;
-- all driver rows of the same person share one personId. Managed via raw SQL
-- (backend/src/lib/persons.js + ensureAppSchema) like MemberAccount/Download.
CREATE TABLE IF NOT EXISTS "PersonLink" (
    "driverId" TEXT NOT NULL PRIMARY KEY,
    "personId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PersonLink_personId_idx" ON "PersonLink"("personId");
