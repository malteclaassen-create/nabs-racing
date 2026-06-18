// Resolves every AC race-result entry to a roster driverId and emits
// season7/race-positions.json: { [raceNumber]: [ {driverId, position, grid,
// bestLapMs, dsq, acName} ] }. Prints the full name->id resolution for review.
import fs from "fs";

const seed = fs.readFileSync("prisma/seed.js", "utf8");
const drv = [];
for (const block of ["T1_DRIVERS", "T2_DRIVERS"]) {
  const body = seed.match(new RegExp(block + "\\s*=\\s*\\[([\\s\\S]*?)\\];"))[1];
  const r = /id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*discord:\s*"([^"]+)"/g;
  let m;
  while ((m = r.exec(body))) drv.push({ id: m[1], name: m[2], dn: m[3] });
}
const resIds = [...seed.match(/RESERVE_IDS\s*=\s*\[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const disp = {};
for (const m of seed.match(/RESERVE_DISPLAY\s*=\s*\{([\s\S]*?)\};/)[1].matchAll(/(\w+):\s*"([^"]+)"/g)) disp[m[1]] = m[2];
const tc = (id) => id.split("_").map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
for (const id of resIds) drv.push({ id, name: disp[id] || tc(id), dn: disp[id] || tc(id) });

// New reserves seen in the JSONs but not yet in the roster.
const NEW = {
  "Marquez5": "marquez5", "Mr. Kettama": "mr_kettama", "Oilver Ramsey": "oilver_ramsey",
  "Ryotaro Takahashi": "ryotaro_takahashi", "Wulffo": "wulffo", "Xucc": "xucc",
  "birmigam sped stars": "birmigam_sped_stars", "ghost": "ghost",
};
for (const [name, id] of Object.entries(NEW)) drv.push({ id, name, dn: name });

// Explicit overrides (merges / confirmed identities) win over fuzzy matching.
const OVERRIDE = {
  "Manrry Cespedes": "manro45gt",
  "Duck": "duck", // else fuzzy-matches manro45gt ("Menry | Duck Drivers")
  "#26 Gabriele Grossi": "gabriele_grossi", "Gabriele Grossi": "gabriele_grossi",
  "#44 Kowandoh Badu": "kowandoh_badu", "Kowandoh Badu": "kowandoh_badu",
  "hedimakk": "hedimak", "hedimak": "hedimak",
  "J Bekker": "jp_bekker", "JP Bekker": "jp_bekker",
  "Juuso": "juuso_salonen", "Juuso Salonen": "juuso_salonen",
  "airlineure": "airlineure", "AirLineure": "airlineure",
  "aliveaxe": "aliveaxe", "Aliveaxe": "aliveaxe",
};

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let p = [...Array(n + 1).keys()], c = new Array(n + 1);
  for (let i = 1; i <= m; i++) { c[0] = i; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [p, c] = [c, p]; }
  return p[n];
}
function resolve(ac) {
  if (OVERRIDE[ac]) return { id: OVERRIDE[ac], score: 1, via: "override" };
  let best = null, bs = 0;
  for (const d of drv) for (const cand of [d.id, d.name, d.dn]) {
    const a = norm(ac), b = norm(cand);
    if (!a || !b) continue;
    const s = a.includes(b) || b.includes(a) ? 0.92 : 1 - lev(a, b) / Math.max(a.length, b.length);
    if (s > bs) { bs = s; best = d; }
  }
  return { id: bs >= 0.6 ? best.id : null, score: Math.round(bs * 100) / 100, via: "fuzzy" };
}

const dir = "C:/Users/malte/Downloads/";
const files = [
  "2026_4_10_19_5_RACE.json", "2026_4_17_18_57_RACE(1).json", "2026_5_1_19_1_RACE.json",
  "2026_5_8_19_1_RACE.json", "2026_5_15_19_3_RACE.json", "2026_5_22_19_7_RACE.json",
  "2026_5_29_18_59_RACE.json", "2026_6_5_18_54_RACE.json", "2026_6_12_18_58_RACE(2).json",
];
const GT3 = new Set(["Tyler27", "Janelko", "Samuel Foniok"]); // safety-car drivers, excluded

const out = {};
const resolution = new Map(); // acName -> {id, score, via, count}
files.forEach((f, ri) => {
  const j = JSON.parse(fs.readFileSync(dir + f, "utf8"));
  const fin = j.Result.filter((r) => r.NumLaps > 0 && !GT3.has(r.DriverName));
  const seen = new Set();
  out[ri + 1] = fin.map((r, i) => {
    const res = resolve(r.DriverName);
    const rec = resolution.get(r.DriverName) || { ...res, count: 0 };
    rec.count++; resolution.set(r.DriverName, rec);
    if (res.id && seen.has(res.id)) console.warn(`!! DUPLICATE driverId ${res.id} in R${ri + 1} (${r.DriverName})`);
    if (res.id) seen.add(res.id);
    return {
      driverId: res.id, acName: r.DriverName, position: i + 1,
      grid: r.GridPosition ?? null, bestLapMs: r.BestLap || null, dsq: !!r.Disqualified,
    };
  }).filter((e) => e.driverId);
});

fs.writeFileSync("season7/race-positions.json", JSON.stringify(out, null, 1));

console.log("=== NAME RESOLUTION (acName -> driverId | races | score | via) ===");
[...resolution.entries()].sort((a, b) => a[1].id?.localeCompare(b[1].id || "") || 0)
  .forEach(([ac, r]) => console.log(`${ac.padEnd(24)} -> ${(r.id || "UNMAPPED").padEnd(20)} | ${r.count} | ${r.score} | ${r.via}`));
const unmapped = [...resolution.entries()].filter(([, r]) => !r.id).map(([ac]) => ac);
console.log("\nUNMAPPED:", unmapped.join(", ") || "none");
console.log("Wrote season7/race-positions.json — entries/race:", Object.values(out).map((a) => a.length).join(","));
