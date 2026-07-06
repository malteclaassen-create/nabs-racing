// ---------------------------------------------------------------------------
// Database backups. SQLite's `VACUUM INTO` writes a consistent snapshot of the
// live database to a new file — safe to run while the server is serving
// requests. Backups land in backend/backups/ and the newest KEEP_N are kept.
//
// An automatic backup runs before every results save (import commit / editor
// save), so any mistake is one file-copy away from being undone: stop the
// server, copy the backup file over prisma/dev.db, start again.
// ---------------------------------------------------------------------------
import { mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { dirname, join, basename } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
export const BACKUP_DIR = join(__dir, "../../backups");

const KEEP_N = 40;

// A backup file name: nabs-20260703-142530-r11.db
function backupName(label) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const safe = String(label || "manual").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40);
  return `nabs-${stamp}-${safe}.db`;
}

export async function createBackup(prisma, label) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = join(BACKUP_DIR, backupName(label));
  // SQLite quotes: escape single quotes by doubling; use forward slashes so
  // the path survives on Windows too.
  const sqlitePath = file.replace(/\\/g, "/").replace(/'/g, "''");
  await prisma.$executeRawUnsafe(`VACUUM INTO '${sqlitePath}'`);
  pruneBackups();
  const st = statSync(file);
  return { file: basename(file), size: st.size, createdAt: st.mtime };
}

// Best-effort variant for automatic pre-save snapshots: a failing backup must
// never block the actual save. Returns the backup info or null.
export async function tryCreateBackup(prisma, label) {
  try {
    return await createBackup(prisma, label);
  } catch (e) {
    console.error(`Automatic backup failed (continuing with the save):`, e.message);
    return null;
  }
}

export function listBackups() {
  let files;
  try {
    files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".db"));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      const st = statSync(join(BACKUP_DIR, f));
      return { file: f, size: st.size, createdAt: st.mtime };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function pruneBackups() {
  const files = listBackups();
  for (const f of files.slice(KEEP_N)) {
    try {
      unlinkSync(join(BACKUP_DIR, f.file));
    } catch {
      /* ignore */
    }
  }
}
