// ---------------------------------------------------------------------------
// Keeps the raw AC result JSON of every imported/committed round on disk, so the
// distilled telemetry can be recomputed later (when the extractor improves)
// without re-downloading from the race server. Files live under
// DATA_DIR/results-archive/<series slug>/season<N>/r<NN>-<track>.json.
//
// One folder per series, because two leagues both have a "season 8, round 2"
// and used to file them on top of each other. Readers hand in the SEASON ROW
// ({ id, number }); the season's series is looked up in a small index kept in
// memory (refreshArchiveIndex), because most readers are synchronous and sit
// deep inside request handling. Files from before series existed lie in
// results-archive/season<N> at the root; the first boot after this change
// moves them under the first series ever created, which is the league those
// rounds belonged to, and the root is still read as a fallback for it.
//
// Import is a two-step flow (parse/review, then commit), so an incoming file is
// first stashed under results-archive/incoming/<key>.json and only moved into
// its season folder once the admin confirms the round it belongs to.
// ---------------------------------------------------------------------------
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, renameSync, readdirSync, statSync, unlinkSync, rmdirSync } from "fs";
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

// --- which series a season belongs to ---------------------------------------

const slugBySeasonId = new Map(); // seasonId -> series slug
let primarySlug = null; // the series created first: owner of the root-level files

// A season handed in as a bare number (old callers, tests) is a season with
// no known series, which reads and writes the root folder as before.
function seasonOf(season) {
  if (season && typeof season === "object") return season;
  return { id: null, number: season };
}

