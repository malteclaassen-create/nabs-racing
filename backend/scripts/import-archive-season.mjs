// ---------------------------------------------------------------------------
// Archive helper #2 — import an old season (1-6) as a read-only archive season.
//
// Reads backend/archive/season<N>/season.json (roster + official finalStandings)
// and, when present, rounds.json (calendar + Emperor session ids), then:
//   1. upserts the Season row (isActive:false) with dropWorst/pointsTable and
//      the official finalStandings stored verbatim (these totals win in the UI);
//   2. upserts its teams & drivers with s<N>_-prefixed ids;
//   3. rebuilds its races: for each round with an emperorId it downloads the AC
//      JSON, fuzzy-matches drivers against the roster and stores per-race results
//      via the shared saveRaceResults() (points derived from the season's table —
//      they're just enrichment, the stored finalStandings are authoritative);
//   4. validates: recomputes the season totals and diffs them against the
//      official finalStandings so mismatches are visible (they never block).
//
// Everything is scoped to season<N> and idempotent — safe to re-run.
//
// Usage:
//   node scripts/import-archive-season.mjs --season 6
//   node scripts/import-archive-season.mjs --all
//   node scripts/import-archive-season.mjs --season 6 --dry-run   (no DB writes)
//   node scripts/import-archive-season.mjs --season 6 --refetch   (ignore raw/ cache)
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../src/lib/prisma.js";
import { fetchRemoteResult } from "../src/services/emperorResults.js";
import { parseAcRaceJson } from "../src/services/acJsonParser.js";
import { saveRaceResults } from "../src/services/raceWriter.js";
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
  applyDropScores,
} from "../src/services/standingsService.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = resolve(HERE, "../archive");

// Reuse the bundled team logos (frontend/public/teams/*.png, the F1-2007 grid)
// for archive teams whose name matches — real crests instead of a colour
// monogram. Keyed by lowercased team name; value is the logo file's base name.
const LOGO_BY_NAME = {
  ferrari: "ferrari", mclaren: "mclaren", williams: "williams", renault: "renault",
  honda: "honda", toyota: "toyota", lotus: "lotus", jaguar: "jaguar", porsche: "porsche",
  "super aguri": "super_aguri", "toro rosso": "torro_rosso", "torro rosso": "torro_rosso",
  "red bull": "redbull", redbull: "redbull", bmw: "bmw", "bmw sauber": "bmw",
};
const logoFor = (name) => {
  const base = LOGO_BY_NAME[(name || "").trim().toLowerCase()];
  return base ? `/teams/${base}.png` : null;
};

// Canonical display names so a driver reads the same across seasons where they
// used a trivially different handle. Only high-confidence, same-person variants
// — genuine identity changes need the user to supply the mapping. Keyed by
// lowercased original name.
const CANON_NAME = {
  "philip mccrack": "Phil McCrack",
  "onion h. fornite": "Onion",
  rikkosk: "Rikko",
  rikkos: "Rikko",
  "marcus rashford": "Rashford",
  jomilan04: "JoMilan",
  "jomilan (nabs cat-girl huzz)": "JoMilan",
  "anxo gonzalez": "Anxo González",
  "jacob ordonez": "Jacob Ordóñez",
};
const canonName = (name) => CANON_NAME[(name || "").trim().toLowerCase()] || name;

