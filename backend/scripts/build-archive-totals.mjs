// Generator for the TOTALS-ONLY archive seasons (1-5): parse each
// backend/archive/season<N>/standings.txt (one driver per line, format
// "@Name :Team: - N Points") into season.json (roster + official finalStandings,
// no per-race data). Team totals are taken from an explicit table when we have
// the official constructor sheet (S3/S4), otherwise summed from the drivers'
// points (S1/S2/S5 — the full constructor tables weren't in the source).
//
// Usage: node scripts/build-archive-totals.mjs [seasonNumber|all]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHIVE = resolve(HERE, "../archive");

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Emoji/short label -> canonical team display name.
const TEAM_ALIAS = {
  nabslogo: "Reserve", reserve: "Reserve",
  jaguarf1: "Jaguar", bmwsauberf1: "BMW Sauber", williamsf1: "Williams", peugeotf1: "Peugeot",
  renaultf1: "Renault", superagurif1: "Super Aguri", hondaf1: "Honda", torrorossof1: "Toro Rosso",
  toyotaf1: "Toyota", redbull: "Red Bull", mclaren: "McLaren", irc: "IRC", cadillac: "Cadillac",
  ford: "Ford", astonmartin: "Aston Martin", bmw: "BMW", haas: "Haas", "redbull racing": "RedBull Racing",
};
const canonTeam = (raw) => {
  const key = raw.trim().toLowerCase();
  return TEAM_ALIAS[key] || raw.trim();
};

// Canonical name (lowercased) -> brand colour. Fallback: deterministic hash.
const COLORS = {
  jaguar: "#0B4619", "bmw sauber": "#0066B1", mclaren: "#FF8000", williams: "#00A3E0",
  peugeot: "#00509D", renault: "#FFD800", "super aguri": "#E00000", honda: "#C00000",
  "toro rosso": "#1634A0", toyota: "#EB0A1E", "red bull": "#1E41FF", ferrari: "#E10600",
  caterham: "#0B573F", lotus: "#1A1A1A", irc: "#6A0DAD", sauber: "#9B0000", minardi: "#3A3A3A",
  bar: "#B0B0B0", jordan: "#FFD500", "force india": "#FF80C7", mercedes: "#00D2BE", hrt: "#9AA0A6",
  arrows: "#FF7A00", brawn: "#B6FF00", "redbull racing": "#1E41FF", virgin: "#C8102E", bmw: "#0066B1",
  haas: "#B6BABD", alpine: "#0093CC", cadillac: "#C79E5A", audi: "#BB0A30", ford: "#00234B",
  "aston martin": "#00594F", tyrrell: "#1D3F8F", "leyton house": "#59B0E6", "ncb racetech": "#7A2E8E",
  "ocean breeze racing": "#12B5B0", "miku racing team": "#39C5BB", "bentley irc racing": "#0E4D2A",
  "togg racing team": "#C8102E", "volvo racing": "#003057",
};
function colorFor(name) {
  const key = name.toLowerCase();
  if (COLORS[key]) return COLORS[key];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
}

function parseStandings(file) {
  const out = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const at = line.indexOf("@");
    if (at < 0) continue;
    const rest = line.slice(at + 1);
    const teamM = rest.match(/:([^:]+):/);
    const team = canonTeam(teamM ? teamM[1] : "Reserve");
    const ptsM = rest.match(/-\s*(\d+)\s*Points?/i);
    const points = ptsM ? Number(ptsM[1]) : 0;
    // Name = text up to the first " :", " -" or " (".
    const name = rest.split(/\s+:|\s+-\s|\s+\(/)[0].trim();
    if (name) out.push({ name, team, points });
  }
  return out;
}

// Per-season config. `teamTotals` (canonical name -> points) is the OFFICIAL
// constructor table where we have it; otherwise team totals are summed.
const CONFIGS = {
  1: {
    name: "Season 1", game: "F1 2007 · Assetto Corsa",
    teamTotals: { Jaguar: 114, "BMW Sauber": 68, Williams: 49, McLaren: 42, Honda: 40, "Super Aguri": 40, Peugeot: 35, Renault: 26, Toyota: 20, "Red Bull": 12, "Toro Rosso": 10 },
  },
  2: { name: "Season 2", game: "F1 2005 · Assetto Corsa" },
  3: {
    name: "Season 3", game: "F1 2010 · Assetto Corsa",
    teamTotals: { Caterham: 277, Renault: 256, Mercedes: 132, "Force India": 98, Williams: 87, McLaren: 75, HRT: 68, Ferrari: 51, Arrows: 42, "RedBull Racing": 30, Sauber: 21, Brawn: 13, Virgin: 6, "Toro Rosso": 5 },
  },
  4: {
    name: "Season 4", game: "F1 1990 · Assetto Corsa",
    teamTotals: { Ferrari: 198, Tyrrell: 135, McLaren: 122, Lotus: 122, Williams: 93, "Leyton House": 66, "NCB RaceTech": 63, "Ocean Breeze Racing": 36, BAR: 29, "Miku Racing Team": 24, "Bentley IRC Racing": 14, "Volvo Racing": 11, "TOGG Racing Team": 10 },
  },
  5: { name: "Season 5", game: "F1 2026 · Assetto Corsa" },
};

function build(number) {
  const dir = resolve(ARCHIVE, `season${number}`);
  const file = resolve(dir, "standings.txt");
  if (!existsSync(file)) { console.log(`Season ${number}: no standings.txt — skipped.`); return; }
  const cfg = CONFIGS[number];
  const rows = parseStandings(file);

  // Teams: every non-reserve team the drivers reference, plus any team that only
  // appears in the official teamTotals table, plus the shared Reserve entry.
  const teamNames = new Set(rows.map((r) => r.team).filter((t) => t !== "Reserve"));
  if (cfg.teamTotals) Object.keys(cfg.teamTotals).forEach((t) => teamNames.add(t));
  const teams = [...teamNames].map((name) => ({ id: slug(name), name, tier: 1, color: colorFor(name) }));
  teams.push({ id: "reserve", name: "Reserve", tier: 0, color: "#475569" });

  const teamIdByName = new Map(teams.map((t) => [t.name, t.id]));
  const drivers = rows.map((r) => ({
    id: slug(r.name), name: r.name, discord: r.name,
    teamId: teamIdByName.get(r.team) || "reserve",
    tier: r.team === "Reserve" ? 0 : 1,
  }));

  const finalDrivers = rows.map((r) => ({ id: slug(r.name), points: r.points }));
  // Team totals: official table if given, else sum the drivers' points per team.
  let finalTeams;
  if (cfg.teamTotals) {
    finalTeams = Object.entries(cfg.teamTotals).map(([name, points]) => ({ id: slug(name), points }));
  } else {
    const sum = new Map();
    for (const r of rows) if (r.team !== "Reserve") sum.set(r.team, (sum.get(r.team) || 0) + r.points);
    finalTeams = [...sum].sort((a, b) => b[1] - a[1]).map(([name, points]) => ({ id: slug(name), points }));
  }

  const season = {
    number, name: cfg.name, game: cfg.game, dropWorst: 0, pointsTable: null,
    teams, drivers,
    finalStandings: { drivers: finalDrivers, teams: finalTeams },
  };
  writeFileSync(resolve(dir, "season.json"), JSON.stringify(season, null, 2), "utf8");
  console.log(`Season ${number}: ${teams.length} teams, ${drivers.length} drivers, ${finalTeams.length} team totals`);
}

const arg = process.argv[2] || "all";
const nums = arg === "all" ? [1, 2, 3, 4, 5] : [Number(arg)];
for (const n of nums) build(n);
