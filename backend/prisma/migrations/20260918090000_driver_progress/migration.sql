-- The staff's judgement on a driver row (= per season), set by hand in the
-- admin Attendance tab's Activity view: FULL_TIME / POSSIBLY_RESERVE /
-- DESERVING / IN_PROGRESS / TENTATIVE, or null for a driver nobody has formed
-- a view on. Nothing computes it and nothing scores off it — see
-- lib/driverProgress.js. Mirrored by ensureAppSchema for dev servers that boot
-- without migrate.
ALTER TABLE "Driver" ADD COLUMN "progress" TEXT;