function parseArgs(argv) {
  const args = { season: null, all: false, dryRun: false, refetch: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--season") args.season = Number(argv[++i]);
    else if (a === "--all") args.all = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--refetch") args.refetch = true;
  }
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Which season<N> folders exist under archive/ (numeric order).
function discoverSeasons() {
  if (!existsSync(ARCHIVE_DIR)) return [];
  return readdirSync(ARCHIVE_DIR)
    .map((name) => /^season(\d+)$/.exec(name))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

// AC status derivation for an imported entry: DSQ if disqualified, DNF if it
// never completed a lap, else a classified finisher. Per-race points are left
// for saveRaceResults to derive from position (finalStandings hold the truth).
function statusFor(entry) {
  if (entry.disqualified) return "DSQ";
  if ((entry.numLaps || 0) === 0) return "DNF";
  return "FINISHED";
}

// Resolve one AC entry to a season driver id (already prefixed). Order: the
// parser's fuzzy suggestion (score >= 0.55) -> explicit nameMap -> unmatched.
function resolveDriverId(entry, nameMap, driverIds) {
  if (entry.suggestedDriverId && driverIds.has(entry.suggestedDriverId)) return entry.suggestedDriverId;
  const mapped = nameMap.get(entry.acDriverName);
  if (mapped && driverIds.has(mapped)) return mapped;
  return null;
}

async function loadRoundJson(seasonDir, round, refetch) {
  const rawDir = resolve(seasonDir, "raw");
  const cachePath = resolve(rawDir, `r${round.round}-${round.emperorId}.json`);
  if (!refetch && existsSync(cachePath)) return readJson(cachePath);
  const json = await fetchRemoteResult(round.emperorId);
  if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(json), "utf8");
  return json;
}

// Turn one AC file into a saveRaceResults() payload, or an { unmatched/conflicts }
// report. `drivers` = the season roster (prefixed) used for fuzzy matching.
function buildRoundResults(json, round, drivers, nameMap) {
  const driverIds = new Set(drivers.map((d) => d.id));
  const parsed = parseAcRaceJson(json, drivers);
  const unmatched = [];
  const seen = new Map(); // driverId -> acDriverName (to catch double-maps)
  const conflicts = [];
  const matched = [];

  for (const entry of parsed.entries) {
    const driverId = resolveDriverId(entry, nameMap, driverIds);
    if (!driverId) {
      // Ignore obvious non-participants (0 laps AND no time) silently; a real
      // league entrant we can't place is reported so the user extends nameMap.
      if ((entry.numLaps || 0) > 0 || entry.totalTimeMs != null) unmatched.push(entry.acDriverName);
      continue;
    }
    if (seen.has(driverId)) {
      conflicts.push(`${driverId} <- "${seen.get(driverId)}" AND "${entry.acDriverName}"`);
      continue;
    }
    seen.set(driverId, entry.acDriverName);
    matched.push({ entry, driverId });
  }

  // Classify: finishers get 1..n positions in AC order; DNF/DSQ hold no slot.
  let pos = 0;
  const results = matched.map(({ entry, driverId }) => {
    const status = statusFor(entry);
    const position = status === "FINISHED" ? ++pos : null;
    return {
      driverId,
      position,
      status,
      grid: entry.grid ?? null,
      bestLapMs: Number.isFinite(entry.bestLap) && entry.bestLap > 0 ? entry.bestLap : null,
      totalTimeMs: entry.totalTimeMs ?? null,
      contacts: entry.contacts ?? null,
      points: null, // derived from position via the season points table
    };
  });

  return { results, unmatched, conflicts };
}

// --- validation: computed season totals vs. the stored official finalStandings
function diffTotals(label, computedRows, official, idKey) {
  if (!official || official.length === 0) return;
  const computed = new Map(computedRows.map((r) => [r[idKey], r.total]));
  const off = new Map(official.map((e) => [e[idKey], e.points]));
  const ids = new Set([...computed.keys(), ...off.keys()].filter((id) => off.has(id)));
  const mism = [];
  for (const id of ids) {
    const c = computed.get(id) ?? 0;
    const o = off.get(id);
    if (c !== o) mism.push(`  ${id}: computed ${c} vs official ${o} (Δ ${c - o})`);
  }
  if (mism.length === 0) {
    console.log(`  ✓ ${label}: all ${off.size} totals match the official sheet`);
  } else {
    console.log(`  ⚠ ${label}: ${mism.length} mismatch(es) — official values are shown in the UI:`);
    mism.forEach((m) => console.log(m));
  }
}

async function importSeason(number, { dryRun, refetch }) {
  const seasonDir = resolve(ARCHIVE_DIR, `season${number}`);
  const seasonPath = resolve(seasonDir, "season.json");
  if (!existsSync(seasonPath)) {
    console.log(`Season ${number}: no ${seasonPath} — skipped.`);
    return;
  }
  const spec = readJson(seasonPath);
  const seasonId = `season${number}`;
  const pfx = (id) => `s${number}_${id}`;

  console.log(`\n=== Season ${number} (${spec.name}) ===`);

  // Prefix the roster up front so both matching and DB writes use the same ids.
  const teams = (spec.teams || []).map((t) => ({ ...t, id: pfx(t.id) }));
  const drivers = (spec.drivers || []).map((d) => ({
    id: pfx(d.id),
    name: canonName(d.name),
    discordName: d.discord || d.discordName || d.name,
    teamId: pfx(d.teamId),
    tier: d.tier ?? 1,
  }));
  const nameMap = new Map(Object.entries(spec.nameMap || {}).map(([ac, id]) => [ac, pfx(id)]));

  // finalStandings with prefixed ids -> the JSON we store on the Season row.
  const finalStandings = spec.finalStandings
    ? {
        drivers: (spec.finalStandings.drivers || []).map((e) => ({ driverId: pfx(e.id), points: e.points })),
        teams: (spec.finalStandings.teams || []).map((e) => ({ teamId: pfx(e.id), points: e.points })),
        // Official per-race team points (keys prefixed to match the DB team ids).
        ...(spec.finalStandings.teamPerRace
          ? {
              teamPerRace: Object.fromEntries(
                Object.entries(spec.finalStandings.teamPerRace).map(([teamId, byRound]) => [pfx(teamId), byRound])
              ),
            }
          : {}),
      }
    : null;

  // Two ways to get per-race data:
  //   (a) stored points: season.json carries `driverRaceResults` (like Season 7 —
  //       used when the old league sheet already lists per-race points/positions);
  //   (b) Emperor: rounds.json maps each round to an AC session to download.
  // Totals-only seasons have neither (just finalStandings).
  const storedMode = !!spec.driverRaceResults;
  const roundsPath = resolve(seasonDir, "rounds.json");
  const rounds = storedMode ? spec.rounds || [] : existsSync(roundsPath) ? readJson(roundsPath) : [];

  console.log(`  ${teams.length} teams, ${drivers.length} drivers, ${rounds.length} round(s)${storedMode ? " [stored points]" : ""}`);

  // --- MATCHING PASS (also the dry-run report): resolve every round before we
  // touch the DB, so problems abort with a fix-list instead of a partial import.
  const roundPayloads = [];
  let hardStop = false;
  for (const round of rounds) {
    if (storedMode) {
      // Build results straight from the stored per-race table. Positions are
      // display-only here (points are authoritative), and the old sheet has the
      // odd duplicate position among 0-point back-markers — dedupe to null so the
      // uniqueness check passes without touching any scoring.
      const results = [];
      const usedPos = new Set();
      for (const d of spec.drivers) {
        const cell = spec.driverRaceResults[d.id]?.[round.round - 1];
        if (!cell) continue; // driver didn't take part this round
        let position = cell.position ?? null;
        if (position != null && usedPos.has(position)) position = null;
        if (position != null) usedPos.add(position);
        results.push({
          driverId: pfx(d.id),
          position,
          status: cell.status || "FINISHED",
          points: cell.points ?? null, // stored (null -> derived from position/status)
        });
      }
      console.log(`  R${round.round} ${round.track || ""}: ${results.length} drivers`);
      roundPayloads.push({ round, results });
      continue;
    }
    if (!round.emperorId) {
      console.log(`  R${round.round} ${round.track}: no emperorId — race row only (no results)`);
      roundPayloads.push({ round, results: null });
      continue;
    }
    const json = await loadRoundJson(seasonDir, round, refetch);
    const { results, unmatched, conflicts } = buildRoundResults(json, round, drivers, nameMap);
    if (unmatched.length || conflicts.length) {
      hardStop = true;
      console.log(`  R${round.round} ${round.track}: NEEDS ATTENTION`);
      if (unmatched.length) console.log(`     unmatched AC names: ${[...new Set(unmatched)].join(", ")}`);
      if (conflicts.length) conflicts.forEach((c) => console.log(`     conflict: ${c}`));
    } else {
      console.log(`  R${round.round} ${round.track}: ${results.length} drivers matched`);
      roundPayloads.push({ round, results });
    }
  }

  if (hardStop) {
    console.log(
      `\n  ✗ Season ${number} not imported: add the unmatched names to season.json "nameMap"\n` +
        `    (or add them to "drivers"), then re-run. No changes were written.`
    );
    return;
  }

  if (dryRun) {
    console.log(`  (dry-run) roster + ${roundPayloads.length} round(s) resolved cleanly; nothing written.`);
    return;
  }

  // --- WRITE PASS -----------------------------------------------------------
  // Season (never flip an existing active flag; archive seasons are created inactive).
  await prisma.season.upsert({
    where: { number },
    create: {
      id: seasonId,
      number,
      name: spec.name,
      game: spec.game ?? null,
      isActive: false,
      dropWorst: spec.dropWorst ?? 0,
      pointsTable: spec.pointsTable ? JSON.stringify(spec.pointsTable) : null,
      finalStandings: finalStandings ? JSON.stringify(finalStandings) : null,
    },
    update: {
      name: spec.name,
      game: spec.game ?? null,
      dropWorst: spec.dropWorst ?? 0,
      pointsTable: spec.pointsTable ? JSON.stringify(spec.pointsTable) : null,
      finalStandings: finalStandings ? JSON.stringify(finalStandings) : null,
    },
  });

  for (const t of teams) {
    const logoUrl = logoFor(t.name);
    await prisma.team.upsert({
      where: { id: t.id },
      create: { id: t.id, name: t.name, tier: t.tier ?? 1, color: t.color || "#64748b", seasonId, logoUrl },
      update: { name: t.name, tier: t.tier ?? 1, color: t.color || "#64748b", seasonId, logoUrl },
    });
  }
  for (const d of drivers) {
    // NB: never set discordUserId — it's globally unique and belongs to the
    // live-season rows; archive drivers are display-only.
    await prisma.driver.upsert({
      where: { id: d.id },
      create: { id: d.id, name: d.name, discordName: d.discordName, teamId: d.teamId, tier: d.tier, seasonId },
      update: { name: d.name, discordName: d.discordName, teamId: d.teamId, tier: d.tier, seasonId },
    });
  }

  // Rebuild this season's races from scratch (scoped delete, then recreate).
  await prisma.constructorRaceScore.deleteMany({ where: { race: { seasonId } } });
  await prisma.raceResult.deleteMany({ where: { race: { seasonId } } });
  await prisma.race.deleteMany({ where: { seasonId } });

  for (const { round, results } of roundPayloads) {
    const race = await prisma.race.create({
      data: {
        number: round.round,
        track: round.track || `Round ${round.round}`,
        date: round.date ? new Date(round.date) : null,
        isCompleted: true,
        seasonId,
      },
    });
    if (results && results.length) await saveRaceResults(prisma, race.id, results);
  }

  console.log(`  ✓ imported ${teams.length} teams, ${drivers.length} drivers, ${roundPayloads.length} race(s)`);

  // --- VALIDATION -----------------------------------------------------------
  // Only meaningful when per-race data exists: a totals-only season computes 0
  // everywhere (no races), so a diff against the official totals is just noise.
  if (!roundPayloads.some((p) => p.results && p.results.length)) {
    console.log(`  · totals-only season: official standings stored verbatim (nothing to recompute)`);
    return;
  }
  const [drv, t1, t2] = await Promise.all([
    getDriverStandings(prisma, seasonId),
    getT1ConstructorStandings(prisma, seasonId),
    getT2ConstructorStandings(prisma, seasonId),
  ]);
  // Compare the computed totals against the official ones. getDriverStandings
  // overlays finalStandings onto .total, so re-derive the DROP-ADJUSTED computed
  // total from perRace (official totals already have the worst rounds dropped).
  const computedDriverRows = drv.standings.map((r) => {
    const pointsByRound = Object.fromEntries(Object.entries(r.perRace || {}).map(([n, v]) => [n, v.points || 0]));
    return { driverId: r.driverId, total: applyDropScores(pointsByRound, drv.raceNumbers, drv.dropWorst).total };
  });
  diffTotals("Drivers", computedDriverRows, finalStandings?.drivers, "driverId");
  // Team drop-adjusted total = full per-race haul minus the dropped share.
  const computedTeamRows = [...t1.standings, ...t2.standings].map((r) => {
    const full = Object.values(r.perRace || {}).reduce((s, v) => s + (v || 0), 0);
    const dropped = Object.values(r.droppedPerRace || {}).reduce((s, v) => s + (v || 0), 0);
    return { teamId: r.teamId, total: full - dropped };
  });
  diffTotals("Constructors", computedTeamRows, finalStandings?.teams, "teamId");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seasons = args.all ? discoverSeasons() : args.season != null ? [args.season] : [];
  if (seasons.length === 0) {
    console.error("Nothing to do. Pass --season <N> or --all.");
    process.exit(1);
  }
  for (const n of seasons) {
    await importSeason(n, { dryRun: args.dryRun, refetch: args.refetch });
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
