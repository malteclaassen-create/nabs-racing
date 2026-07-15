// ---------------------------------------------------------------------------
// Maintenance: clear any driver's chosen card edition that its stats/seals no
// longer justify. Unlocks are monotonic (starts/wins/titles never vanish), so
// this normally finds nothing — the one case it exists for is a retroactive
// stewards' decision that strips a win or flips a championship result. Run it
// by hand after such a correction; it is NOT wired into any request path.
//
//   node scripts/revalidate-card-styles.js          # report only
//   node scripts/revalidate-card-styles.js --fix     # actually reset them
// ---------------------------------------------------------------------------
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { cardUnlockInputs } from "../src/services/driverProfileService.js";
import { unlockStateFor, isKnownEdition, DEFAULT_CARD_EDITION } from "../src/lib/cardEditions.js";

const FIX = process.argv.includes("--fix");

async function main() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id","name","cardStyle" FROM "Driver" WHERE "cardStyle" IS NOT NULL AND "cardStyle" != '${DEFAULT_CARD_EDITION}'`
  );
  console.log(`Checking ${rows.length} rows with a chosen card edition…`);
  let stale = 0;
  for (const row of rows) {
    const key = row.cardStyle;
    let ok = false;
    if (isKnownEdition(key)) {
      const inputs = await cardUnlockInputs(prisma, row.id);
      const state = inputs ? unlockStateFor(inputs.stats, inputs.badges, inputs.teamBadges, inputs.seasonNumber) : [];
      ok = !!state.find((e) => e.key === key)?.unlocked;
    }
    if (!ok) {
      stale++;
      console.log(`  ${ok === false ? "STALE" : "?"}: ${row.name} (${row.id}) -> "${key}"`);
      if (FIX) {
        await prisma.$executeRaw`UPDATE "Driver" SET "cardStyle" = ${null} WHERE "id" = ${row.id}`;
      }
    }
  }
  console.log(stale === 0 ? "All chosen editions are still valid." : `${stale} stale ${FIX ? "reset to classic." : "(run with --fix to reset)."}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
