// ---------------------------------------------------------------------------
// NABS Racing League - Season 7 seed
// Seeds teams, drivers, R1-R8 historical points, and R9 (Imola) full results.
//
//   * R1-R8: per-driver POINTS stored directly; verified per-race constructor
//            totals stored directly (subs make them non-derivable from the two
//            listed tier drivers).
//   * R9   : finishing POSITIONS stored; driver + constructor points computed
//            by the points calculator (saveRaceResults).
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { saveRaceResults } from "../src/services/raceWriter.js";

const prisma = new PrismaClient();

// Real finishing-order metadata (position, grid, best lap) per race, resolved
// from the AC race JSONs. See season7/generate-positions.mjs. Keyed by race
// number -> [{ driverId, position, grid, bestLapMs, dsq }]. Used to enrich the
// stored results for driver profiles; it does NOT change championship points.
const __dir = dirname(fileURLToPath(import.meta.url));
const RACE_POSITIONS = JSON.parse(
  readFileSync(join(__dir, "../season7/race-positions.json"), "utf8")
);

const DEFAULT_PIN = "nabs2026";

// --- SEASON ----------------------------------------------------------------
// All seeded data belongs to Season 7 (F1 2007). Later seasons are created via
// the admin tab, not seeded here.
const SEASON = {
  id: "season7",
  number: 7,
  name: "Season 7",
  game: "F1 2007 · Assetto Corsa",
};

// --- TEAMS -----------------------------------------------------------------
const TEAMS = [
  { id: "porsche", name: "Porsche Martini", tier: 1, color: "#8B0000" },
  { id: "mclaren", name: "McLaren", tier: 1, color: "#FF8000" },
  { id: "ferrari", name: "Ferrari", tier: 1, color: "#DC0000" },
  { id: "williams", name: "Williams", tier: 1, color: "#005AFF" },
  { id: "honda", name: "Honda", tier: 1, color: "#CC0000" },
  { id: "renault", name: "Renault", tier: 2, color: "#E5C200" },
  { id: "super_aguri", name: "Super Aguri", tier: 2, color: "#CC0000" },
  { id: "spyker", name: "Spyker", tier: 2, color: "#CC6600" },
  { id: "torro_rosso", name: "Torro Rosso", tier: 2, color: "#1B1B8F" },
  { id: "redbull", name: "Red Bull", tier: 2, color: "#0A1851" },
  { id: "toyota", name: "Toyota", tier: 2, color: "#CC0000" },
  { id: "bmw", name: "BMW Sauber", tier: 2, color: "#5A5A5A" },
  { id: "jaguar", name: "Jaguar", tier: 2, color: "#006B3E" },
  { id: "fiat", name: "Fiat", tier: 2, color: "#DD0000" },
  { id: "lamborghini", name: "Lamborghini", tier: 2, color: "#E58000" },
  { id: "ncb_mugen", name: "NCB Mugen", tier: 2, color: "#CC0000" },
  { id: "lotus", name: "Lotus", tier: 2, color: "#1A1A1A" },
  { id: "reserve", name: "Reserve", tier: 0, color: "#888888" },
];

// --- DRIVERS (Tier 1) ------------------------------------------------------
const T1_DRIVERS = [
  { id: "13bot", name: "13bot", discord: "13bot (Not a Bot)", teamId: "porsche", tier: 1 },
  { id: "mtimmis", name: "Mtimmis", discord: "Timmy 'Bunker' Gilmore", teamId: "porsche", tier: 1 },
  { id: "siggsta", name: "Siggsta", discord: "Siggidy", teamId: "mclaren", tier: 1 },
  { id: "jomilan", name: "JoMilan", discord: "JoMilan", teamId: "mclaren", tier: 1 },
  { id: "takoda", name: "Takoda", discord: "Tafourthda", teamId: "ferrari", tier: 1 },
  { id: "steve", name: "Steve", discord: "Steven P6. Cheese", teamId: "ferrari", tier: 1 },
  { id: "maltegoat", name: "Maltegoat", discord: "Maltegoat", teamId: "williams", tier: 1 },
  { id: "pizd", name: "Pizd", discord: "Pizd", teamId: "williams", tier: 1 },
  { id: "rayman", name: "Rayman", discord: "Rayman", teamId: "honda", tier: 1 },
  { id: "rashford", name: "Rashford", discord: "Marcus Rashford", teamId: "honda", tier: 1 },
];

