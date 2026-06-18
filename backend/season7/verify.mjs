import { PrismaClient } from "@prisma/client";
import { getDriverStandings, getT1ConstructorStandings, getT2ConstructorStandings } from "../src/services/standingsService.js";
const prisma = new PrismaClient();

const ds = await getDriverStandings(prisma);
console.log("Top 8 drivers (pos name total):");
ds.standings.slice(0, 8).forEach((d) => console.log(`  ${d.position}. ${d.name} — ${d.total}`));

const t1 = await getT1ConstructorStandings(prisma);
const t2 = await getT2ConstructorStandings(prisma);
console.log("\nT1 constructors:", t1.standings.map((s) => `${s.name}:${s.total}`).join("  "));
console.log("T2 constructors:", t2.standings.map((s) => `${s.name}:${s.total}`).join("  "));

// Position coverage per race
const races = await prisma.race.findMany({ where: { isCompleted: true }, orderBy: { number: "asc" } });
console.log("\nResult rows + position coverage per race:");
for (const r of races) {
  const rows = await prisma.raceResult.findMany({ where: { raceId: r.id } });
  const withPos = rows.filter((x) => x.position != null).length;
  const withGrid = rows.filter((x) => x.grid != null).length;
  const withLap = rows.filter((x) => x.bestLapMs != null).length;
  console.log(`  R${r.number} ${r.track.padEnd(12)} rows=${rows.length} pos=${withPos} grid=${withGrid} lap=${withLap}`);
}

// Spot check: a couple of known driver per-race points unchanged
const chk = ds.standings.find((d) => d.name === "Mtimmis");
console.log("\nMtimmis perRace points:", Object.entries(chk.perRace).map(([n, v]) => `R${n}:${v.points}(P${v.position})`).join(" "));
await prisma.$disconnect();
