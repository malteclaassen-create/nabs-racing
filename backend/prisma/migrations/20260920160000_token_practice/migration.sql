-- Training laps on the practice servers: one row per driver per race week per
-- server. The week is the sum of a driver's rows for it.
CREATE TABLE IF NOT EXISTS "TokenPractice" (
    "steamId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "server" TEXT NOT NULL DEFAULT '',
    "laps" INTEGER NOT NULL DEFAULT 0,
    "trackKey" TEXT,
    "car" TEXT,
    "lastAt" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("steamId", "series", "period", "server")
);
CREATE INDEX IF NOT EXISTS "TokenPractice_period_idx" ON "TokenPractice"("series","period");
