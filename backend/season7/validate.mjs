import fs from "fs";
const seed = fs.readFileSync("prisma/seed.js", "utf8");

const drv = [];
for (const block of ["T1_DRIVERS", "T2_DRIVERS"]) {
  const body = seed.match(new RegExp(block + "\\s*=\\s*\\[([\\s\\S]*?)\\];"))[1];
  const r = /id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*discord:\s*"([^"]+)"/g;
  let m;
  while ((m = r.exec(body))) drv.push({ id: m[1], name: m[2], dn: m[3] });
}
const resBody = seed.match(/RESERVE_IDS\s*=\s*\[([\s\S]*?)\];/)[1];
const resIds = [...resBody.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const dispBody = seed.match(/RESERVE_DISPLAY\s*=\s*\{([\s\S]*?)\};/)[1];
const disp = {};
for (const m of dispBody.matchAll(/(\w+):\s*"([^"]+)"/g)) disp[m[1]] = m[2];
const tc = (id) => id.split("_").map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
for (const id of resIds) drv.push({ id, name: disp[id] || tc(id), dn: disp[id] || tc(id) });

const scoresBody = seed.match(/DRIVER_RACE_SCORES\s*=\s*\{([\s\S]*?)\n\};/)[1];
const SCORES = {};
for (const m of scoresBody.matchAll(/(?:"([^"]+)"|(\w+)):\s*\[([^\]]*)\]/g)) {
  const id = m[1] || m[2];
  SCORES[id] = m[3].split(",").map((s) => {
    s = s.trim();
    if (s === "null") return null;
    if (/^".*"$/.test(s)) return s.slice(1, -1);
    return Number(s);
  });
}

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let p = [...Array(n + 1).keys()], c = new Array(n + 1);
  for (let i = 1; i <= m; i++) { c[0] = i; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [p, c] = [c, p]; }
  return p[n];
}
function bestMatch(ac) {
  let best = null, bs = 0;
  for (const d of drv) for (const cand of [d.id, d.name, d.dn]) {
    const a = norm(ac), b = norm(cand);
    if (!a || !b) continue;
    const s = a.includes(b) || b.includes(a) ? 0.92 : 1 - lev(a, b) / Math.max(a.length, b.length);
    if (s > bs) { bs = s; best = d; }
  }
  return { best, bs };
}
const PTS = [35, 30, 25, 22, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
const t1ids = new Set(["13bot", "mtimmis", "siggsta", "jomilan", "takoda", "steve", "maltegoat", "pizd", "rayman", "rashford"]);

const dir = "C:/Users/malte/Downloads/";
const files = ["2026_4_10_19_5_RACE.json", "2026_4_17_18_57_RACE(1).json", "2026_5_1_19_1_RACE.json", "2026_5_8_19_1_RACE.json", "2026_5_15_19_3_RACE.json", "2026_5_22_19_7_RACE.json", "2026_5_29_18_59_RACE.json", "2026_6_5_18_54_RACE.json"];
const GT3 = new Set(["Tyler27", "Janelko", "Samuel Foniok"]);
const unmapped = new Set();
let t1ok = 0; const t1bad = [];
files.forEach((f, ri) => {
  const j = JSON.parse(fs.readFileSync(dir + f, "utf8"));
  const fin = j.Result.filter((r) => r.NumLaps > 0 && !GT3.has(r.DriverName));
  fin.forEach((r, i) => {
    const { best, bs } = bestMatch(r.DriverName);
    if (bs < 0.6) { unmapped.add(r.DriverName); return; }
    if (t1ids.has(best.id)) {
      const stored = SCORES[best.id]?.[ri];
      const posPts = r.Disqualified ? 0 : (PTS[i] ?? 0);
      if (typeof stored === "number") { if (stored === posPts) t1ok++; else t1bad.push(`R${ri + 1} ${best.id} pos${i + 1} stored=${stored} posPts=${posPts}`); }
    }
  });
});
console.log("Roster size:", drv.length, "| scored drivers:", Object.keys(SCORES).length);
console.log(`\nT1 position-points vs stored: OK=${t1ok} MISMATCH=${t1bad.length}`);
t1bad.slice(0, 40).forEach((x) => console.log("  ", x));
console.log("\nUNMAPPED AC names (need decision):", [...unmapped].sort().join(", ") || "none");
