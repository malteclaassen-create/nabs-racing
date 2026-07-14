// ---------------------------------------------------------------------------
// Standings self-check (multi-series safety net).
// Two jobs:
//   * --snapshot <file>  : compute driver + constructor standings for EVERY
//                          season and write them to a JSON file (the baseline).
//   * --compare <file>   : recompute and diff against a snapshot — any changed
//                          total/order/dropped round is reported. Exit 1 on drift.
//   * (always)           : seasons with official finalStandings are also checked
//                          against those sheet totals, like backfill-telemetry.
// Usage:
//   node scripts/verify-standings.mjs --snapshot baseline.json
//   node scripts/verify-standings.mjs --compare baseline.json
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "fs";
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "../src/services/standingsService.js";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

// One comparable, order-stable shape per season. Keyed by "S<number>" for
// readability; season numbers can repeat across SERIES, so a collision gets
// the season id appended — the compare below matches entries by seasonId.
async function computeAll() {
  const seasons = await prisma.season.findMany({ orderBy: { number: "asc" } });
  const out = {};
  for (const s of seasons) {
    const [drv, t1, t2] = await Promise.all([
      getDriverStandings(prisma, s.id),
      getT1ConstructorStandings(prisma, s.id),
      getT2ConstructorStandings(prisma, s.id),
    ]);
    const key = out[`S${s.number}`] ? `S${s.number}·${s.id}` : `S${s.number}`;
    out[key] = {
      seasonId: s.id,
      name: s.name,
      drivers: drv.standings.map((r) => ({
        pos: r.position,
        id: r.driverId,
        total: r.total,
        dropped: r.droppedRounds,
      })),
      t1: t1.standings.map((r) => ({ pos: r.position, id: r.teamId, total: r.total })),
      t2: t2.standings.map((r) => ({ pos: r.position, id: r.teamId, total: r.total })),
    };
  }
  return out;
}

// Official-sheet check for archived seasons (same as backfill-telemetry's tail).
async function checkOfficial() {
  const seasons = await prisma.season.findMany({ orderBy: { number: "asc" } });
  let mismatches = 0;
  for (const s of seasons) {
    if (!s.finalStandings) continue;
    let official;
    try {
      official = JSON.parse(s.finalStandings).drivers || [];
    } catch {
      continue;
    }
    if (!official.length) continue;
    const drv = await getDriverStandings(prisma, s.id);
    const computed = new Map(drv.standings.map((r) => [r.driverId, r.total]));
    for (const e of official) {
      const c = computed.get(e.driverId) ?? 0;
      if (c !== e.points) {
        mismatches++;
        console.log(`  Δ S${s.number} ${e.driverId}: computed ${c} vs official ${e.points}`);
      }
    }
  }
  console.log(
    mismatches
      ? `⚠ official-sheet check: ${mismatches} mismatch(es)`
      : `✓ official-sheet check: all stored finalStandings match`
  );
  return mismatches;
}

async function main() {
  const snapshotPath = flag("snapshot");
  const comparePath = flag("compare");
  const current = await computeAll();

  if (snapshotPath) {
    writeFileSync(snapshotPath, JSON.stringify(current, null, 2));
    console.log(`✓ snapshot written: ${snapshotPath} (${Object.keys(current).length} seasons)`);
  }

  let drift = 0;
  if (comparePath) {
    const baseline = JSON.parse(readFileSync(comparePath, "utf8"));
    // Match by seasonId (keys can shift when another series reuses a number).
    const currentById = new Map(Object.values(current).map((v) => [v.seasonId, v]));
    for (const key of Object.keys(baseline)) {
      const a = JSON.stringify(baseline[key]);
      const b = JSON.stringify(currentById.get(baseline[key]?.seasonId) ?? null);
      if (a !== b) {
        drift++;
        console.log(`  Δ ${key}: standings differ from the baseline`);
        // Point at the first differing driver row for quick diagnosis.
        const ad = baseline[key]?.drivers || [];
        const bd = currentById.get(baseline[key]?.seasonId)?.drivers || [];
        for (let i = 0; i < Math.max(ad.length, bd.length); i++) {
          if (JSON.stringify(ad[i]) !== JSON.stringify(bd[i])) {
            console.log(`     first driver diff at pos ${i + 1}:`);
            console.log(`       baseline: ${JSON.stringify(ad[i])}`);
            console.log(`       now:      ${JSON.stringify(bd[i])}`);
            break;
          }
        }
      }
    }
    console.log(drift ? `⚠ ${drift} season(s) drifted` : `✓ standings identical to the baseline (${Object.keys(baseline).length} seasons)`);
  }

  const officialMismatches = await checkOfficial();
  await prisma.$disconnect();
  if (drift || officialMismatches) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
