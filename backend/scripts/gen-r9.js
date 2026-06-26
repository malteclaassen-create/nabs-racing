// THROWAWAY generator: build season7/race9.json from the official sheet
// (driver points col 13 / constructor totals col 12) + AC finishing positions
// from race-positions.json["9"]. R9's raw AC order differs slightly from the
// sheet's final classification, so points come from the sheet, positions stay
// AC telemetry (for profiles). Does NOT modify the DB.   node scripts/gen-r9.js
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const HOME = process.env.USERPROFILE || process.env.HOME || "";
const DRIVER_CSV = `${HOME}/Downloads/NABS Standings S7 - Driver Standings.csv`;
const CTOR_CSV = `${HOME}/Downloads/NABS Standings S7 - Constructor Standings.csv`;

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const rows = (p) => readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.split(","));
const DRIVER_ALIAS = { tonitturpeinen: "toni_t" };
const TEAM_ID = {
  porsche: "porsche", mclaren: "mclaren", williams: "williams", ferrari: "ferrari",
  honda: "honda", lotus: "lotus", redbull: "redbull", renault: "renault", bmw: "bmw",
  toyota: "toyota", lamborghini: "lamborghini", spyker: "spyker", jaguar: "jaguar",
  torrorosso: "torro_rosso", superaguri: "super_aguri", fiat: "fiat", ncbmugen: "ncb_mugen",
};
// Reserve subs in R9 (from the original seed's RACE_9_POSITIONS).
const SUBS = { thatdudeguest: "mclaren" };

async function main() {
  const drivers = await prisma.driver.findMany({ where: { seasonId: "season7" } });
  const byNorm = new Map(drivers.map((d) => [norm(d.name), d]));
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const resolve = (name) => byNorm.get(norm(name)) || byId.get(DRIVER_ALIAS[norm(name)]) || null;

  const acR9 = JSON.parse(readFileSync("season7/race-positions.json", "utf8"))["9"] || [];
  const acById = new Map(acR9.map((p) => [p.driverId, p]));

  const driverPoints = {};
  const positions = {};
  const unmatched = [];
  for (const cols of rows(DRIVER_CSV)) {
    const name = (cols[2] || "").trim();
    if (!name || !/^\d+$/.test((cols[4] || "").trim())) continue;
    const v = (cols[13] || "").trim(); // Race 9
    if (v === "") continue;
    const d = resolve(name);
    if (!d) { unmatched.push({ name, r9: v }); continue; }
    driverPoints[d.id] = /^\d+$/.test(v) ? Number(v) : v;
    const p = acById.get(d.id);
    if (p && p.position != null) {
      positions[d.id] = { position: p.position, grid: p.grid, bestLapMs: p.bestLapMs, subForTeamId: SUBS[d.id] || null };
    } else if (SUBS[d.id]) {
      positions[d.id] = { position: null, grid: null, bestLapMs: null, subForTeamId: SUBS[d.id] };
    }
  }

  const constructors = {};
  for (const cols of rows(CTOR_CSV)) {
    const name = (cols[2] || "").trim();
    if (!name || !/^\d+$/.test((cols[3] || "").trim())) continue;
    const teamId = TEAM_ID[norm(name)];
    const v = (cols[12] || "").trim(); // Race 9
    if (teamId && /^\d+$/.test(v)) constructors[teamId] = Number(v);
  }

  writeFileSync("season7/race9.json", JSON.stringify({ driverPoints, constructors, positions }, null, 1) + "\n");
  console.log("driverPoints:", Object.keys(driverPoints).length, "constructors:", Object.keys(constructors).length, "positions:", Object.keys(positions).length);
  console.log("UNMATCHED:", unmatched.length ? JSON.stringify(unmatched) : "(none)");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
