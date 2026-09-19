-- What a round was worth per driver, stamped when the round was first saved.
CREATE TABLE IF NOT EXISTS "TokenRaceRate" (
    "raceId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "stampedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("raceId", "driverId")
);
