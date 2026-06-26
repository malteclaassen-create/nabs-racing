// THROWAWAY diagnostic: per-race diff of the DB against the official CSVs.
// Treats DNS/DNF/DSQ/blank as 0 points. Prints every cell where DB != sheet.
//   node scripts/diff-db-vs-sheet.js
import "dotenv/config";
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { getDriverResultPoints } from "../src/services/pointsCalculator.js";

const prisma = new PrismaClient();
const HOME = process.env.USERPROFILE || process.env.HOME || "";
const DRIVER_CSV = `${HOME}/Downloads/NABS Standings S7 - Driver Standings.csv`;
const CTOR_CSV = `${HOME}/Downloads/NABS Standings S7 - Constructor Standings.csv`;

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const DRIVER_ALIAS = { tonitturpeinen: "toni_t" };
const TEAM_ID = {
  porsche: "porsche", mclaren: "mclaren", williams: "williams", ferrari: "ferrari",
  honda: "honda", lotus: "lotus", redbull: "redbull", renault: "renault", bmw: "bmw",
  toyota: "toyota", lamborghini: "lamborghini", spyker: "spyker", jaguar: "jaguar",
  torrorosso: "torro_rosso", superaguri: "super_aguri", fiat: "fiat", ncbmugen: "ncb_mugen",
};
const cell = (raw) => {
  const v = (raw || "").trim();
  if (v === "") return null; // did not participate / not run
  if (/^\d+$/.test(v)) return Number(v);
  return 0; // DNS / DNF / DSQ
};
const rows = (path) => readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.split(","));

async function main() {
  const drivers = await prisma.driver.findMany({ where: { seasonId: "season7" } });
  const teams = await prisma.team.findMany({ where: { seasonId: "season7" } });
  const races = await prisma.race.findMany({
    where: { seasonId: "season7", isSpecialEvent: false },
    orderBy: { number: "asc" },
    include: { results: true, constructorScores: true },
  });
  const byNum = new Map(races.map((r) => [r.number, r]));

  // ---- Drivers: name -> {1..12 points} from DB and from CSV ----
  const dbDriverPts = new Map(); // driverId -> {num: pts}
  for (const r of races) {
    for (const res of r.results) {
      if (!dbDriverPts.has(res.driverId)) dbDriverPts.set(res.driverId, {});
      dbDriverPts.get(res.driverId)[r.number] = getDriverResultPoints(res);
    }
  }
  const driverByNorm = new Map(drivers.map((d) => [norm(d.name), d]));
  const byId = new Map(drivers.map((d) => [d.id, d]));

  console.log("==== DRIVER per-race diffs (DB vs sheet) ====");
  let dcount = 0;
  const unmatched = [];
  for (const cols of rows(DRIVER_CSV)) {
    const name = (cols[2] || "").trim();
    if (!name || !/^\d+$/.test((cols[4] || "").trim())) continue; // not a data row
    const d = driverByNorm.get(norm(name)) || byId.get(DRIVER_ALIAS[norm(name)]);
    if (!d) { unmatched.push(name); continue; }
    const dbp = dbDriverPts.get(d.id) || {};
    for (let n = 1; n <= 12; n++) {
      const sheet = cell(cols[4 + n]);
      const db = dbp[n];
      const sv = sheet == null ? 0 : sheet;
      const dv = db == null ? 0 : db;
      if (sv !== dv) {
        console.log(`  R${n} ${name.padEnd(18)} DB=${String(dv).padStart(3)}  sheet=${String(sv).padStart(3)}`);
        dcount++;
      }
    }
  }
  if (unmatched.length) console.log("  [unmatched driver names]:", unmatched.join(", "));
  console.log(`  -> ${dcount} driver cell diffs\n`);

  // ---- Constructors: team -> {1..12} from DB and CSV ----
  const dbTeamPts = new Map();
  for (const r of races) {
    for (const s of r.constructorScores) {
      if (!dbTeamPts.has(s.teamId)) dbTeamPts.set(s.teamId, {});
      dbTeamPts.get(s.teamId)[r.number] = s.points;
    }
  }
  const teamById2 = new Map(teams.map((t) => [t.id, t]));
  const findTeam = (name) => teamById2.get(TEAM_ID[norm(name)]);

  console.log("==== CONSTRUCTOR per-race diffs (DB vs sheet) ====");
  let ccount = 0;
  for (const cols of rows(CTOR_CSV)) {
    const name = (cols[2] || "").trim();
    if (!name || !/^\d+$/.test((cols[3] || "").trim())) continue;
    const t = findTeam(name);
    if (!t) { console.log(`  [unmatched team] ${name}`); continue; }
    const dbp = dbTeamPts.get(t.id) || {};
    for (let n = 1; n <= 12; n++) {
      const sheet = cell(cols[3 + n]);
      const sv = sheet == null ? 0 : sheet;
      const dv = dbp[n] == null ? 0 : dbp[n];
      if (sv !== dv) {
        console.log(`  R${n} ${name.padEnd(14)} (${t.id}) DB=${String(dv).padStart(3)}  sheet=${String(sv).padStart(3)}`);
        ccount++;
      }
    }
  }
  console.log(`  -> ${ccount} constructor cell diffs`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
