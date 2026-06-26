// ---------------------------------------------------------------------------
// THROWAWAY verification script for the Tier-2 DSQ/DNF re-ranking fix.
//
// What it does:
//   * reads the seeded Season 7 data straight out of the SQLite dev DB,
//   * recomputes every championship race's Tier-1 and Tier-2 constructor
//     points with the FIXED points calculator,
//   * prints a readable per-race, per-team table, next to the constructor
//     totals stored in the DB (for R1-R8 those stored rows are the OFFICIAL
//     spreadsheet numbers), and flags anything that differs.
//
// Run from the backend folder:   node scripts/verify-s7-constructors.js
//
// IMPORTANT CAVEAT (read before reacting to mismatches):
//   For races 1-8 the seed stores each driver's POINTS directly and does NOT
//   record which reserve substituted for which team (no subForTeamId). So when
//   we recompute the constructor points from finishing positions, any team that
//   ran a reserve sub will be attributed differently than the official sheet.
//   That is expected and is exactly why the project stores the verified R1-8
//   constructor totals directly. The race that truly exercises the fix is R9
//   (Imola): it carries full finishing positions AND the sub assignments, so
//   its computed values should match the official sheet.
// ---------------------------------------------------------------------------
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  calculateT1ConstructorPoints,
  calculateT2ConstructorPoints,
} from "../src/services/pointsCalculator.js";

const prisma = new PrismaClient();

function fmt(n) {
  return String(n).padStart(4, " ");
}

async function main() {
  const [drivers, teams] = await Promise.all([
    prisma.driver.findMany(),
    prisma.team.findMany(),
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  // Championship rounds only (numbered, not special events), in order.
  const races = await prisma.race.findMany({
    where: { number: { not: null }, isSpecialEvent: false, isCompleted: true },
    orderBy: { number: "asc" },
    include: { results: true, constructorScores: true },
  });

  let suspicious = 0;

  for (const race of races) {
    // Shape each stored result the way the calculator expects.
    const results = race.results.map((r) => ({
      driverId: r.driverId,
      position: r.position,
      status: r.status,
      points: r.points,
      subForTeamId: r.subForTeamId,
    }));

    const t1 = calculateT1ConstructorPoints(results, drivers, teams);
    const t2 = calculateT2ConstructorPoints(results, drivers, teams);

    // Stored (reference) totals from the DB, split by tier.
    const stored = { 1: {}, 2: {} };
    for (const cs of race.constructorScores) stored[cs.tier][cs.teamId] = cs.points;

    // R1-8 are historical points-only (no subs stored); R9+ are imported with
    // full finishing positions AND sub assignments, so they should match.
    const isImported = race.number >= 9;
    console.log(
      `\n=== Round ${race.number} — ${race.track} ` +
        `${isImported ? "(imported: computed should match the sheet)" : "(R1-8: stored = OFFICIAL; computed ignores subs)"} ===`
    );

    for (const tier of [1, 2]) {
      const computed = tier === 1 ? t1 : t2;
      const ref = stored[tier];
      const teamIds = new Set([...Object.keys(computed), ...Object.keys(ref)]);
      console.log(`  Tier ${tier} constructors:`);
      console.log(`    ${"team".padEnd(16)} computed  stored  diff`);
      for (const id of [...teamIds].sort()) {
        const c = computed[id] || 0;
        const s = ref[id] || 0;
        const diff = c - s;
        const flag = diff !== 0 ? (isImported ? "  <-- CHECK (imported race should match!)" : "  (sub diff — expected)") : "";
        if (diff !== 0 && isImported) suspicious++;
        console.log(
          `    ${(teamName.get(id) || id).padEnd(16)} ${fmt(c)}     ${fmt(s)}  ${fmt(diff)}${flag}`
        );
      }
    }
  }

  console.log(
    `\nDone. ${suspicious === 0 ? "No mismatches on any imported race (R9+)." : `${suspicious} imported-race team(s) differ — investigate.`}`
  );
  console.log(
    "Compare the 'computed' columns above against the official Google Sheet.\n" +
      "Remember: R1-8 'computed' will diverge wherever a reserve subbed (subs not\n" +
      "stored for those races); R9 is the meaningful check of the DSQ/DNF fix."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
