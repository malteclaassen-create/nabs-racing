-- Training laps on the practice server, one row per driver per race week.
CREATE TABLE IF NOT EXISTS "TokenPractice" (
    "steamId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "laps" INTEGER NOT NULL DEFAULT 0,
    "trackKey" TEXT,
    "car" TEXT,
    "lastAt" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("steamId", "series", "period")
);
CREATE INDEX IF NOT EXISTS "TokenPractice_period_idx" ON "TokenPractice"("series","period");
