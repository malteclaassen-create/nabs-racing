-- Rating card animation switch: null = the edition's own baseline motion
-- (glow band, sparkle, gloss sweep), 'off' = a fully still card. Self-service
-- on the Edit Driver Card page. Per-row like cardStyle.
ALTER TABLE "Driver" ADD COLUMN "cardAnim" TEXT;

-- Card-unlock notification bookkeeping: a JSON array of edition keys this row
-- has already been notified about, so a newly-earned card pings the driver's
-- bell exactly once (the first read seeds it silently). See lib/notifications.js.
-- Mirrored by ensureAppSchema (raw SQL) for dev servers.
ALTER TABLE "Driver" ADD COLUMN "cardUnlocksNotified" TEXT;
