// ---------------------------------------------------------------------------
// Self-hosted download catalogue (Assetto Corsa resources: tracks, safety car,
// CSP, Real Penalty, the F1 car, replays…). The big binaries live on the host's
// disk under backend/downloads/ (placed there by the admin — far too large to
// push through a browser upload); the DB only stores each item's metadata and
// the on-disk file name. File sizes are read live from disk so they can't drift.
//
// The `Download` table is created/managed outside the generated Prisma client
// (raw SQL), matching this project's existing pattern where the running dev
// server locks the client engine on Windows.
// ---------------------------------------------------------------------------
import { dirname, join, basename } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, statSync, readdirSync } from "fs";
import { randomUUID } from "crypto";

const __dir = dirname(fileURLToPath(import.meta.url));
// backend/lib -> backend/downloads
export const DOWNLOADS_DIR = join(__dir, "../../downloads");

export function ensureDownloadsDir() {
  if (!existsSync(DOWNLOADS_DIR)) mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

export function fmtSize(bytes) {
  if (bytes == null) return null;
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

// Resolve a stored file name to an absolute path inside DOWNLOADS_DIR, guarding
// against path traversal: only a bare file name (no slashes) is accepted.
export function resolveDownloadPath(fileName) {
  if (!fileName) return null;
  const safe = basename(fileName);
  if (safe !== fileName) return null;
  return join(DOWNLOADS_DIR, safe);
}

export function statFile(fileName) {
  const p = resolveDownloadPath(fileName);
  if (!p || !existsSync(p)) return { exists: false, size: null };
  try { return { exists: true, size: statSync(p).size }; }
  catch { return { exists: false, size: null }; }
}

// Every file currently sitting in the downloads dir (so the admin can register
// files they've just dropped onto the server).
export function listDiskFiles() {
  ensureDownloadsDir();
  return readdirSync(DOWNLOADS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name !== ".gitkeep")
    .map((d) => {
      const size = statSync(join(DOWNLOADS_DIR, d.name)).size;
      return { fileName: d.name, size, sizeText: fmtSize(size) };
    });
}

// Plain, JSON-safe shape (raw SQLite rows can carry BigInt for INTEGER columns).
export function shapeDownload(r) {
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    description: r.description ?? null,
    version: r.version ?? null,
    installNote: r.installNote ?? null,
    fileName: r.fileName ?? null,
    externalUrl: r.externalUrl ?? null,
    sortOrder: Number(r.sortOrder) || 0,
    published: !!Number(r.published),
  };
}

// --- raw-SQL data access ---------------------------------------------------
export async function dbListDownloads(prisma, { publishedOnly = false } = {}) {
  return publishedOnly
    ? prisma.$queryRaw`SELECT * FROM "Download" WHERE "published" = 1 ORDER BY "category" ASC, "sortOrder" ASC, "title" ASC`
    : prisma.$queryRaw`SELECT * FROM "Download" ORDER BY "category" ASC, "sortOrder" ASC, "title" ASC`;
}

export async function dbGetDownload(prisma, id) {
  const rows = await prisma.$queryRaw`SELECT * FROM "Download" WHERE "id" = ${id} LIMIT 1`;
  return rows[0] || null;
}

export async function dbCreateDownload(prisma, d) {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "Download"
      ("id","title","category","description","version","installNote","fileName","externalUrl","sortOrder","published")
    VALUES
      (${id}, ${d.title}, ${d.category}, ${d.description ?? null}, ${d.version ?? null}, ${d.installNote ?? null},
       ${d.fileName ?? null}, ${d.externalUrl ?? null}, ${Number(d.sortOrder) || 0}, ${d.published ? 1 : 0})`;
  return dbGetDownload(prisma, id);
}

export async function dbUpdateDownload(prisma, id, d) {
  await prisma.$executeRaw`
    UPDATE "Download" SET
      "title" = ${d.title},
      "category" = ${d.category},
      "description" = ${d.description ?? null},
      "version" = ${d.version ?? null},
      "installNote" = ${d.installNote ?? null},
      "fileName" = ${d.fileName ?? null},
      "externalUrl" = ${d.externalUrl ?? null},
      "sortOrder" = ${Number(d.sortOrder) || 0},
      "published" = ${d.published ? 1 : 0}
    WHERE "id" = ${id}`;
  return dbGetDownload(prisma, id);
}

export async function dbDeleteDownload(prisma, id) {
  await prisma.$executeRaw`DELETE FROM "Download" WHERE "id" = ${id}`;
}
