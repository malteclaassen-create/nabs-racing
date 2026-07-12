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
import { join, basename } from "path";
import { existsSync, mkdirSync, statSync, readdirSync } from "fs";
import { randomUUID } from "crypto";
import { DOWNLOADS_DIR } from "./dataDirs.js";

export { DOWNLOADS_DIR };

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
    folderId: r.folderId ?? null,
    // The race this entry belongs to (replays): links the entry to the round
    // so the Races page can offer a "Replay" button on that round.
    raceId: r.raceId ?? null,
    description: r.description ?? null,
    version: r.version ?? null,
    installNote: r.installNote ?? null,
    fileName: r.fileName ?? null,
    externalUrl: r.externalUrl ?? null,
    sortOrder: Number(r.sortOrder) || 0,
    published: !!Number(r.published),
  };
}

export function shapeFolder(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    sortOrder: Number(r.sortOrder) || 0,
  };
}

// --- schema upkeep (raw SQL, same reasoning as the Download table itself) ---
// Runs once at server boot: creates the folder table, adds Download.folderId,
// and turns any legacy free-text categories into real folders so nothing that
// was already registered disappears from the page.
export async function ensureDownloadTables(prisma) {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "DownloadFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
  )`);
  const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("Download")`);
  if (!cols.some((c) => c.name === "folderId")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Download" ADD COLUMN "folderId" TEXT`);
  }
  // Replays: a download can belong to a specific race (null = ordinary file).
  if (!cols.some((c) => c.name === "raceId")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Download" ADD COLUMN "raceId" TEXT`);
  }
  // One-time migration: category -> folder (only for rows not yet in a folder).
  const orphans = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT "category" FROM "Download" WHERE "folderId" IS NULL AND "category" IS NOT NULL AND "category" != ''`
  );
  for (const { category } of orphans) {
    let folder = (await prisma.$queryRaw`SELECT * FROM "DownloadFolder" WHERE "name" = ${category} LIMIT 1`)[0];
    if (!folder) folder = await dbCreateFolder(prisma, { name: category });
    await prisma.$executeRaw`UPDATE "Download" SET "folderId" = ${folder.id} WHERE "folderId" IS NULL AND "category" = ${category}`;
  }
}

// --- folder data access ------------------------------------------------------
export async function dbListFolders(prisma) {
  return (await prisma.$queryRaw`SELECT * FROM "DownloadFolder" ORDER BY "sortOrder" ASC, "name" ASC`)
    .map(shapeFolder);
}

export async function dbGetFolder(prisma, id) {
  const rows = await prisma.$queryRaw`SELECT * FROM "DownloadFolder" WHERE "id" = ${id} LIMIT 1`;
  return shapeFolder(rows[0]);
}

export async function dbCreateFolder(prisma, f) {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "DownloadFolder" ("id","name","description","sortOrder")
    VALUES (${id}, ${f.name}, ${f.description ?? null}, ${Number(f.sortOrder) || 0})`;
  return dbGetFolder(prisma, id);
}

export async function dbUpdateFolder(prisma, id, f) {
  await prisma.$executeRaw`
    UPDATE "DownloadFolder" SET
      "name" = ${f.name},
      "description" = ${f.description ?? null},
      "sortOrder" = ${Number(f.sortOrder) || 0}
    WHERE "id" = ${id}`;
  return dbGetFolder(prisma, id);
}

// Deleting a folder never deletes its downloads; they just become unfiled.
export async function dbDeleteFolder(prisma, id) {
  await prisma.$executeRaw`UPDATE "Download" SET "folderId" = NULL WHERE "folderId" = ${id}`;
  await prisma.$executeRaw`DELETE FROM "DownloadFolder" WHERE "id" = ${id}`;
}

// The shared "Replays" folder: race-linked downloads land here automatically
// when the admin didn't pick a folder. Created on first use, found by name
// afterwards (case-insensitive, so a hand-made "replays" folder is reused).
export async function ensureReplaysFolder(prisma) {
  const rows = await prisma.$queryRaw`SELECT * FROM "DownloadFolder" WHERE LOWER("name") = 'replays' LIMIT 1`;
  if (rows[0]) return shapeFolder(rows[0]);
  return dbCreateFolder(prisma, {
    name: "Replays",
    description: "Race replays, one per round. Load them in Assetto Corsa to rewatch the race.",
    sortOrder: 99,
  });
}

// Map raceId -> download id for PUBLISHED race-linked entries (the Races page
// uses this to show a Replay button on rounds that have one). Empty map when
// the column doesn't exist yet (fresh checkout before ensureDownloadTables).
export async function dbReplaysByRace(prisma, raceIds) {
  const ids = [...new Set((raceIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const ph = ids.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "raceId" FROM "Download" WHERE "published" = 1 AND "raceId" IN (${ph}) ORDER BY "sortOrder" ASC`,
      ...ids
    );
    const out = new Map();
    for (const r of rows) if (!out.has(r.raceId)) out.set(r.raceId, r.id);
    return out;
  } catch {
    return new Map();
  }
}

// --- raw-SQL data access ---------------------------------------------------
export async function dbListDownloads(prisma, { publishedOnly = false } = {}) {
  return publishedOnly
    ? prisma.$queryRaw`SELECT * FROM "Download" WHERE "published" = 1 ORDER BY "sortOrder" ASC, "title" ASC`
    : prisma.$queryRaw`SELECT * FROM "Download" ORDER BY "sortOrder" ASC, "title" ASC`;
}

export async function dbGetDownload(prisma, id) {
  const rows = await prisma.$queryRaw`SELECT * FROM "Download" WHERE "id" = ${id} LIMIT 1`;
  return rows[0] || null;
}

export async function dbCreateDownload(prisma, d) {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "Download"
      ("id","title","category","folderId","raceId","description","version","installNote","fileName","externalUrl","sortOrder","published")
    VALUES
      (${id}, ${d.title}, ${d.category ?? ""}, ${d.folderId ?? null}, ${d.raceId ?? null}, ${d.description ?? null}, ${d.version ?? null}, ${d.installNote ?? null},
       ${d.fileName ?? null}, ${d.externalUrl ?? null}, ${Number(d.sortOrder) || 0}, ${d.published ? 1 : 0})`;
  return dbGetDownload(prisma, id);
}

export async function dbUpdateDownload(prisma, id, d) {
  await prisma.$executeRaw`
    UPDATE "Download" SET
      "title" = ${d.title},
      "category" = ${d.category ?? ""},
      "folderId" = ${d.folderId ?? null},
      "raceId" = ${d.raceId ?? null},
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
