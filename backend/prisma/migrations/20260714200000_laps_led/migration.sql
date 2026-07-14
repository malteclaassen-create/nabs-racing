-- Laps led per driver per race: the car ranked first across the start/finish
-- line each lap led that lap (grid lap excluded, safety-car laps counted).
-- A heuristic, same lap-granularity limits as the overtake estimate. Mirrored
-- by ensureAppSchema (backend/src/lib/ensureSchema.js) for the running dev server.
ALTER TABLE "RaceResult" ADD COLUMN "lapsLed" INTEGER;
