// ---------------------------------------------------------------------------
// One-off enrichment: compute the simresults-style consistency percentage
// (consistencyPct) for every already-imported round, from the raw AC result
// JSONs kept in the results archive (DATA_DIR/results-archive/season<N>/).
//
// Nothing else is touched — no scoring, no other telemetry columns. Rows are
// matched to the JSON entries by best lap (exact ms, unique per race in
// practice), with total race time as the tie-breaker, so no name matching is
// needed at all.
//
//   node scripts/recompute-consistency.mjs --dry-run
//   node scripts/recompute-consistency.mjs
//
// Safe to re-run; it simply overwrites consistencyPct with the fresh value.
// Prefer running with the dev server stopped (SQLite single-writer), but the
// updates are tiny and retried, so a live server usually tolerates it.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/lib/prisma.js";
import { ensureAppSchema } from "../src/lib/ensureSchema.js";
import { extractTelemetry } from "../src/services/telemetryExtractor.js";
import { RESULTS_ARCHIVE_DIR } from "../src/lib/resultsArchive.js";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  await ensureAppSchema(prisma);

  const seasons = await prisma.season.findMany({ select: { id: true, number: true } });
  const seasonByNumber = new Map(seasons.map((s) => [s.number, s]));

  let filesSeen = 0;
  let rowsUpdated = 0;
  let rowsUnmatched = 0;

  for (const dirName of readdirSync(RESULTS_ARCHIVE_DIR)) {
    const m = /^season(\d+)$/.exec(dirName);
    if (!m) continue;
    const season = seasonByNumber.get(Number(m[1]));
    if (!season) {
      console.warn(`skip ${dirName}: no season #${m[1]} in the DB`);
      continue;
    }
    const dir = join(RESULTS_ARCHIVE_DIR, dirName);
    for (const file of readdirSync(dir).sort()) {
      const fm = /^r(\d+)-/.exec(file);
      if (!fm || !file.endsWith(".json")) continue;
      const race = await prisma.race.findFirst({
        where: { seasonId: season.id, number: Number(fm[1]) },
        select: { id: true, track: true, number: true },
      });
      if (!race) {
        console.warn(`skip ${dirName}/${file}: no round ${Number(fm[1])} in season #${season.number}`);
        continue;
      }
      filesSeen++;

      let json;
      try {
        json = JSON.parse(readFileSync(join(dir, file), "utf8"));
      } catch (e) {
        console.warn(`skip ${dirName}/${file}: unreadable JSON (${e.message})`);
        continue;
      }
      const { byGuid } = extractTelemetry(json);

      // JSON entries keyed by validated best lap / total time for row matching.
      const entries = (Array.isArray(json.Result) ? json.Result : [])
        .filter((r) => r?.DriverGuid)
        .map((r) => ({ guid: r.DriverGuid, bestLap: Number(r.BestLap) || 0, totalTime: Number(r.TotalTime) || 0 }));

      const rows = await prisma.$queryRawUnsafe(
        `SELECT "driverId", "bestLapMs", "totalTimeMs" FROM "RaceResult" WHERE "raceId" = ?`,
        race.id
      );

      for (const row of rows) {
        const best = row.bestLapMs == null ? null : Number(row.bestLapMs);
        const total = row.totalTimeMs == null ? null : Number(row.totalTimeMs);
        let cands = best ? entries.filter((e) => e.bestLap === best) : [];
        if (cands.length > 1 && total) cands = cands.filter((e) => e.totalTime === total);
        if (cands.length !== 1) {
          // No/ambiguous match: usually a driver with no valid lap — nothing to compute anyway.
          rowsUnmatched++;
          continue;
        }
        const pct = byGuid.get(cands[0].guid)?.consistencyPct ?? null;
        if (pct == null) continue;
        rowsUpdated++;
        if (!dryRun) {
          await prisma.$executeRawUnsafe(
            `UPDATE "RaceResult" SET "consistencyPct" = ? WHERE "raceId" = ? AND "driverId" = ?`,
            pct,
            race.id,
            row.driverId
          );
        }
      }
      console.log(`S${season.number} R${race.number} ${race.track}: done`);
    }
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}${filesSeen} archived rounds, ${rowsUpdated} driver rows ${dryRun ? "would get" : "got"} a consistency %, ${rowsUnmatched} rows had no matchable lap data`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
