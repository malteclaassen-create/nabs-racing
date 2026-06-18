-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "color" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "discordName" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Driver_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Race" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "track" TEXT NOT NULL,
    "date" DATETIME,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "RaceResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raceId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "position" INTEGER,
    "points" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'FINISHED',
    "subForTeamId" TEXT,
    "penaltyPositions" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RaceResult_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RaceResult_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RaceResult_subForTeamId_fkey" FOREIGN KEY ("subForTeamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConstructorRaceScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raceId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ConstructorRaceScore_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConstructorRaceScore_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DriverSignup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discordName" TEXT NOT NULL,
    "preferredTeam" TEXT,
    "experience" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Race_number_key" ON "Race"("number");

-- CreateIndex
CREATE UNIQUE INDEX "RaceResult_raceId_driverId_key" ON "RaceResult"("raceId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructorRaceScore_raceId_teamId_tier_key" ON "ConstructorRaceScore"("raceId", "teamId", "tier");
