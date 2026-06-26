// ---------------------------------------------------------------------------
// THROWAWAY check: run the real standings service against the seeded DB and
// diff every season TOTAL against the official Google-Sheet CSVs in Downloads.
// This confirms the drop-worst-3 rule end to end (service wiring + helper).
//
//   node scripts/verify-s7-standings.js
// ---------------------------------------------------------------------------
import "dotenv/config";
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "../src/services/standingsService.js";

const prisma = new PrismaClient();
const HOME = process.env.USERPROFILE || process.env.HOME || "";
const DRIVER_CSV = `${HOME}/Downloads/NABS Standings S7 - Driver Standings.csv`;
const CTOR_CSV = `${HOME}/Downloads/NABS Standings S7 - Constructor Standings.csv`;

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Exact-normalized match, with explicit aliases for the few names that differ
// between the sheet and the DB (driver "Toni T. Turpeinen" -> "Toni T"; team
// short names -> full DB names). No prefix fallback (it mis-paired CR/Crans3).
const ALIAS = {
  tonitturpeinen: "tonit", porsche: "porschemartini", bmw: "bmwsauber", redbull: "redbull",
};
const nameMatch = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  return x === y || ALIAS[x] === y || ALIAS[y] === x;
};

// Parse "name -> total" pairs out of a CSV, given the column indexes.
function parseTotals(path, nameCol, totalCol, skipRowsWith = []) {
  const rows = readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.split(","));
  const out = [];
  for (const cols of rows) {
    const name = (cols[nameCol] || "").trim();
    const totalRaw = (cols[totalCol] || "").trim();
    if (!name || skipRowsWith.includes(name)) continue;
    if (!/^\d+$/.test(totalRaw)) continue; // header / blank rows
    out.push({ name, total: Number(totalRaw) });
  }
  return out;
}

function diff(label, computed, official) {
  console.log(`\n=== ${label} ===`);
  let ok = 0;
  let bad = 0;
  for (const row of computed) {
    const match = official.find((o) => nameMatch(row.name, o.name));
    if (!match) continue; // unmatched (e.g. 0-pt reserves named differently)
    const flag = match.total === row.total ? "" : `  <-- MISMATCH (sheet ${match.total})`;
    if (match.total === row.total) ok++;
    else {
      bad++;
      console.log(`  ${row.name.padEnd(20)} computed ${String(row.total).padStart(4)}${flag}`);
    }
  }
  console.log(`  ${ok} match, ${bad} mismatch (of ${computed.length} computed rows).`);
  return bad;
}

async function main() {
  const [drivers, t1, t2] = await Promise.all([
    getDriverStandings(prisma, "season7"),
    getT1ConstructorStandings(prisma, "season7"),
    getT2ConstructorStandings(prisma, "season7"),
  ]);

  // Driver CSV layout: col1=Standing, col2=Driver, col3=Team, col4=Total.
  const officialDrivers = parseTotals(DRIVER_CSV, 2, 4);
  // Constructor CSV layout: col1=Standing, col2=Team, col3=Total (both tiers).
  const officialCtors = parseTotals(CTOR_CSV, 2, 3);

  let bad = 0;
  bad += diff("Driver standings", drivers.standings.map((r) => ({ name: r.name, total: r.total })), officialDrivers);
  bad += diff("Tier-1 constructors", t1.standings.map((r) => ({ name: r.name, total: r.total })), officialCtors);
  bad += diff("Tier-2 constructors", t2.standings.map((r) => ({ name: r.name, total: r.total })), officialCtors);

  console.log(
    `\n${bad === 0 ? "ALL MATCHED — standings reproduce the official sheet." : `${bad} mismatch(es) — investigate above.`}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
