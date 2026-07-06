// ---------------------------------------------------------------------------
// NABS Racing League - Season 7 seed
// Seeds teams, drivers, and the completed rounds R1-R10.
//
//   * Every completed round stores per-driver POINTS directly + verified
//     per-team constructor totals directly, all taken from the official sheet
//     (subs make constructor totals non-derivable from the two listed drivers).
//   * R1-R8 live in the inline tables below; R9 + R10 live in
//     season7/race9.json / race10.json and are written by writeStoredRace().
//   * Finishing positions/grid/best lap only enrich driver profiles; they do
//     not affect championship points.
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const prisma = new PrismaClient();

// Real finishing-order metadata (position, grid, best lap) per race, resolved
// from the AC race JSONs. See season7/generate-positions.mjs. Keyed by race
// number -> [{ driverId, position, grid, bestLapMs, dsq }]. Used to enrich the
// stored results for driver profiles; it does NOT change championship points.
const __dir = dirname(fileURLToPath(import.meta.url));
const RACE_POSITIONS = JSON.parse(
  readFileSync(join(__dir, "../season7/race-positions.json"), "utf8")
);

// R10 (Turkey) data taken from the official sheet: per-driver points + verified
// per-team constructor totals, plus finishing positions for profiles. Built by
// scripts/gen-r10.js (no AC JSON exists for R10). Stored like R1-R8.
const RACE_10 = JSON.parse(
  readFileSync(join(__dir, "../season7/race10.json"), "utf8")
);
const RACE_9 = JSON.parse(
  readFileSync(join(__dir, "../season7/race9.json"), "utf8")
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
// Each team gets a visually distinct colour (used for the progression charts,
// accent bars and standings). Several teams used to share #CC0000 / dark reds,
// which made the charts unreadable; the palette below keeps the recognisable
// liveries where possible but guarantees every team is distinguishable on both
// the dark and light themes. Tweakable per-team from the Admin → Teams tab.
const TEAMS = [
  { id: "porsche", name: "Porsche Martini", tier: 1, color: "#1AA39B" },
  { id: "mclaren", name: "McLaren", tier: 1, color: "#F58220" },
  { id: "ferrari", name: "Ferrari", tier: 1, color: "#E10600" },
  { id: "williams", name: "Williams", tier: 1, color: "#0067C0" },
  { id: "honda", name: "Honda", tier: 1, color: "#A33EA1" },
  { id: "renault", name: "Renault", tier: 2, color: "#BFA900" },
  { id: "super_aguri", name: "Super Aguri", tier: 2, color: "#D85E88" },
  { id: "spyker", name: "Spyker", tier: 2, color: "#C2410C" },
  { id: "torro_rosso", name: "Toro Rosso", tier: 2, color: "#3F6FB0" },
  { id: "redbull", name: "Red Bull", tier: 2, color: "#5A4FC4" },
  { id: "toyota", name: "Toyota", tier: 2, color: "#FF7A66" },
  { id: "bmw", name: "BMW Sauber", tier: 2, color: "#6E7B8B" },
  { id: "jaguar", name: "Jaguar", tier: 2, color: "#14935A" },
  { id: "fiat", name: "Fiat", tier: 2, color: "#B3446C" },
  { id: "lamborghini", name: "Lamborghini", tier: 2, color: "#8DB600" },
  { id: "ncb_mugen", name: "NCB Mugen", tier: 2, color: "#2E9BD6" },
  { id: "lotus", name: "Lotus", tier: 2, color: "#E6A700" },
  { id: "reserve", name: "Reserve", tier: 0, color: "#888888" },
];

// Teams with a logo image in frontend/public/teams/<id>.png (lotus & reserve have none).
const TEAMS_WITH_LOGO = new Set([
  "porsche", "mclaren", "ferrari", "williams", "honda", "renault", "super_aguri",
  "spyker", "torro_rosso", "redbull", "toyota", "bmw", "jaguar", "fiat",
  "lamborghini", "ncb_mugen",
]);

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
  // Newcomers seen only in R10 (official sheet).
  "microlin", "waka",
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
const UPCOMING_RACES = [11, 12].map((n) => ({
  number: n,
  track: SCHEDULE[n].track,
  date: SCHEDULE[n].date,
}));

// Non-championship special events (shown on the calendar, not scored).
const SPECIAL_EVENTS = [
  { track: "Watkins Glen 2.5", date: "2026-04-25T18:00:00Z" },
  { track: "NASCAR Oval", date: "2026-06-06T18:00:00Z" },
  { track: "Le Mans 2.5", date: "2026-06-26T18:00:00Z" },
];

const STATUS_STRINGS = new Set(["DNS", "DNF", "DSQ"]);

// Writes a race whose driver points and constructor totals are taken directly
// from the official sheet (data = { driverPoints, constructors, positions }).
// driverPoints values are a number (finished, that many points) or a status
// string (DNS/DNF/DSQ -> 0). Positions only enrich profiles. Pure no-shows
// (DNS with no finishing position) get no row, to match how R1-R8 are stored.
async function writeStoredRace(raceId, data, teamTier) {
  for (const [driverId, v] of Object.entries(data.driverPoints)) {
    const isStatus = STATUS_STRINGS.has(v);
    const p = data.positions[driverId];
    if (isStatus && v === "DNS" && !p) continue; // no-show -> skip
    await prisma.raceResult.create({
      data: {
        raceId,
        driverId,
        status: isStatus ? v : "FINISHED",
        points: isStatus ? 0 : Number(v),
        subForTeamId: p?.subForTeamId ?? null,
        position: p ? p.position : null,
        grid: p ? p.grid : null,
        bestLapMs: p ? p.bestLapMs : null,
      },
    });
  }
  const cScores = Object.entries(data.constructors).map(([teamId, points]) => ({
    raceId, teamId, tier: teamTier.get(teamId), points,
  }));
  await prisma.constructorRaceScore.createMany({ data: cScores });
}

async function main() {
  console.log("Seeding NABS Racing League...");

  // Wipe (idempotent reseed) — SCOPED to Season 7, the only season this seed
  // creates. Archive seasons 1-6 (imported via `npm run import:archive`) and
  // any future seasons created in the admin stay untouched, so a reseed no
  // longer destroys them. RSVPs / seat offers / interests that reference S7
  // drivers are removed explicitly first (they don't cascade off a driver).
  const SID = SEASON.id;
  await prisma.raceRsvp.deleteMany({
    where: { OR: [{ driver: { seasonId: SID } }, { race: { seasonId: SID } }] },
  });
  await prisma.seatInterest.deleteMany({
    where: { OR: [{ driver: { seasonId: SID } }, { offer: { race: { seasonId: SID } } }] },
  });
  await prisma.seatOffer.deleteMany({
    where: { OR: [{ race: { seasonId: SID } }, { driver: { seasonId: SID } }, { filledBy: { seasonId: SID } }] },
  });
  await prisma.constructorRaceScore.deleteMany({ where: { race: { seasonId: SID } } });
  await prisma.raceResult.deleteMany({
    where: { OR: [{ race: { seasonId: SID } }, { driver: { seasonId: SID } }] },
  });
  await prisma.race.deleteMany({ where: { seasonId: SID } });
  await prisma.driver.deleteMany({ where: { seasonId: SID } });
  await prisma.team.deleteMany({ where: { seasonId: SID } });
  await prisma.season.deleteMany({ where: { id: SID } });

  // Season 7 (the seeded season) becomes THE active season — exactly one
  // season may be active, so anything else active is switched off first.
  await prisma.season.updateMany({ where: { isActive: true }, data: { isActive: false } });
  await prisma.season.create({ data: { ...SEASON, isActive: true } });
  const seasonId = SEASON.id;

  // Teams
  for (const t of TEAMS) {
    await prisma.team.create({
      data: { ...t, seasonId, logoUrl: TEAMS_WITH_LOGO.has(t.id) ? `/teams/${t.id}.png` : null },
    });
  }

  // Drivers
  const allDrivers = [...T1_DRIVERS, ...T2_DRIVERS, ...RESERVE_DRIVERS];
  for (const d of allDrivers) {
    await prisma.driver.create({
      data: { id: d.id, name: d.name, discordName: d.discord, teamId: d.teamId, tier: d.tier, seasonId },
    });
  }
  console.log(`  ${TEAMS.length} teams, ${allDrivers.length} drivers`);

  // Races 1..10 (completed)
  const races = {};
  for (let n = 1; n <= 10; n++) {
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

  // Special events (no round number, not scored)
  for (const se of SPECIAL_EVENTS) {
    await prisma.race.create({
      data: {
        number: null,
        track: se.track,
        date: se.date ? new Date(se.date) : null,
        isCompleted: false,
        isSpecialEvent: true,
        seasonId,
      },
    });
  }

  // ----- R1..R8: store driver points + verified constructor scores ---------
  // Who actually drove for which team each round (lineups changed constantly:
  // reserves subbing in, regulars helping other teams, third cars scoring for
  // nobody). Reconstructed 2026-07-02/03 from the official sheet's per-round
  // constructor scores and confirmed against the team icons in the Discord
  // result posts (R1-R10): with these assignments every round's recomputed
  // Tier-1 AND Tier-2 scores match the official numbers exactly. "reserve" =
  // drove that round without team credit (tier-0 team, excluded from
  // scoring). Details: backend/prisma/SEASON7-DATA-NOTES.md
  const SUB_ASSIGNMENTS = {
    1: {
      tball: "mclaren", jomilan: "williams", spydermonkey: "honda", pizd: "jaguar",
      crans3: "lamborghini", wulffo: "super_aguri", airlineure: "jaguar",
      wal_rider: "toyota", danielj: "bmw", epygames: "lotus",
      kowandoh_badu: "reserve", zero0n1k: "reserve",
    },
    2: {
      tball: "mclaren", spydermonkey: "williams", kowandoh_badu: "honda",
      pizd: "jaguar", damien: "spyker", jp_bekker: "toyota",
      jacob_ordonez: "reserve", zero0n1k: "reserve",
    },
    3: { tball: "mclaren", spydermonkey: "redbull", zero0n1k: "super_aguri", flo: "toyota" },
    4: {
      tj09: "ferrari", gabriele_grossi: "bmw", jadend: "super_aguri",
      zero0n1k: "redbull", tischler: "redbull", oshy: "toyota", jp_bekker: "renault",
    },
    5: {
      jomilan: "porsche", crans3: "mclaren", airlineure: "spyker", zero0n1k: "jaguar",
      tischler: "ncb_mugen", jp_bekker: "toyota", gabriele_grossi: "torro_rosso",
    },
    6: {
      jomilan: "porsche", tball: "mclaren", gabriele_grossi: "ncb_mugen",
      zero0n1k: "lotus", urmagaeddon: "lamborghini",
    },
    7: {
      spydermonkey: "williams", jomilan: "honda", thatdudeguest: "mclaren",
      zohair_khan: "jaguar", oshy: "bmw",
    },
    8: {
      thatdudeguest: "honda", dablosv5: "super_aguri", toni_t: "spyker",
      zohair_khan: "redbull", oshy: "lamborghini",
    },
  };

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
        subForTeamId: SUB_ASSIGNMENTS[n]?.[driverId] ?? null,
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
          subForTeamId: SUB_ASSIGNMENTS[n]?.[p.driverId] ?? null,
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

  // ----- R9 (Imola) & R10 (Turkey): stored from the official sheet -----------
  // Same model as R1-R8: per-driver points and per-team constructor totals are
  // taken straight from the sheet; finishing positions only enrich profiles.
  // (R9's raw AC order differed from the sheet's final classification, so we
  // store the sheet values rather than recomputing.)
  const teamTier = new Map(TEAMS.map((t) => [t.id, t.tier]));
  await writeStoredRace(races[9].id, RACE_9, teamTier);
  await writeStoredRace(races[10].id, RACE_10, teamTier);

  console.log("  R1-R10 results + constructor scores written");
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