// --- DRIVERS (Tier 2) ------------------------------------------------------
const T2_DRIVERS = [
  { id: "vibe_officer", name: "Vibe Officer", discord: "VIBE_OFFICER", teamId: "renault", tier: 2 },
  { id: "j_yamanaka", name: "J. Yamanaka", discord: "J. Yamanaka (山中)", teamId: "renault", tier: 2 },
  { id: "hedimak", name: "Hedimak", discord: "[FWE]hedimakk", teamId: "super_aguri", tier: 2 },
  { id: "jacob_ordonez", name: "Jacob Ordonez", discord: "Jacob Ordoñez", teamId: "super_aguri", tier: 2 },
  { id: "goldginger", name: "GoldGinger", discord: "GoldGinger", teamId: "spyker", tier: 2 },
  { id: "jadend", name: "JadenDMotorports", discord: "Jaden D-Ankrah", teamId: "spyker", tier: 2 },
  { id: "jp_bekker", name: "JP Bekker", discord: "JP Bekker", teamId: "torro_rosso", tier: 2 },
  { id: "aleks", name: "Aleks", discord: "aleks", teamId: "torro_rosso", tier: 2 },
  { id: "dras", name: "DRAS", discord: "DRAS", teamId: "redbull", tier: 2 },
  { id: "justyn", name: "Justyn", discord: "Justyn", teamId: "redbull", tier: 2 },
  { id: "kowandoh_badu", name: "Kowandoh Badu", discord: "Kowandoh Badu", teamId: "toyota", tier: 2 },
  { id: "aliveaxe", name: "Aliveaxe", discord: "aliveaxe", teamId: "toyota", tier: 2 },
  { id: "nottyler", name: "NotTyler", discord: "NotTyler", teamId: "bmw", tier: 2 },
  { id: "zero0n1k", name: "Zero0n1k", discord: "Zer0n1k", teamId: "bmw", tier: 2 },
  { id: "vhp", name: "VHP", discord: "VugPuh", teamId: "jaguar", tier: 2 },
  { id: "flo", name: "Flo", discord: "Flo", teamId: "jaguar", tier: 2 },
  { id: "laluch", name: "Laluch", discord: "Laluch", teamId: "fiat", tier: 2 },
  { id: "endriu", name: "Endriu", discord: "Endriu", teamId: "fiat", tier: 2 },
  { id: "tischler", name: "Tischler", discord: "Tischler", teamId: "lamborghini", tier: 2 },
  { id: "manro45gt", name: "Manro45GT", discord: "Menry | Duck Drivers", teamId: "lamborghini", tier: 2 },
  { id: "naigouu", name: "Naigouu", discord: "Naigouu", teamId: "ncb_mugen", tier: 2 },
  { id: "kalervo", name: "Kalervo", discord: "Kalervo77", teamId: "ncb_mugen", tier: 2 },
  { id: "neesh", name: "Neesh", discord: "Neesh", teamId: "lotus", tier: 2 },
  { id: "duck", name: "Duck", discord: "Duck", teamId: "lotus", tier: 2 },
];

// --- RESERVE DRIVERS (Tier 0) ----------------------------------------------
const RESERVE_IDS = [
  "tball", "spydermonkey", "thatdudeguest", "crans3", "airlineure", "gabriele_grossi",
  "dablosv5", "tj09", "wal_rider", "danielj", "anxo_gonzalez", "dylan", "zohair_khan",
  "urmagaeddon", "zyklopus", "epygames", "oshy", "damien", "jim_hulborn", "jamal_bin_laden",
  "mora", "gaspaddle", "ryan_h", "jan_sikorski", "luka", "danbo", "juuso_salonen", "frusty",
  "rikkos", "mitch", "shinso", "armin", "phil_mccrack", "tomzee", "william_granberg", "svr",
  "cr", "jorge_caro", "bulat", "garfieldtruck99", "amrito", "szymon_karwowski", "simaoav",
  "gallus", "kobac", "alex_lehoux", "qfasty", "payton_fricker", "freddson", "meme_ruler", "toni_t",
  // Newcomers seen only in the S7 race JSONs (added for the full position import).
  "marquez5", "mr_kettama", "oilver_ramsey", "ryotaro_takahashi", "wulffo", "xucc",
  "birmigam_sped_stars", "ghost",
];

