// ---------------------------------------------------------------------------
// Backfill per-driver telemetry (contacts, env hits, cuts, overtakes,
// consistency, in-game penalties) onto EXISTING RaceResult rows from the raw AC
// result JSONs, without touching any scoring (position/points/status/penalty).
//
// Sources:
//   --dir <path>   read *RACE*.json from a folder (e.g. ../archive-material/5)
//   --remote       pull RACE sessions from the Emperor server in the season's
//                  date window (fallback/primary for Season 7)
// Round matching:
//   S5/S6 (--dir): the JSONs sort chronologically onto rounds 1..N. A soft track
//                  guard warns if a resolvable JSON track disagrees with the DB.
//   S7 (--remote): each JSON is matched to a race by date (±3 days).
// Driver matching: fuzzy (parser suggestion >= 0.55) restricted to the drivers
//   who actually have a result row in that race, plus a per-season OVERRIDE map.
//
// Flags: --dry-run (report only), --fix-races (set S6 track/date + missing dates).
//
// IMPORTANT: run with the dev server STOPPED (SQLite write lock on Windows).
// Only enrichment columns are written; the round's points/positions are the
// authoritative stored values and are never modified.
//
//   node scripts/backfill-telemetry.mjs --season 5 --dir ../archive-material/5 --dry-run
//   node scripts/backfill-telemetry.mjs --season 5 --dir ../archive-material/5
//   node scripts/backfill-telemetry.mjs --season 6 --dir ../archive-material/6 --fix-races
//   node scripts/backfill-telemetry.mjs --season 7 --remote
//   node scripts/backfill-telemetry.mjs --season 7 --dir ../archive-material/7
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../src/lib/prisma.js";
import { ensureAppSchema } from "../src/lib/ensureSchema.js";
import { parseAcRaceJson } from "../src/services/acJsonParser.js";
import { listRemoteResults, fetchRemoteResult } from "../src/services/emperorResults.js";
import { saveDirect } from "../src/lib/resultsArchive.js";
import { trackKeyFor, displayNameFor } from "../src/lib/trackKeys.js";
import { getDriverStandings, applyDropScores } from "../src/services/standingsService.js";

