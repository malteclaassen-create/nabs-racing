// ---------------------------------------------------------------------------
// Backfill ONLY the race time (`totalTimeMs`) onto EXISTING RaceResult rows from
// the raw AC result JSONs, without touching any scoring
// (position/points/status/penalty/subForTeamId).
//
// Why: the reconstructed Season 7 rounds (R1–R10) came from seed.js, which stored
// the official points/positions/grid/best-lap but never the race time. The AC
// parser already reads `totalTimeMs` from the `TotalTime` field correctly — those
// rounds just never went through the normal import. This fills the gap so the
// results page can show real gaps-to-leader.
//
// SAFETY — this is pure enrichment:
//   • Writes `totalTimeMs` and nothing else.
//   • Only fills rows where it is currently NULL (never overwrites).
//   • Only fills rows with `penaltySeconds = 0`. A race time is only ever
//     consulted for ordering when a round carries a time penalty (see
//     classifyResults: the `!anyPenalty` branch keeps the stored order and never
//     looks at totalTimeMs). Filling a penalised row is therefore the only case
//     that could theoretically re-sort a field, so we skip it. The seed rounds
//     carry no penalties at all, so in practice nothing can move — the standings
//     self-check at the end proves it.
//
// Sources / round matching / driver matching are identical to
// backfill-telemetry.mjs (date-window pairing for --remote, chronological for
// --dir, fuzzy driver match restricted to the round's roster + OVERRIDES).
//
// IMPORTANT: run with the dev server STOPPED (SQLite write lock on Windows).
//
//   node scripts/backfill-racetime.mjs --season 7 --remote --dry-run
//   node scripts/backfill-racetime.mjs --season 7 --remote
//   node scripts/backfill-racetime.mjs --season 7 --dir ../backend/results-archive/season7
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../src/lib/prisma.js";
import { parseAcRaceJson } from "../src/services/acJsonParser.js";
import { listRemoteResults, fetchRemoteResult } from "../src/services/emperorResults.js";
import { trackKeyFor } from "../src/lib/trackKeys.js";
import { getDriverStandings, applyDropScores } from "../src/services/standingsService.js";

// Per-season AC-name -> driverId overrides for names fuzzy matching can't place.
// Kept in sync with backfill-telemetry.mjs (same drivers, same rounds).
const OVERRIDES = {
  7: {
    "Manrry Cespedes": "manro45gt",
    Duck: "duck",
    "#26 Gabriele Grossi": "gabriele_grossi",
    "Gabriele Grossi": "gabriele_grossi",
    "#44 Kowandoh Badu": "kowandoh_badu",
    "Kowandoh Badu": "kowandoh_badu",
    hedimakk: "hedimak",
    "J Bekker": "jp_bekker",
    "JP Bekker": "jp_bekker",
    Juuso: "juuso_salonen",
    "Juuso Salonen": "juuso_salonen",
  },
};

function parseArgs(argv) {
  const args = { season: null, dir: null, remote: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--season") args.season = Number(argv[++i]);
    else if (a === "--dir") args.dir = argv[++i];
    else if (a === "--remote") args.remote = true;
    else if (a === "--dry-run") args.dryRun = true;
  }
  return args;
}

// Collect { json, date, track } from a folder, oldest first.
function collectFromDir(dir) {
  const abs = resolve(dir);
  if (!existsSync(abs)) throw new Error(`--dir not found: ${abs}`);
  const files = readdirSync(abs).filter((f) => /\.json$/i.test(f));
  const out = [];
  for (const f of files) {
    try {
      const json = JSON.parse(readFileSync(resolve(abs, f), "utf8"));
      if (json.Type !== "RACE") continue;
      out.push({ json, date: json.Date ? new Date(json.Date) : null, track: json.TrackName, file: f });
    } catch (e) {
      console.warn(`  ! could not read ${f}: ${e.message}`);
    }
  }
  out.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
  return out;
}

