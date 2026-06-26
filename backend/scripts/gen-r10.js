// THROWAWAY generator: build season7/race10.json from the official sheet
// (points + constructor totals) plus the current DB (finishing positions),
// using an EXACT driver-name map. Prints a report of anything unmapped so we
// can alias it or add a new driver. Does NOT modify the DB.
//   node scripts/gen-r10.js
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const HOME = process.env.USERPROFILE || process.env.HOME || "";
const DRIVER_CSV = `${HOME}/Downloads/NABS Standings S7 - Driver Standings.csv`;
const CTOR_CSV = `${HOME}/Downloads/NABS Standings S7 - Constructor Standings.csv`;

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const rows = (p) => readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.split(","));

// Explicit team display-name -> teamId.
const TEAM_ID = {
  porsche: "porsche", mclaren: "mclaren", williams: "williams", ferrari: "ferrari",
  honda: "honda", lotus: "lotus", redbull: "redbull", renault: "renault", bmw: "bmw",
  toyota: "toyota", lamborghini: "lamborghini", spyker: "spyker", jaguar: "jaguar",
  torrorosso: "torro_rosso", superaguri: "super_aguri", fiat: "fiat", ncbmugen: "ncb_mugen",
};

// Known sheet-name -> DB-name aliases where exact-normalized differs.
const DRIVER_ALIAS = {
  tonitturpeinen: "toni_t", // "Toni T. Turpeinen" -> id toni_t
};

// New reserve drivers seen only in R10 (not yet in the DB). norm(name) -> {id,name}.
const NEW_DRIVERS = {
  microlin: { id: "microlin", name: "Microlin" },
  waka: { id: "waka", name: "Waka" },
};

async function main() {
  const drivers = await prisma.driver.findMany({ where: { seasonId: "season7" } });
  const byNorm = new Map(drivers.map((d) => [norm(d.name), d]));
  const byId = new Map(drivers.map((d) => [d.id, d]));

  const r10 = await prisma.race.findFirst({ where: { seasonId: "season7", number: 10 }, include: { results: true } });
  const dbPos = new Map(); // driverId -> {position, grid, bestLapMs, subForTeamId}
  for (const res of r10?.results || []) {
    dbPos.set(res.driverId, { position: res.position, grid: res.grid, bestLapMs: res.bestLapMs, subForTeamId: res.subForTeamId });
  }

  const resolve = (name) => {
    const n = norm(name);
    if (byNorm.has(n)) return byNorm.get(n);
    if (DRIVER_ALIAS[n] && byId.has(DRIVER_ALIAS[n])) return byId.get(DRIVER_ALIAS[n]);
    return null;
  };

  // ---- Driver R10 points from the sheet (col index 14 = Race 10) ----
  const driverPoints = {};
  const positions = {};
  const unmatched = [];
  for (const cols of rows(DRIVER_CSV)) {
    const name = (cols[2] || "").trim();
    if (!name || !/^\d+$/.test((cols[4] || "").trim())) continue; // not a data row
    const cell = (cols[14] || "").trim();
    if (cell === "") continue; // blank -> did not take part in R10
    const d = resolve(name);
    const id = d ? d.id : NEW_DRIVERS[norm(name)]?.id;
    if (!id) { unmatched.push({ name, r10: cell }); continue; }
    driverPoints[id] = /^\d+$/.test(cell) ? Number(cell) : cell; // number or DNS/DNF/DSQ
    const p = dbPos.get(id);
    if (p && p.position != null) positions[id] = { position: p.position, grid: p.grid, bestLapMs: p.bestLapMs, subForTeamId: p.subForTeamId };
  }
  const newDrivers = Object.values(NEW_DRIVERS).filter((nd) => nd.id in driverPoints);

  // ---- Constructor R10 totals from the sheet (col index 13 = Race 10) ----
  const constructors = {};
  for (const cols of rows(CTOR_CSV)) {
    const name = (cols[2] || "").trim();
    if (!name || !/^\d+$/.test((cols[3] || "").trim())) continue;
    const teamId = TEAM_ID[norm(name)];
    const cell = (cols[13] || "").trim();
    if (!teamId || !/^\d+$/.test(cell)) continue;
    constructors[teamId] = Number(cell);
  }

  const out = { driverPoints, constructors, positions, newDrivers };
  writeFileSync("season7/race10.json", JSON.stringify(out, null, 1) + "\n");

  console.log("driverPoints entries:", Object.keys(driverPoints).length);
  console.log("constructors entries:", Object.keys(constructors).length, JSON.stringify(constructors));
  console.log("positions harvested:", Object.keys(positions).length);
  console.log("UNMATCHED sheet drivers with an R10 value (need alias or new driver):");
  console.log("  ", unmatched.length ? JSON.stringify(unmatched) : "(none)");
  // DB R10 drivers missing from the sheet points (sanity):
  const inSheet = new Set(Object.keys(driverPoints));
  const dbOnly = [...dbPos.keys()].filter((id) => !inSheet.has(id));
  console.log("DB-R10 drivers NOT in sheet R10:", dbOnly.length ? dbOnly.join(", ") : "(none)");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