// Nicer display names for reserves where simple title-casing isn't ideal.
const RESERVE_DISPLAY = {
  thatdudeguest: "ThatDudeGuest",
  zohair_khan: "Zohair Khan",
  epygames: "EpyGames",
  urmagaeddon: "urmagaeddon",
  zyklopus: "Zyklopus",
  spydermonkey: "SpyderMonkey",
  garfieldtruck99: "GarfieldTruck99",
  dablosv5: "DablosV5",
  tj09: "TJ09",
  svr: "SVR",
  cr: "CR",
  phil_mccrack: "Phil McCrack",
  meme_ruler: "Meme Ruler",
  marquez5: "Marquez5",
  mr_kettama: "Mr. Kettama",
  oilver_ramsey: "Oilver Ramsey",
  ryotaro_takahashi: "Ryotaro Takahashi",
  birmigam_sped_stars: "birmigam sped stars",
  ghost: "ghost",
};

function titleCase(id) {
  return id
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

const RESERVE_DRIVERS = RESERVE_IDS.map((id) => ({
  id,
  name: RESERVE_DISPLAY[id] || titleCase(id),
  discord: RESERVE_DISPLAY[id] || titleCase(id),
  teamId: "reserve",
  tier: 0,
}));

// --- DRIVER POINTS PER RACE (R1..R9). number=points, string=status/0, null=DNP
const DRIVER_RACE_SCORES = {
  "13bot": [35, 35, null, null, null, null, 25, 22, 0],
  mtimmis: [14, 8, 25, 30, 30, 6, 20, 30, 30],
  siggsta: [25, 18, 35, 35, 22, 12, 22, 25, 20],
  jomilan: [18, null, null, null, 35, 30, 10, 8, 0],
  takoda: [20, 25, 22, 22, "DSQ", 22, 35, 18, 12],
  steve: [12, 20, 20, null, 20, 10, 14, 14, 18],
  maltegoat: [null, 30, 14, 25, 25, 35, null, 12, 22],
  pizd: [16, 16, 6, 18, 14, 14, 18, 20, 25],
  rayman: [8, null, null, 0, 12, null, null, 5, 0],
  rashford: [null, null, null, 0, 18, 0, 16, null, 14],
  vibe_officer: [4, 1, 5, 8, 3, 4, 2, 0, 5],
  j_yamanaka: ["DNF", 14, null, null, 0, 25, 0, 0, 0],
  hedimak: [null, 5, "DNF", 2, 10, 5, 0, null, 0],
  jacob_ordonez: ["DNF", 3, null, null, 0, null, 0, null, 0],
  goldginger: [1, 0, 0, 12, 7, 18, 1, 0, 8],
  jadend: [null, null, null, 3, null, null, null, null, 0],
  jp_bekker: [null, 0, null, 0, 0, 0, 0, 0, 0],
  aleks: [22, 10, null, 20, "DSQ", null, null, "DNF", 16],
  dras: [null, null, 3, null, 0, 8, 6, 10, 4],
  justyn: [0, 0, null, null, 0, 0, null, null, 1],
  kowandoh_badu: [6, 4, 7, 16, "DSQ", null, 8, 3, 7],
  aliveaxe: [0, 0, null, null, null, null, 0, 2, 6],
  nottyler: [3, 6, 12, null, 16, 7, null, 16, 10],
  zero0n1k: [0, 0, 4, 0, 1, 0, 0, 0, 0],
  vhp: [null, 0, null, 10, 0, null, null, 0, 0],
  flo: [null, null, null, null, "DSQ", 1, 4, 0, 0],
  laluch: [0, 0, 2, 0, 0, 2, 0, "DNF", 0],
  endriu: [0, 0, 1, 0, 2, 0, 0, 0, 0],
  tischler: [null, null, null, 0, 0, 0, 0, null, 0],
  manro45gt: [5, 0, 16, 6, "DSQ", null, 3, 7, 0],
  naigouu: ["DSQ", null, null, null, null, 0, 0, null, 0],
  kalervo: [2, null, null, 7, 6, null, 0, 6, 0],
  neesh: [0, 0, 10, 4, null, null, 7, 0, 3],
  duck: [null, 2, 8, 14, 5, 20, 30, 4, 0],
  tball: [30, 22, 30, null, null, 16, null, null, 0],
  spydermonkey: [10, 12, 18, "DNF", "DNF", "DNF", 12, null, 0],
  thatdudeguest: [null, null, null, null, null, "DSQ", 5, 35, 35],
  crans3: [7, "DNF", "DNF", null, 8, null, null, null, 0],
  airlineure: [0, 7, null, null, 4, "DSQ", null, null, 0],
  gabriele_grossi: [0, null, 0, 5, 0, 3, null, "DNF", 0],
  dablosv5: [null, null, null, null, null, null, null, 1, 0],
  tj09: [null, null, null, 1, null, null, null, null, 0],
  wal_rider: [0, 0, "DSQ", null, null, null, null, null, 0],
  danielj: [0, "DSQ", "DNF", null, "DNF", null, null, null, 0],
  anxo_gonzalez: [null, null, null, 0, null, null, null, null, 0],
  dylan: [null, null, null, null, null, null, null, 0, 0],
  zohair_khan: [null, null, null, null, null, null, 0, 0, 2],
  urmagaeddon: [null, null, null, null, 0, 0, 0, null, 0],
  epygames: [0, null, null, null, null, null, null, null, 0],
  oshy: [null, null, null, 0, null, null, 0, 0, 0],
  damien: [null, 0, null, null, null, null, null, null, 0],
  jim_hulborn: [0, null, null, null, null, null, null, null, 0],
  jamal_bin_laden: [0, null, null, null, null, null, null, null, 0],
  mora: [0, null, null, 0, null, null, null, null, 0],
  gaspaddle: [null, 0, null, "DNF", null, null, null, null, 0],
  ryan_h: [null, null, null, "DNF", "DNF", null, null, null, 0],
  jan_sikorski: [null, null, null, "DNF", null, null, null, null, 0],
  luka: ["DNF", null, null, null, null, null, null, null, 0],
  danbo: ["DNF", null, null, null, null, null, null, null, 0],
  juuso_salonen: [null, null, "DNF", null, "DNF", null, null, null, 0],
  frusty: [null, "DSQ", null, null, null, null, null, null, 0],
  zyklopus: [null, null, null, null, null, null, "DSQ", null, 0],
};

// --- VERIFIED CONSTRUCTOR POINTS PER RACE (R1..R9) -------------------------
const T1_CONSTRUCTOR_POINTS = {
  porsche: [49, 43, 25, 30, 65, 36, 45, 52, 30],
  mclaren: [55, 40, 65, 35, 30, 28, 27, 33, 55],
  williams: [18, 42, 20, 43, 39, 49, 30, 32, 47],
  ferrari: [32, 45, 42, 23, 20, 32, 49, 32, 30],
  honda: [18, 4, 0, 0, 30, 0, 26, 40, 14],
};

const T2_CONSTRUCTOR_POINTS = {
  lotus: [6, 30, 42, 35, 20, 37, 60, 25, 14],
  renault: [20, 46, 16, 19, 23, 51, 28, 19, 18],
  bmw: [25, 22, 25, 12, 35, 20, 9, 39, 36],
  redbull: [5, 14, 47, 11, 12, 24, 22, 36, 26],
  toyota: [14, 5, 25, 34, 4, 0, 32, 34, 42],
  spyker: [14, 14, 6, 22, 43, 25, 14, 18, 25],
  jaguar: [40, 42, 0, 20, 18, 10, 28, 2, 8],
  lamborghini: [47, 8, 30, 14, 0, 12, 18, 26, 2],
  torro_rosso: [35, 25, 0, 35, 3, 3, 0, 0, 35],
  super_aguri: [12, 20, 14, 15, 31, 18, 7, 14, 0],
  ncb_mugen: [16, 0, 0, 16, 27, 19, 7, 22, 0],
  fiat: [4, 11, 18, 5, 22, 18, 13, 3, 5],
};

// --- RACE 9 (Imola) finishing positions ------------------------------------
const RACE_9_POSITIONS = [
  { driverId: "thatdudeguest", pos: 1, subForTeamId: "mclaren" },
  { driverId: "mtimmis", pos: 2 },
  { driverId: "pizd", pos: 3 },
  { driverId: "maltegoat", pos: 4 },
  { driverId: "siggsta", pos: 5 },
  { driverId: "steve", pos: 6 },
  { driverId: "aleks", pos: 7 },
  { driverId: "rashford", pos: 8 },
  { driverId: "takoda", pos: 9 },
  { driverId: "nottyler", pos: 10 },
  { driverId: "goldginger", pos: 11 },
  { driverId: "kowandoh_badu", pos: 12 },
  { driverId: "aliveaxe", pos: 13 },
  { driverId: "vibe_officer", pos: 14 },
  { driverId: "dras", pos: 15 },
  { driverId: "neesh", pos: 16 },
  { driverId: "zohair_khan", pos: 17, subForTeamId: null },
  { driverId: "justyn", pos: 18 },
  { driverId: "flo", pos: 19 },
  { driverId: "epygames", pos: 20, subForTeamId: null },
  { driverId: "13bot", pos: 21 },
  { driverId: "zero0n1k", pos: 22 },
  { driverId: "endriu", pos: 23 },
  { driverId: "urmagaeddon", pos: 24, subForTeamId: null },
  { driverId: "zyklopus", pos: 25, subForTeamId: null },
  { driverId: "tischler", pos: 26 },
];

// Official Season 7 calendar (championship rounds). Fridays 18:00 GMT.
// Special events (Watkins Glen, NASCAR Oval, Le Mans) are not championship
// rounds and are shown only on the Calendar page (not stored as races).
const SCHEDULE = {
  1: { track: "Melbourne", date: "2026-04-10T18:00:00Z" },
  2: { track: "Mugello", date: "2026-04-17T18:00:00Z" },
  3: { track: "Most", date: "2026-05-01T18:00:00Z" },
  4: { track: "Bahrain", date: "2026-05-08T18:00:00Z" },
  5: { track: "Monza", date: "2026-05-15T18:00:00Z" },
  6: { track: "Jeddah", date: "2026-05-22T18:00:00Z" },
  7: { track: "Nurburgring", date: "2026-05-29T18:00:00Z" },
  8: { track: "Spa", date: "2026-06-05T18:00:00Z" },
  9: { track: "Imola", date: "2026-06-12T18:00:00Z" },
  10: { track: "Turkey", date: "2026-06-19T18:00:00Z" },
  11: { track: "COTA", date: "2026-07-03T18:00:00Z" },
  12: { track: "Interlagos", date: "2026-07-10T18:00:00Z" },
};

const RACE_TRACKS = Object.fromEntries(
  Object.entries(SCHEDULE).map(([n, v]) => [n, v.track])
);

// Upcoming rounds open for driver sign-up (RSVP).
const UPCOMING_RACES = [10, 11, 12].map((n) => ({
  number: n,
  track: SCHEDULE[n].track,
  date: SCHEDULE[n].date,
}));

const STATUS_STRINGS = new Set(["DNS", "DNF", "DSQ"]);

async function main() {
  console.log("Seeding NABS Racing League...");

  // Wipe (idempotent reseed)
  await prisma.constructorRaceScore.deleteMany();
  await prisma.raceResult.deleteMany();
  await prisma.race.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.team.deleteMany();
  await prisma.season.deleteMany();

  // Season 7 (the only seeded season; the active one)
  await prisma.season.create({ data: { ...SEASON, isActive: true } });
  const seasonId = SEASON.id;

  // Teams
  for (const t of TEAMS) await prisma.team.create({ data: { ...t, seasonId } });

  // Drivers
  const allDrivers = [...T1_DRIVERS, ...T2_DRIVERS, ...RESERVE_DRIVERS];
  for (const d of allDrivers) {
    await prisma.driver.create({
      data: { id: d.id, name: d.name, discordName: d.discord, teamId: d.teamId, tier: d.tier, seasonId },
    });
  }
  console.log(`  ${TEAMS.length} teams, ${allDrivers.length} drivers`);

  // Races 1..9 (completed)
  const races = {};
  for (let n = 1; n <= 9; n++) {
    races[n] = await prisma.race.create({
      data: {
        number: n,
        track: RACE_TRACKS[n],
        date: SCHEDULE[n].date ? new Date(SCHEDULE[n].date) : null,
        isCompleted: true,
        seasonId,
      },
    });
  }

  // Upcoming races 10..12 (open for sign-up / RSVP)
  for (const up of UPCOMING_RACES) {
    races[up.number] = await prisma.race.create({
      data: {
        number: up.number,
        track: up.track,
        date: up.date ? new Date(up.date) : null,
        isCompleted: false,
        seasonId,
      },
    });
  }

  // ----- R1..R8: store driver points + verified constructor scores ---------
  for (let n = 1; n <= 8; n++) {
    const raceId = races[n].id;
    const idx = n - 1;

    // Real finishing order from the AC JSON: driverId -> metadata.
    const posMap = new Map(
      (RACE_POSITIONS[n] || []).map((p) => [p.driverId, p])
    );
    const written = new Set();

    // Drivers with a stored historical score: keep their official points/status,
    // enrich with the real finishing position / grid / best lap.
    for (const [driverId, scores] of Object.entries(DRIVER_RACE_SCORES)) {
      const v = scores[idx];
      if (v === null || v === undefined) continue; // did not participate
      const p = posMap.get(driverId);
      const meta = {
        position: p ? p.position : null,
        grid: p ? p.grid : null,
        bestLapMs: p ? p.bestLapMs : null,
      };
      const isStatus = STATUS_STRINGS.has(v);
      await prisma.raceResult.create({
        data: {
          raceId,
          driverId,
          status: isStatus ? v : "FINISHED",
          points: isStatus ? 0 : Number(v),
          ...meta,
        },
      });
      written.add(driverId);
    }

    // Drivers who took part (in the JSON) but scored no championship points and
    // weren't in the historical table — add them so profiles see every start.
    for (const p of RACE_POSITIONS[n] || []) {
      if (written.has(p.driverId)) continue;
      await prisma.raceResult.create({
        data: {
          raceId,
          driverId: p.driverId,
          status: p.dsq ? "DSQ" : "FINISHED",
          points: 0,
          position: p.position,
          grid: p.grid,
          bestLapMs: p.bestLapMs,
        },
      });
    }

    const cScores = [];
    for (const [teamId, arr] of Object.entries(T1_CONSTRUCTOR_POINTS))
      cScores.push({ raceId, teamId, tier: 1, points: arr[idx] });
    for (const [teamId, arr] of Object.entries(T2_CONSTRUCTOR_POINTS))
      cScores.push({ raceId, teamId, tier: 2, points: arr[idx] });
    await prisma.constructorRaceScore.createMany({ data: cScores });
  }

  // ----- R9: store positions, compute driver + constructor points ----------
  const r9meta = new Map((RACE_POSITIONS[9] || []).map((p) => [p.driverId, p]));
  const r9Results = RACE_9_POSITIONS.map((r) => {
    const p = r9meta.get(r.driverId);
    return {
      driverId: r.driverId,
      position: r.pos,
      status: "FINISHED",
      subForTeamId: r.subForTeamId || null,
      penaltyPositions: 0,
      grid: p ? p.grid : null,
      bestLapMs: p ? p.bestLapMs : null,
    };
  });
  await saveRaceResults(prisma, races[9].id, r9Results);

  console.log("  R1-R9 results + constructor scores written");
  console.log("Done.");
}

async function seedSettings() {
  const hash = await bcrypt.hash(DEFAULT_PIN, 10);
  await prisma.setting.upsert({
    where: { key: "admin_pin_hash" },
    update: {}, // don't overwrite a changed PIN on reseed
    create: { key: "admin_pin_hash", value: hash },
  });
}

main()
  .then(seedSettings)
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
