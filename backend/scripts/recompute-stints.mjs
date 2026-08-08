// ---------------------------------------------------------------------------
// Operator CLI around lib/stintRecompute.js: recompute ONLY the tyre stints on
// existing RaceResult rows from the archived result JSONs. Scoring (positions,
// points, penalties) is never touched — one JSON column is written.
//
//   node scripts/recompute-stints.mjs --dry-run
//   node scripts/recompute-stints.mjs --season 8
//   node scripts/recompute-stints.mjs
//
// The hosted instance never needs this: the same pass runs there once at
// startup, flag-guarded (recomputeStintsOnce in the lib, wired in index.js).
// Run with the dev server STOPPED (SQLite write lock on Windows).
// ---------------------------------------------------------------------------
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../src/lib/prisma.js";
import { recomputeSeasonStints } from "../src/lib/stintRecompute.js";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const onlySeason = argv.includes("--season") ? Number(argv[argv.indexOf("--season") + 1]) : null;

const ROOT = resolve(process.cwd(), "results-archive");
if (!existsSync(ROOT)) {
  console.error("No results-archive folder here. Run this from backend/.");
  process.exit(1);
}

const seasons = onlySeason
  ? [onlySeason]
  : readdirSync(ROOT)
      .map((d) => /^season(\d+)$/.exec(d)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b);

let racesMatched = 0;
let rowsChanged = 0;
let rowsSame = 0;
for (const n of seasons) {
  const res = await recomputeSeasonStints(prisma, n, { dryRun: DRY, log: console.log });
  racesMatched += res.racesMatched;
  rowsChanged += res.rowsChanged;
  rowsSame += res.rowsSame;
  for (const note of res.notes) console.log(`  season ${n}: ${note}`);
}

console.log("");
console.log(DRY ? "DRY RUN, nothing written" : "written");
console.log(`races matched:   ${racesMatched}`);
console.log(`rows changed:    ${rowsChanged}`);
console.log(`rows unchanged:  ${rowsSame}`);

await prisma.$disconnect();
