// ---------------------------------------------------------------------------
// Where persistent data lives on disk — the ONE place that decides it.
//
// Without DATA_DIR everything stays in the folders directly under backend/
// (uploads/, downloads/, backups/, logs/), exactly as before, so local dev is
// unchanged. On hosts that wipe the filesystem on every deploy (e.g. Railway)
// set DATA_DIR to the mounted volume path (e.g. /data) and all four folders
// move under it. The SQLite database belongs on that volume too, but its path
// already comes from the environment via DATABASE_URL (e.g. file:/data/dev.db).
// ---------------------------------------------------------------------------
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url)); // backend/src/lib

const DATA_ROOT = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : join(__dir, "../.."); // backend/

export const UPLOADS_DIR = join(DATA_ROOT, "uploads");
export const DOWNLOADS_DIR = join(DATA_ROOT, "downloads");
export const BACKUPS_DIR = join(DATA_ROOT, "backups");
export const LOGS_DIR = join(DATA_ROOT, "logs");
// Raw AC result JSONs, kept after import so telemetry can be recomputed later
// (e.g. when the extractor improves) without re-downloading from the server.
export const RESULTS_ARCHIVE_DIR = join(DATA_ROOT, "results-archive");
// Pictures and clips attached to an incident report. Deliberately NOT under
// uploads/: that folder is mounted as static files and anybody with the URL can
// read it, while a report is a private conversation between two drivers and the
// stewards. These come back only through an endpoint that checks the thread's
// own read rules first.
export const REPORT_FILES_DIR = join(DATA_ROOT, "report-files");

// Pit-lane events observed on the live feed, per race (lib/pitEventsStore.js).
// The stored result JSON carries no pit data at all, so what is recorded here
// during a race is the only ground truth the importer will ever have.
export const LIVE_PITS_DIR = join(DATA_ROOT, "live-pits");