export async function refreshArchiveIndex(prisma) {
  try {
    const [seasons, series] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT "id", "seriesId" FROM "Season"`),
      prisma.$queryRawUnsafe(`SELECT "id", "slug" FROM "Series" ORDER BY "createdAt" ASC`),
    ]);
    const slugOf = new Map(series.map((s) => [s.id, s.slug]));
    slugBySeasonId.clear();
    for (const s of seasons) if (s.seriesId && slugOf.has(s.seriesId)) slugBySeasonId.set(s.id, slugOf.get(s.seriesId));
    primarySlug = series[0]?.slug || null;
  } catch {
    /* fresh database: no series yet, everything stays at the root */
  }
}

export function seriesSlugForSeason(seasonId) {
  return (seasonId && slugBySeasonId.get(seasonId)) || null;
}

// Where a season's files are READ from, in order: the series folder, then the
// root for the first series (its files from before) or for a season whose
// series is not known.
export function archiveDirsFor(season) {
  const s = seasonOf(season);
  const n = s.number ?? "unknown";
  const slug = seriesSlugForSeason(s.id);
  const dirs = [];
  if (slug) dirs.push(join(RESULTS_ARCHIVE_DIR, slug, `season${n}`));
  if (!slug || slug === primarySlug) dirs.push(join(RESULTS_ARCHIVE_DIR, `season${n}`));
  return dirs;
}

// Where a season's files are WRITTEN: the series folder when the series is
// known, the root when it is not.
function seasonDir(season) {
  return archiveDirsFor(season)[0];
}

// The one-time move of the root-level season folders under the first series.
// Safe to run on every boot: with nothing at the root it does nothing, and a
// file that already exists at the destination is left where it is.
export function migrateArchiveLayout() {
  if (!primarySlug || !existsSync(RESULTS_ARCHIVE_DIR)) return 0;
  let moved = 0;
  try {
    for (const name of readdirSync(RESULTS_ARCHIVE_DIR)) {
      if (!/^season\d+$/.test(name)) continue;
      const src = join(RESULTS_ARCHIVE_DIR, name);
      if (!statSync(src).isDirectory()) continue;
      const dest = join(RESULTS_ARCHIVE_DIR, primarySlug, name);
      if (!existsSync(dest)) {
        ensureDir(join(RESULTS_ARCHIVE_DIR, primarySlug));
        renameSync(src, dest);
        moved += 1;
        continue;
      }
      for (const f of readdirSync(src)) {
        const to = join(dest, f);
        if (!existsSync(to)) {
          renameSync(join(src, f), to);
          moved += 1;
        }
      }
      if (!readdirSync(src).length) rmdirSync(src);
    }
    if (moved) console.log(`results archive: moved ${moved} item(s) under ${primarySlug}/`);
  } catch (e) {
    console.error("results archive: layout migration:", e.message);
  }
  return moved;
}

// A sprint weekend files two results under one round number: the feature race
// as `rNN-<track>.json` and the sprint as `rNN-<track>-sprint.json`. The
// readers (lib/cockpitArchive.js) tell the two apart by that suffix alone, so
// it is put on AFTER the track slug is cut to length rather than being part
// of the name that gets cut: "Autodromo Internazionale Enzo e Dino Ferrari
// Sprint" lost its "-sprint" to the 40-character limit and landed on top of
// the feature's file, which then served the sprint's contacts under the
// feature race while the sprint had no file at all. And a feature race at a
// circuit whose own name ends in "Sprint" gets "-race" appended, so its file
// can never be taken for the weekend's second race.
export const SPRINT_SUFFIX = "-sprint";
export const isSprintFile = (name) => name.endsWith(`${SPRINT_SUFFIX}.json`);

// "r05-" — what every file of round 5 starts with, feature and sprint alike.
export function roundPrefix(raceNumber) {
  const n = Number(raceNumber);
  return Number.isFinite(n) ? `r${String(n).padStart(2, "0")}-` : "r---";
}

function roundFileName(raceNumber, track, sprint = false) {
  let name = slug(track);
  if (sprint) name += SPRINT_SUFFIX;
  else if (name.endsWith(SPRINT_SUFFIX)) name += "-race";
  return `${roundPrefix(raceNumber)}${name}.json`;
}

// One file per round and race. A re-import under a different track name (the
// circuit renamed, a file from another mod spelling it differently) used to
// leave the old file beside the new one, and the reader picked between the two
// by lap count — which is not "the one the admin just imported". The round's
// result IS the newest import, so the others of its kind go when it lands.
// `keep` is the file being written; nothing else of that round and kind stays.
function dropStaleRoundFiles(dir, raceNumber, sprint, keep) {
  const prefix = roundPrefix(raceNumber);
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  let dropped = 0;
  for (const name of names) {
    if (name === keep || !name.startsWith(prefix) || !name.endsWith(".json")) continue;
    if (isSprintFile(name) !== !!sprint) continue;
    try {
      unlinkSync(join(dir, name));
      dropped += 1;
    } catch {
      /* best effort */
    }
  }
  return dropped;
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
// `season` is the season row ({ id, number }); `seasonNumber` alone still
// works and files at the root. `sprint` files the JSON as the round's sprint
// (see roundFileName), under the EVENT's round number.
export function archiveCommitted(
  archiveKey,
  { season = null, seasonNumber = null, raceNumber, track, sprint = false } = {}
) {
  if (!archiveKey) return null;
  try {
    const src = join(INCOMING_DIR, `${archiveKey}.json`);
    if (!existsSync(src)) return null;
    const dir = seasonDir(season || seasonNumber);
    ensureDir(dir);
    const name = roundFileName(raceNumber, track, sprint);
    const dest = join(dir, name);
    if (existsSync(dest)) unlinkSync(dest); // overwrite a re-import of the same round
    dropStaleRoundFiles(dir, raceNumber, sprint, name);
    renameSync(src, dest);
    return dest;
  } catch (e) {
    console.error("resultsArchive.archiveCommitted:", e.message);
    return null;
  }
}

// Write a JSON straight into a season folder (used by the backfill script, which
// already knows the round). Overwrites an existing file for that round.
export function saveDirect(json, { season = null, seasonNumber = null, raceNumber, track, sprint = false } = {}) {
  try {
    const dir = seasonDir(season || seasonNumber);
    ensureDir(dir);
    const name = roundFileName(raceNumber, track, sprint);
    const dest = join(dir, name);
    dropStaleRoundFiles(dir, raceNumber, sprint, name);
    writeFileSync(dest, JSON.stringify(json));
    return dest;
  } catch (e) {
    console.error("resultsArchive.saveDirect:", e.message);
    return null;
  }
}
