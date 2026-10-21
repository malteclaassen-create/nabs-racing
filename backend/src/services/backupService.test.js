import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, utimesSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { gunzipSync } from "zlib";
import { BACKUPS_DIR } from "../lib/dataDirs.js";
import { compressOldBackups, listBackups, deleteBackup } from "./backupService.js";

// Five snapshots, a minute apart, oldest first.
const NAMES = [1, 2, 3, 4, 5].map((i) => `nabs-20261001-12000${i}-r${i}.db`);
const T0 = new Date("2026-10-01T12:00:00Z").getTime();

beforeEach(() => {
  rmSync(BACKUPS_DIR, { recursive: true, force: true });
  mkdirSync(BACKUPS_DIR, { recursive: true });
  NAMES.forEach((name, i) => {
    const p = join(BACKUPS_DIR, name);
    writeFileSync(p, `SQLite format 3 ${"x".repeat(5000)} ${name}`);
    const t = new Date(T0 + i * 60_000);
    utimesSync(p, t, t);
  });
});

describe("compressOldBackups", () => {
  it("keeps the newest three plain and gzips the rest", async () => {
    await compressOldBackups();
    const files = listBackups().map((b) => b.file);
    expect(files).toEqual([NAMES[4], NAMES[3], NAMES[2], `${NAMES[1]}.gz`, `${NAMES[0]}.gz`]);
  });

  it("loses nothing: the packed file unpacks to the original", async () => {
    const before = readFileSync(join(BACKUPS_DIR, NAMES[0]));
    await compressOldBackups();
    expect(gunzipSync(readFileSync(join(BACKUPS_DIR, `${NAMES[0]}.gz`)))).toEqual(before);
    expect(existsSync(join(BACKUPS_DIR, NAMES[0]))).toBe(false);
  });

  it("keeps each snapshot's own time, so the list order and the cap stay right", async () => {
    await compressOldBackups();
    const oldest = listBackups().at(-1);
    expect(oldest.file).toBe(`${NAMES[0]}.gz`);
    expect(new Date(oldest.createdAt).getTime()).toBe(T0);
  });

  it("clears a half-written leftover from an interrupted run", async () => {
    writeFileSync(join(BACKUPS_DIR, `${NAMES[0]}.gz.part`), "half");
    await compressOldBackups();
    expect(readdirSync(BACKUPS_DIR).some((f) => f.endsWith(".part"))).toBe(false);
  });

  it("lets the admin delete a packed snapshot", async () => {
    await compressOldBackups();
    expect(deleteBackup(`${NAMES[0]}.gz`)).toBe(true);
    expect(deleteBackup("nabs-x.db.gz/../../etc")).toBe(false);
  });
});
