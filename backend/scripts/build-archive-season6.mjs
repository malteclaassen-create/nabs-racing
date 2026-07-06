// One-off generator: parse the Season-6 Google-Sheet HTML export (unzipped from
// the user's "NABS Standings S6.zip") into backend/archive/season6/season.json.
//
// S6 is fully self-contained in the sheet: per-race POINTS (Driver Standings) +
// per-race FINISHING POSITIONS (Drivers Result Input) + official driver & team
// totals + the Tier1/Tier2 constructor split. So we store per-race results
// directly (like Season 7) and the official totals as finalStandings.
//
// Usage: node scripts/build-archive-season6.mjs [path-to-unzipped-dir]
//   default path: ../../archive-material/6/_unzipped
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, process.argv[2] || "../../archive-material/6/_unzipped");
const OUT_DIR = resolve(HERE, "../archive/season6");

const TIER1 = ["Mclaren", "Redbull", "Brawn GP", "Porsche", "Aston Martin", "Ferrari", "Force India", "Mercedes", "Audi", "Leaper F1"];
const TIER2 = ["BMW", "Alfa Romeo", "Toyota", "Caterham", "Renault", "Torro Rosso", "Williams", "Lotus", "Volvo", "Honda"];
const COLORS = {
  Mclaren: "#C0C0C0", Redbull: "#1E41FF", "Brawn GP": "#B6FF00", Porsche: "#1AA39B",
  "Aston Martin": "#00594F", Ferrari: "#E10600", "Force India": "#FF80C7", Mercedes: "#00D2BE",
  Audi: "#BB0A30", "Leaper F1": "#8A2BE2", BMW: "#0066B1", "Alfa Romeo": "#9B0000",
  Toyota: "#EB0A1E", Caterham: "#0B573F", Renault: "#FFD800", "Torro Rosso": "#1634A0",
  Williams: "#00A3E0", Lotus: "#1A1A1A", Volvo: "#003057", Honda: "#CC0000",
};

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function tableRows(file) {
  const html = readFileSync(resolve(SRC, file), "utf8");
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
    [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
      c[1].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
    )
  );
}

// Normalise a per-race cell. Points sheet: number | "DNS"|"DNF"|"DSQ" | "".
function parsePoints(v) {
  if (v == null || v === "") return undefined; // did not participate this round
  const up = v.toUpperCase();
  if (["DNS", "DNF", "DSQ"].includes(up)) return { status: up };
  const n = Number(v);
  return Number.isFinite(n) ? { points: n } : undefined;
}
// Position sheet: "1" | "3, +" | "DNS"|"DNF" | "".
function parsePosition(v) {
  if (!v) return null;
  const m = /^(\d+)/.exec(v);
  return m ? Number(m[1]) : null;
}

// --- teams -----------------------------------------------------------------
const teams = [
  ...TIER1.map((n) => ({ id: slug(n), name: n, tier: 1, color: COLORS[n] || "#64748b" })),
  ...TIER2.map((n) => ({ id: slug(n), name: n, tier: 2, color: COLORS[n] || "#64748b" })),
  { id: "reserve", name: "Reserve", tier: 0, color: "#475569" },
];
const teamIdByName = new Map(teams.map((t) => [t.name.toLowerCase(), t.id]));
teamIdByName.set("reserve", "reserve");

// --- drivers + per-race points (Driver Standings) --------------------------
const dsRows = tableRows("Driver Standings.html");
const drivers = [];
const driverRaceResults = {};
const finalDrivers = [];
for (const c of dsRows) {
  // cells: [rownum, "", standing, driver, team, total, R1..R12, "", ""]
  const standing = Number(c[2]);
  const name = c[3];
  const team = c[4];
  const total = Number(c[5]);
  if (!Number.isInteger(standing) || !name || !team) continue;
  const id = slug(name);
  const teamId = teamIdByName.get(team.toLowerCase()) || "reserve";
  drivers.push({ id, name, discord: name, teamId, tier: teams.find((t) => t.id === teamId)?.tier ?? 0 });
  finalDrivers.push({ id, points: total });
  driverRaceResults[id] = c.slice(6, 18).map((v) => parsePoints(v) ?? null);
}

// --- finishing positions (Drivers Result Input) ----------------------------
const inRows = tableRows("Drivers Result Input.html");
const posByName = new Map();
for (const c of inRows) {
  // cells: [rownum, ID, driver, team, R1..R12, Name]
  const name = c[2];
  if (!name || name.toLowerCase() === "driver") continue;
  posByName.set(slug(name), c.slice(4, 16).map(parsePosition));
}
// Merge positions + statuses into the per-race result objects.
for (const d of drivers) {
  const positions = posByName.get(d.id) || [];
  const arr = driverRaceResults[d.id];
  for (let i = 0; i < 12; i++) {
    const cell = arr[i];
    const pos = positions[i] ?? null;
    if (cell == null) {
      // No points-sheet entry: if the input sheet shows a position/DNF, keep a 0.
      if (pos != null) arr[i] = { points: 0, position: pos, status: "FINISHED" };
      continue;
    }
    if (cell.status) {
      arr[i] = { status: cell.status, position: cell.status === "FINISHED" ? pos : null };
    } else {
      arr[i] = { points: cell.points, position: pos, status: "FINISHED" };
    }
  }
}

// --- constructor totals + per-race (Constructor Standings) -----------------
// The sheet lists each team's official points per race (Race1..12) and total.
// S6 drops each TEAM's worst 3 rounds (the OLD per-team rule), so we store the
// per-race team points and let the standings service apply that drop — this
// reproduces the constructor table exactly (subs make the live per-driver
// computation approximate, so the stored official values are authoritative).
const csRows = tableRows("Constructor Standings.html");
const finalTeams = [];
const teamPerRace = {};
for (const c of csRows) {
  const standing = Number(c[2]);
  const team = c[3];
  const total = Number(c[4]);
  if (!Number.isInteger(standing) || !team) continue;
  const teamId = teamIdByName.get(team.toLowerCase());
  if (!teamId) continue;
  finalTeams.push({ id: teamId, points: total });
  const per = {};
  c.slice(5, 17).forEach((v, i) => {
    const n = Number(v);
    if (Number.isFinite(n)) per[i + 1] = n;
  });
  teamPerRace[teamId] = per;
}

const season = {
  number: 6,
  name: "Season 6",
  game: "F1 2013 · Assetto Corsa",
  dropWorst: 3,
  pointsTable: null,
  teams,
  drivers,
  rounds: Array.from({ length: 12 }, (_, i) => ({ round: i + 1 })),
  driverRaceResults,
  finalStandings: { drivers: finalDrivers, teams: finalTeams, teamPerRace },
};

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "season.json"), JSON.stringify(season, null, 2), "utf8");
console.log(`Wrote season6/season.json: ${teams.length} teams, ${drivers.length} drivers, ${finalTeams.length} team totals`);
