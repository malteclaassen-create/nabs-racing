-- How the profile picture sits on the driver rating card (self-service on
-- /profile): JSON {"x":0-100,"y":0-100,"z":1-3}, null = default framing.
-- Mirrored by ensureAppSchema.
ALTER TABLE "Driver" ADD COLUMN "cardPhotoPos" TEXT;
