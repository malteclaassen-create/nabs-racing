// ---------------------------------------------------------------------------
// Database backups. SQLite's `VACUUM INTO` writes a consistent snapshot of the
// live database to a new file — safe to run while the server is serving
// requests. Backups land in backend/backups/ and the newest KEEP_N are kept.
//
// An automatic backup runs before every results save (import commit / editor
// save), so any mistake is one file-copy away from being undone: stop the
// server, copy the backup file over prisma/dev.db, start again.
// ---------------------------------------------------------------------------
import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from "fs";
import { join, basename } from "path";
import archiver from "archiver";
import { BACKUPS_DIR as BACKUP_DIR, UPLOADS_DIR } from "../lib/dataDirs.js";

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

// Full backup as one zip, meant to be DOWNLOADED and stored away from this
// machine: a fresh consistent DB snapshot plus everything under uploads/
// (team logos, avatars, hero images, race photos). The big AC files in
// downloads/ are deliberately excluded — they are gigabytes and can be
// restored from the original mod archives; the DB and uploads cannot.
//
// STREAMED into the response while it's being built. The old version
// assembled the whole archive in memory and only then sent the first byte —
// with a season's worth of race photos that meant a long dead silence, and on
// the deployed instance the proxy killed the idle request (or the container
// ran out of memory) before a single byte arrived: the admin clicked, nothing
// downloaded, and it eventually just aborted. Streaming starts the download
// immediately and keeps memory flat. Images are STORED rather than deflated
// (they're already compressed); the DB snapshot still shrinks well.
export async function streamFullBackupZip(prisma, res) {
  const snap = await createBackup(prisma, "full-download");
  const stamp = snap.file.replace(/^nabs-/, "").replace(/-full-download\.db$/, "");
  const name = `nabs-full-backup-${stamp}.zip`;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);

  const archive = archiver("zip", { zlib: { level: 6 } });
  // A failed disk walk must kill the response, not leave it hanging forever.
  archive.on("error", (err) => {
    console.error("Full backup stream failed:", err.message);
    res.destroy(err);
  });
  // Download cancelled in the browser: stop reading the disk.
  res.on("close", () => {
    if (!res.writableEnded) archive.destroy();
  });

  archive.pipe(res);
  // The snapshot goes in under the name the server expects on restore.
  archive.file(join(BACKUP_DIR, snap.file), { name: "dev.db" });
  if (existsSync(UPLOADS_DIR)) {
    archive.directory(UPLOADS_DIR, "uploads", (entry) => ({ ...entry, store: true }));
  }
  await archive.finalize();
  return { name };
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

// A snapshot file name as this service writes them, and nothing else — the
// delete endpoints go through this so a request can only ever name a backup,
// never reach for another file on the disk.
const isBackupFile = (name) => /^nabs-[a-z0-9-]+\.db$/i.test(String(name || "")) && basename(name) === name;

// Delete ONE snapshot by name. True when it's gone, false for a name that
// isn't a backup or doesn't exist.
export function deleteBackup(file) {
  if (!isBackupFile(file)) return false;
  const p = join(BACKUP_DIR, file);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

// Keep the newest `keep` snapshots, delete the rest. Returns how many went.
// The automatic KEEP_N cap stays what it is — this is the admin's hand, for
// "the old ones can go now", not a change to the standing rule.
export function pruneBackupsTo(keep) {
  const n = Math.max(1, Math.min(KEEP_N, Math.round(Number(keep) || 0)));
  const files = listBackups();
  let removed = 0;
  for (const f of files.slice(n)) {
    try {
      unlinkSync(join(BACKUP_DIR, f.file));
      removed++;
    } catch {
      /* ignore */
    }
  }
  return removed;
}
