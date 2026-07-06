// Merge per-race Discord result messages into an existing archive season.json.
// Reads archive-material/<N>/*.txt (the raw "ROUND n / 🥇 @name / P4. @name / DNF."
// messages), parses each round's finishing order, and adds `rounds` +
// `driverRaceResults` (position + status per round) to backend/archive/season<N>/
// season.json. Drivers seen in a race but not on the roster are added as reserves.
// The season's points table + drop rule are INFERRED by matching the recomputed
// championship to the stored official totals (finalStandings stays authoritative).
//
// Usage: node scripts/build-archive-races.mjs <seasonNumber> [path-to-txt-dir]
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { similarity } from "../src/services/acJsonParser.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const posArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const N = Number(posArgs[0]);
if (!Number.isInteger(N)) { console.error("Pass a season number, e.g. 2"); process.exit(1); }
const TXT_DIR = resolve(HERE, posArgs[1] || `../../archive-material/${N}`);
const SEASON_JSON = resolve(HERE, `../archive/season${N}/season.json`);
// Force a known points table (skip inference) — use when only partial rounds are
// available so the recomputed championship can't be matched to the full totals.
const forceTable = process.argv.find((a) => /^--table=/.test(a))?.split("=")[1] || null;

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const slug = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Extract a clean driver name from the text right after an "@".
function cleanName(afterAt) {
  return afterAt
    .split(/\s+:|\s+-\s|\s+\(|\s*,|\s+X\b|\s{2,}|\|(?=\s*$)/)[0]
    .replace(/[:*]+$/, "")
    .trim();
}

// Parse the whole message file into rounds. Handles several header styles
// ("ROUND 5 - X", "Results from Round 1 - X", a bare "r1:") and merges a bare
// "rN:" with the fuller header that follows it. Finishing order is read until a
// "STATS" line; "@handles" are extracted per line (DNF lines can list several).
function parseRounds(text) {
  const headerRe = /(?:results?\s+from\s+)?\bround\s+(\d+)\b\s*[-–:]?\s*(.*)$/i;
  const shortRe = /^\s*r\s*(\d+)\s*:?\s*$/i;
  const rounds = [];
  let cur = null;
  const trackOf = (raw) => {
    const t = (raw || "").replace(/\(.*$/, "").replace(/[^A-Za-z0-9\s'.-]/g, " ").replace(/\s+/g, " ").trim();
    return t ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  };
  for (const line of text.split(/\r?\n/)) {
    const h = (/\bround\s+\d+/i.test(line) && line.match(headerRe)) || line.match(shortRe);
    if (h) {
      const round = Number(h[1]);
      const track = trackOf(h[2]);
      if (cur && cur.round === round && cur.order.length === 0 && cur.dnf.length === 0) {
        cur.done = false;
        if (track) cur.track = track; // bare "rN:" then the real header
      } else {
        cur = { round, track, order: [], dnf: [], done: false };
        rounds.push(cur);
      }
      continue;
    }
    if (!cur || cur.done) continue;
    if (/^\s*STATS\b/i.test(line)) { cur.done = true; continue; }
    const isDnf = /^\s*(DNF|DNS|DSQ)\b/i.test(line);
    const medal = /🥇/.test(line) ? 1 : /🥈/.test(line) ? 2 : /🥉/.test(line) ? 3 : null;
    const posM = line.match(/^\s*P?\s*(\d+)\.?\s/);
    if (!isDnf && !medal && !posM) continue;
    const names = [...line.matchAll(/@\s*([^@\n]+)/g)].map((m) => cleanName(m[1])).filter(Boolean);
    if (names.length === 0) continue;
    if (isDnf) cur.dnf.push(...names);
    else cur.order.push(names[0]);
  }
  return rounds.filter((r) => r.order.length || r.dnf.length); // file order preserved
}

// Assign each round a unique number. Keep the header number when it's unused and
// in order; otherwise fall back to the next free number (handles copy-paste
// errors where several blocks share one "ROUND n" label).
function renumber(parsed) {
  const used = new Set();
  let next = 1;
  for (const r of parsed) {
    let num = r.round && r.round >= next && !used.has(r.round) ? r.round : next;
    while (used.has(num)) num++;
    r.round = num;
    used.add(num);
    next = num + 1;
  }
  return parsed;
}

// Points tables to try when inferring the season's scoring.
const CANDIDATE_TABLES = {
  league: [35, 30, 25, 22, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1],
  modern: [25, 18, 15, 12, 10, 8, 6, 5, 4, 3, 2, 1],
  classic: [10, 8, 6, 5, 4, 3, 2, 1],
};
function applyDrop(perRound, dropN) {
  const vals = [...perRound].sort((a, b) => a - b);
  const kept = dropN > 0 ? vals.slice(dropN) : vals;
  return kept.reduce((s, v) => s + v, 0);
}

const spec = JSON.parse(readFileSync(SEASON_JSON, "utf8"));

// Explicit aliases for handles fuzzy matching can't bridge (different display
// name vs. in-game handle for the same person). Keyed by normalised race name.
const ALIAS = {
  danieljmrsetup: "Daniel Jelinek",
  danielj: "Daniel Jelinek",
};

// roster name -> id (normalised), for matching the race handles.
const idByNorm = new Map(spec.drivers.map((d) => [norm(d.name), d.id]));
const reserveTeam = spec.teams.find((t) => t.tier === 0) || { id: "reserve" };
const IGNORE = new Set(["deleteduser", "unbekannterbenutzer"]);

// Resolve a race handle to a roster driver id: exact -> alias -> fuzzy (best
// similarity ≥ 0.82 against name/discord/id) -> add as a new reserve.
function driverId(name) {
  const key = norm(name);
  if (!key || IGNORE.has(key)) return null;
  if (idByNorm.has(key)) return idByNorm.get(key);
  const aliasTarget = ALIAS[key] && idByNorm.get(norm(ALIAS[key]));
  if (aliasTarget) { idByNorm.set(key, aliasTarget); return aliasTarget; }
  let best = null, bestScore = 0;
  for (const d of spec.drivers) {
    const s = similarity(name, d);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  if (best && bestScore >= 0.82) { idByNorm.set(key, best.id); return best.id; }
  const id = slug(name);
  if (!spec.drivers.some((d) => d.id === id)) {
    spec.drivers.push({ id, name, discord: name, teamId: reserveTeam.id, tier: 0 });
  }
  idByNorm.set(key, id);
  return id;
}

const files = readdirSync(TXT_DIR).filter((f) => f.toLowerCase().endsWith(".txt"));
const raw = files.map((f) => readFileSync(resolve(TXT_DIR, f), "utf8")).join("\n\n");
const parsed = renumber(parseRounds(raw));
if (parsed.length === 0) { console.error(`No rounds parsed from ${TXT_DIR} (${files.join(", ") || "no .txt files"})`); process.exit(1); }

// Build driverRaceResults keyed by driver id.
const nRounds = Math.max(...parsed.map((r) => r.round));
const results = {};
const rounds = [];
for (const r of parsed) {
  rounds.push({ round: r.round, track: r.track || null });
  r.order.forEach((name, i) => {
    const id = driverId(name);
    if (!id) return;
    (results[id] ||= Array(nRounds).fill(null))[r.round - 1] = { position: i + 1, status: "FINISHED" };
  });
  for (const name of r.dnf) {
    const id = driverId(name);
    if (!id) continue;
    (results[id] ||= Array(nRounds).fill(null))[r.round - 1] = { position: null, status: "DNF" };
  }
}

// Infer (table, drop) that best reproduces the official driver totals — unless a
// table is forced (partial-rounds case, where the match would be meaningless).
const official = new Map((spec.finalStandings?.drivers || []).map((e) => [e.id, e.points]));
let best = { key: "league", table: CANDIDATE_TABLES.league, drop: spec.dropWorst ?? 0, err: Infinity };
if (forceTable && CANDIDATE_TABLES[forceTable]) {
  best = { key: forceTable, table: CANDIDATE_TABLES[forceTable], drop: spec.dropWorst ?? 0, err: null };
} else {
  for (const [key, table] of Object.entries(CANDIDATE_TABLES)) {
    for (const drop of [0, 1, 2, 3]) {
      let err = 0;
      for (const [id, off] of official) {
        const cells = results[id] || [];
        const per = [];
        for (let i = 0; i < nRounds; i++) {
          const c = cells[i];
          per.push(c && c.status === "FINISHED" && c.position ? table[c.position - 1] || 0 : 0);
        }
        err += Math.abs(applyDrop(per, drop) - off);
      }
      if (err < best.err) best = { key, table, drop, err };
    }
  }
}

spec.rounds = rounds.sort((a, b) => a.round - b.round);
spec.driverRaceResults = results;
spec.dropWorst = best.drop;
spec.pointsTable = best.key === "league" ? null : best.table;

writeFileSync(SEASON_JSON, JSON.stringify(spec, null, 2), "utf8");
const placed = Object.keys(results).length;
console.log(`Season ${N}: parsed ${rounds.length} rounds, ${placed} drivers with results, ${spec.drivers.length} on roster.`);
console.log(`Inferred scoring: table=${best.key}, dropWorst=${best.drop} (total abs error vs official = ${best.err}).`);