// Collect RACE sessions from the Emperor server within a date window.
async function collectFromRemote(fromDate, toDate) {
  const rows = await listRemoteResults({ type: "RACE" });
  const inWindow = rows.filter((r) => {
    if (!r.ts) return false;
    const t = new Date(r.ts).getTime();
    return t >= fromDate.getTime() && t <= toDate.getTime();
  });
  const out = [];
  for (const r of inWindow) {
    try {
      const json = await fetchRemoteResult(r.id);
      out.push({ json, date: json.Date ? new Date(json.Date) : new Date(r.ts), track: json.TrackName, file: r.id });
    } catch (e) {
      console.warn(`  ! could not download ${r.id}: ${e.message}`);
    }
  }
  out.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
  return out;
}

// Resolve every AC entry with a valid time to a result-row driverId for this
// race. `rowState` maps driverId -> { totalTimeMs, penaltySeconds } so the
// dry-run can report exactly which rows would be filled.
function matchRound(json, race, roster, overrideMap, rowState) {
  const rowDriverIds = new Set(race.results.map((r) => r.driverId));
  const candidates = roster.filter((d) => rowDriverIds.has(d.id));
  const parsed = parseAcRaceJson(json, candidates);

  const matched = []; // { driverId, acName, totalTimeMs, fillable }
  const seen = new Set();
  const unmatched = [];
  for (const en of parsed.entries) {
    if (en.isSafetyCar) continue;
    let driverId = overrideMap[en.acDriverName];
    if (!driverId || !rowDriverIds.has(driverId)) driverId = en.suggestedDriverId;
    if (!driverId || !rowDriverIds.has(driverId)) {
      if ((en.laps || en.numLaps || 0) > 0 || en.totalTimeMs != null) unmatched.push(en.acDriverName);
      continue;
    }
    if (seen.has(driverId)) continue; // never double-map
    seen.add(driverId);
    if (en.totalTimeMs == null) continue; // no usable time -> nothing to write
    const state = rowState.get(driverId) || {};
    const fillable = state.totalTimeMs == null && (state.penaltySeconds || 0) === 0;
    matched.push({ driverId, acName: en.acDriverName, totalTimeMs: en.totalTimeMs, fillable });
  }
  return { matched, unmatched: [...new Set(unmatched)] };
}

