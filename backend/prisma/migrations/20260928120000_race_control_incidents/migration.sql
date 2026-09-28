-- Race control: collisions and stopped cars spotted live on the Emperor feed.
CREATE TABLE IF NOT EXISTS "Incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "server" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "sessionType" INTEGER,
    "sessionStart" REAL,
    "type" TEXT NOT NULL,
    "driverGuid" TEXT,
    "driverName" TEXT,
    "carId" INTEGER,
    "otherGuid" TEXT,
    "otherName" TEXT,
    "otherCarId" INTEGER,
    "atMs" REAL NOT NULL,
    "raceMs" REAL,
    "x" REAL,
    "z" REAL,
    "spline" REAL,
    "speedKmh" REAL,
    "endedAt" REAL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedBy" TEXT,
    "createdAtMs" REAL NOT NULL,
    "updatedAtMs" REAL
);
CREATE INDEX IF NOT EXISTS "Incident_session_idx" ON "Incident"("server","sessionKey","atMs");
