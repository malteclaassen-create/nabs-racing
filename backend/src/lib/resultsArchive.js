// ---------------------------------------------------------------------------
// Keeps the raw AC result JSON of every imported/committed round on disk, so the
// distilled telemetry can be recomputed later (when the extractor improves)
// without re-downloading from the race server. Files live under
// DATA_DIR/results-archive/season<N>/r<NN>-<track>.json.
//
// Import is a two-step flow (parse/review, then commit), so an incoming file is
// first stashed under results-archive/incoming/<key>.json and only moved into
// its season folder once the admin confirms the round it belongs to.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, renameSync, readdirSync, statSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { RESULTS_ARCHIVE_DIR } from "./dataDirs.js";

export { RESULTS_ARCHIVE_DIR };

const INCOMING_DIR = join(RESULTS_ARCHIVE_DIR, "incoming");
const INCOMING_TTL_MS = 24 * 60 * 60 * 1000; // stale stashes older than a day are swept

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function slug(s) {
  return String(s || "track")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "track";
}

function seasonDir(seasonNumber) {
  return join(RESULTS_ARCHIVE_DIR, `season${seasonNumber ?? "unknown"}`);
}

function roundFileName(raceNumber, track) {
  const n = Number(raceNumber);
  const rr = Number.isFinite(n) ? `r${String(n).padStart(2, "0")}` : "r--";
  return `${rr}-${slug(track)}.json`;
}

// Best-effort sweep of stale incoming stashes (a parse that was never committed).
function sweepIncoming() {
  try {
    if (!existsSync(INCOMING_DIR)) return;
    const now = Date.now();
    for (const name of readdirSync(INCOMING_DIR)) {
      const p = join(INCOMING_DIR, name);
      try {
        if (now - statSync(p).mtimeMs > INCOMING_TTL_MS) unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

// Stash a freshly parsed JSON; returns an opaque key to pass to archiveCommitted.
export function stashIncoming(json) {
  try {
    ensureDir(INCOMING_DIR);
    sweepIncoming();
    const key = randomUUID();
    writeFileSync(join(INCOMING_DIR, `${key}.json`), JSON.stringify(json));
    return key;
  } catch (e) {
    console.error("resultsArchive.stashIncoming:", e.message);
    return null;
  }
}

// Move a stashed JSON into its season folder once the round is known. Silent
// no-op when the key is missing/expired (archiving must never fail an import).
export function archiveCommitted(archiveKey, { seasonNumber, raceNumber, track } = {}) {
  if (!archiveKey) return null;
  try {
    const src = join(INCOMING_DIR, `${archiveKey}.json`);
    if (!existsSync(src)) return null;
    const dir = seasonDir(seasonNumber);
    ensureDir(dir);
    const dest = join(dir, roundFileName(raceNumber, track));
    if (existsSync(dest)) unlinkSync(dest); // overwrite a re-import of the same round
    renameSync(src, dest);
    return dest;
  } catch (e) {
    console.error("resultsArchive.archiveCommitted:", e.message);
    return null;
  }
}

// Write a JSON straight into a season folder (used by the backfill script, which
// already knows the round). Overwrites an existing file for that round.
export function saveDirect(json, { seasonNumber, raceNumber, track } = {}) {
  try {
    const dir = seasonDir(seasonNumber);
    ensureDir(dir);
    const dest = join(dir, roundFileName(raceNumber, track));
    writeFileSync(dest, JSON.stringify(json));
    return dest;
  } catch (e) {
    console.error("resultsArchive.saveDirect:", e.message);
    return null;
  }
}
