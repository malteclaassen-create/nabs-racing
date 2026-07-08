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