// Per-season AC-name -> driverId overrides for names fuzzy matching can't place.
// Seeded for S7 from season7/generate-positions.mjs; extend after a --dry-run.
const OVERRIDES = {
  5: {},
  6: {},
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

const TELEMETRY_COLS = [
  "contacts", "envContacts", "cuts", "overtakes", "laps",
  "cleanLaps", "consistencyMs", "consistencyPct", "gamePenalties", "gamePenaltySeconds",
];

function parseArgs(argv) {
  const args = { season: null, dir: null, remote: false, dryRun: false, fixRaces: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--season") args.season = Number(argv[++i]);
    else if (a === "--dir") args.dir = argv[++i];
    else if (a === "--remote") args.remote = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--fix-races") args.fixRaces = true;
  }
  return args;
}

const isPlaceholderTrack = (t) => !t || /^round\s*\d+$/i.test(t.trim());

// Collect { json, date, track } from a folder, newest-... no, oldest first.
function collectFromDir(dir) {
  const abs = resolve(dir);
  if (!existsSync(abs)) throw new Error(`--dir not found: ${abs}`);
  const files = readdirSync(abs).filter((f) => /RACE.*\.json$/i.test(f));
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

// Resolve every AC entry in one file to a result-row driverId for this race.
function matchRound(json, race, roster, overrideMap) {
  // Candidates = drivers who actually have a result row in this round.
  const rowDriverIds = new Set(race.results.map((r) => r.driverId));
  const candidates = roster.filter((d) => rowDriverIds.has(d.id));
  const parsed = parseAcRaceJson(json, candidates);

  const matched = []; // { driverId, telemetry, grid, bestLapMs }
  const seen = new Set();
  const unmatched = [];
  for (const en of parsed.entries) {
    if (en.isSafetyCar) continue;
    let driverId = overrideMap[en.acDriverName];
    if (!driverId || !rowDriverIds.has(driverId)) driverId = en.suggestedDriverId;
    if (!driverId || !rowDriverIds.has(driverId)) {
      // A real entrant (ran laps / has a time) we couldn't place is a problem.
      if ((en.laps || en.numLaps || 0) > 0 || en.totalTimeMs != null) unmatched.push(en.acDriverName);
      continue;
    }
    if (seen.has(driverId)) continue; // never double-map
    seen.add(driverId);
    matched.push({
      driverId,
      acName: en.acDriverName,
      telemetry: {
        contacts: en.contacts,
        envContacts: en.envContacts,
        cuts: en.cuts,
        overtakes: en.overtakes,
        laps: en.laps,
        cleanLaps: en.cleanLaps,
        consistencyMs: en.consistencyMs,
        gamePenalties: en.gamePenalties,
        gamePenaltySeconds: en.gamePenaltySeconds,
      },
      grid: en.grid ?? null,
      bestLapMs: Number.isFinite(en.bestLap) && en.bestLap > 0 && en.bestLap <= 1800000 ? en.bestLap : null,
    });
  }
  return { matched, unmatched: [...new Set(unmatched)] };
}

async function writeRound(race, matched) {
  for (const m of matched) {
    const sets = [];
    const vals = [];
    for (const col of TELEMETRY_COLS) {
      const v = m.telemetry[col];
      if (v != null) {
        sets.push(`"${col}" = ?`);
        vals.push(v);
      }
    }
    // grid / bestLap are profile-only enrichment; safe to fill (never totalTime,
    // to avoid any penalty re-sort). Only fill when currently empty.
    if (m.grid != null) sets.push(`"grid" = COALESCE("grid", ?)`), vals.push(m.grid);
    if (m.bestLapMs != null) sets.push(`"bestLapMs" = COALESCE("bestLapMs", ?)`), vals.push(m.bestLapMs);
    if (!sets.length) continue;
    await prisma.$executeRawUnsafe(
      `UPDATE "RaceResult" SET ${sets.join(", ")} WHERE "raceId" = ? AND "driverId" = ?`,
      ...vals,
      race.id,
      m.driverId
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.season || (!args.dir && !args.remote)) {
    console.error("Usage: --season <N> (--dir <path> | --remote) [--dry-run] [--fix-races]");
    process.exit(1);
  }
  // Ensure the telemetry columns exist before writing. Skipped on --dry-run so a
  // dry-run stays purely read-only (safe to run while the dev server is up).
  if (!args.dryRun) await ensureAppSchema(prisma);

  const season = await prisma.season.findFirst({ where: { number: args.season } });
  if (!season) throw new Error(`No season ${args.season} in the DB`);
  const overrideMap = OVERRIDES[args.season] || {};

  const races = await prisma.race.findMany({
    where: { seasonId: season.id, isSpecialEvent: false },
    orderBy: { number: "asc" },
    include: { results: { select: { driverId: true } } },
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

  // Pair each source to a race.
  const pairs = []; // { race, source }
  if (args.remote) {
    // One best source per RACE: within ±3 days AND (when both track names
    // resolve) the same circuit. This stops a nearby session at a different
    // track (or a special event) from being paired to the wrong round.
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
    // Chronological order = round order.
    if (sources.length !== races.length) {
      console.warn(`  ! ${sources.length} JSONs but ${races.length} races — pairing by order up to the shorter length`);
    }
    const n = Math.min(sources.length, races.length);
    for (let i = 0; i < n; i++) pairs.push({ race: races[i], source: sources[i] });
  }

  let wrote = 0;
  let skipped = 0;
  for (const { race, source } of pairs) {
    const jsonKey = trackKeyFor(source.track);
    const dbKey = trackKeyFor(race.track);
    if (jsonKey && dbKey && jsonKey !== dbKey) {
      console.warn(`  ! R${race.number}: track guard — JSON ${jsonKey} vs DB ${dbKey}. Check ordering.`);
    }

    const { matched, unmatched } = matchRound(source.json, race, roster, overrideMap);
    const label = `R${race.number} ${race.track}`;
    console.log(
      `  ${label}: ${matched.length}/${race.results.length} rows matched` +
        (unmatched.length ? `  · no telemetry for: ${unmatched.join(", ")}` : "")
    );

    // The S5/S6 archive sheets used different handles than the AC files for some
    // drivers (e.g. "DanielJ-MR setup" vs "Daniel Jelinek"). Those are left with
    // null telemetry rather than risk misattributing one person's data to
    // another — add confirmed identities to OVERRIDES[season] to fill them in.
    // We still write every confident match; only a completely empty match (a
    // pairing/ordering error) is skipped.
    if (!matched.length) {
      console.warn(`     ↳ skipped: nothing matched (check round pairing)`);
      skipped++;
      continue;
    }
    if (args.dryRun) continue;

    // Fix S6 placeholder tracks + fill any missing dates (never touches results).
    if (args.fixRaces) {
      const data = {};
      if (isPlaceholderTrack(race.track) && jsonKey) data.track = displayNameFor(jsonKey);
      if (!race.date && source.date) data.date = source.date;
      if (Object.keys(data).length) await prisma.race.update({ where: { id: race.id }, data });
    }

    await writeRound(race, matched);
    saveDirect(source.json, {
      seasonNumber: season.number,
      raceNumber: race.number,
      track: jsonKey ? displayNameFor(jsonKey) : race.track,
    });
    wrote++;
  }

  console.log(`\n  Rounds written: ${wrote}, skipped: ${skipped}${args.dryRun ? " (dry-run: nothing written)" : ""}`);

  // Validation: prove the season's driver standings are unchanged (we only wrote
  // enrichment columns, so the drop-adjusted totals must still equal the sheet).
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
