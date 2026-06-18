-- Driver: link to a Discord account (forgery-proof RSVP)
ALTER TABLE "Driver" ADD COLUMN "discordUserId" TEXT;

-- Race: grid capacity + optional event info (Apollo-style)
ALTER TABLE "Race" ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 40;
ALTER TABLE "Race" ADD COLUMN "info" TEXT;

-- Unique link between a Discord user and a driver
CREATE UNIQUE INDEX "Driver_discordUserId_key" ON "Driver"("discordUserId");