async function writeRound(race, matched) {
  let filled = 0;
  for (const m of matched) {
    // The WHERE clause is the real guard: only an empty, unpenalised row is
    // touched. COALESCE would also work, but this way `changes` counts real fills.
    const changed = await prisma.$executeRawUnsafe(
      `UPDATE "RaceResult" SET "totalTimeMs" = ?
         WHERE "raceId" = ? AND "driverId" = ? AND "totalTimeMs" IS NULL AND "penaltySeconds" = 0`,
      m.totalTimeMs,
      race.id,
      m.driverId
    );
    filled += Number(changed) || 0;
  }
  return filled;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.season || (!args.dir && !args.remote)) {
    console.error("Usage: --season <N> (--dir <path> | --remote) [--dry-run]");
    process.exit(1);
  }

  const season = await prisma.season.findFirst({ where: { number: args.season } });
  if (!season) throw new Error(`No season ${args.season} in the DB`);
  const overrideMap = OVERRIDES[args.season] || {};

  const races = await prisma.race.findMany({
    where: { seasonId: season.id, isSpecialEvent: false },
    orderBy: { number: "asc" },
    include: { results: { select: { driverId: true, totalTimeMs: true, penaltySeconds: true } } },
  });
  const roster = await prisma.driver.findMany({
    where: { seasonId: season.id },
    select: { id: true, name: true, discordName: true },
  });
  console.log(`\n=== Season ${season.number} (${season.name}) — ${races.length} races, ${roster.length} drivers ===`);

  // Gather the source JSONs.
  const dated = races.map((r) => r.date).filter(Boolean).map((d) => new Date(d));
  const from = dated.length ? new Date(Math.min(...dated.map((d) => d.getTime())) - 7 * 864e5) : new Date(0);
  const to = dated.length ? new Date(Math.max(...dated.map((d) => d.getTime())) + 7 * 864e5) : new Date();
  const sources = args.dir ? collectFromDir(args.dir) : await collectFromRemote(from, to);
  console.log(`  ${sources.length} source JSON(s) collected`);

  // Pair each source to a race — identical logic to backfill-telemetry.mjs.
  const pairs = [];
  if (args.remote) {
    const usedSources = new Set();
    for (const race of races) {
      if (!race.date) continue;
      const dk = trackKeyFor(race.track);
      let best = null;
      let bestDiff = Infinity;
      for (const src of sources) {
        if (usedSources.has(src)) continue;
        const diff = Math.abs(new Date(race.date).getTime() - (src.date?.getTime() || 0));
        if (diff > 3 * 864e5) continue;
        const jk = trackKeyFor(src.track);
        if (jk && dk && jk !== dk) continue; // clearly a different circuit -> skip
        if (diff < bestDiff) {
          bestDiff = diff;
          best = src;
        }
      }
      if (best) {
        pairs.push({ race, source: best });
        usedSources.add(best);
      }
    }
  } else {
    if (sources.length !== races.length) {
      console.warn(`  ! ${sources.length} JSONs but ${races.length} races — pairing by order up to the shorter length`);
    }
    const n = Math.min(sources.length, races.length);
    for (let i = 0; i < n; i++) pairs.push({ race: races[i], source: sources[i] });
  }

  let filledTotal = 0;
  let wouldFillTotal = 0;
  for (const { race, source } of pairs) {
    const jsonKey = trackKeyFor(source.track);
    const dbKey = trackKeyFor(race.track);
    if (jsonKey && dbKey && jsonKey !== dbKey) {
      console.warn(`  ! R${race.number}: track guard — JSON ${jsonKey} vs DB ${dbKey}. Check ordering.`);
    }

    const rowState = new Map(race.results.map((r) => [r.driverId, r]));
    const { matched, unmatched } = matchRound(source.json, race, roster, overrideMap, rowState);
    const wouldFill = matched.filter((m) => m.fillable).length;
    const already = race.results.filter((r) => r.totalTimeMs != null).length;
    wouldFillTotal += wouldFill;

    console.log(
      `  R${race.number} ${race.track}: ${matched.length}/${race.results.length} rows matched` +
        `  · would fill ${wouldFill} (already ${already})` +
        (unmatched.length ? `  · no match for: ${unmatched.join(", ")}` : "")
    );

    if (args.dryRun) continue;
    filledTotal += await writeRound(race, matched);
  }

  console.log(
    `\n  ${args.dryRun ? `Would fill ${wouldFillTotal} race time(s) (dry-run: nothing written)` : `Race times filled: ${filledTotal}`}`
  );

  // Validation: prove the season's driver standings are unchanged. We only wrote
  // an enrichment column, so the drop-adjusted totals must still equal the sheet.
  if (!args.dryRun && season.finalStandings) {
    const official = JSON.parse(season.finalStandings).drivers || [];
    if (official.length) {
      const drv = await getDriverStandings(prisma, season.id);
      const computed = new Map(
        drv.standings.map((r) => {
          const byRound = Object.fromEntries(Object.entries(r.perRace || {}).map(([n, v]) => [n, v.points || 0]));
          return [r.driverId, applyDropScores(byRound, drv.raceNumbers, drv.dropWorst).total];
        })
      );
      let mism = 0;
      for (const e of official) {
        const c = computed.get(e.driverId) ?? 0;
        if (c !== e.points) {
          mism++;
          console.log(`     Δ ${e.driverId}: computed ${c} vs official ${e.points}`);
        }
      }
      console.log(mism ? `  ⚠ standings validation: ${mism} mismatch(es)` : `  ✓ standings unchanged (${official.length} totals match)`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
