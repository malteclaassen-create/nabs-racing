-- Qualifying best lap (ms) per driver per race. Not populated by the current
-- AC import (RACE JSONs only) — reserved for a future qualifying-session
-- import so PAC can score the "gap to pole" (pole = the race's min qualiTimeMs).
-- Mirrored by ensureAppSchema (raw SQL) for dev servers that boot without
-- migrate, hence IF NOT EXISTS is unnecessary here (a plain migration column).
ALTER TABLE "RaceResult" ADD COLUMN "qualiTimeMs" INTEGER;
