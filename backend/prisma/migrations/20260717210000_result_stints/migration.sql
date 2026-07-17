-- Tyre stints per result (JSON [{tyre, laps}], from the AC file's per-lap
-- Tyre field). Mirrored by ensureAppSchema for the running dev server.
ALTER TABLE "RaceResult" ADD COLUMN "stints" TEXT;
