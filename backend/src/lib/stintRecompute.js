// ---------------------------------------------------------------------------
// Recompute ONLY the tyre stints on existing RaceResult rows, from the raw AC
// result JSONs the site archived at import time (results-archive/season<N>/).
//
// Lives as a lib because it has two callers with different lifecycles:
//   - scripts/recompute-stints.mjs, the operator CLI (dry runs, any season);
//   - the one-time startup pass below, which is how the fix reaches the
//     PRODUCTION database. The hosted instance has no shell to run scripts
//     from, but it does have the archive on its volume (written by its own
//     imports) and a startup chain that already carries one-off, flag-guarded
//     catch-ups (see backfillCardIntro in index.js). Same pattern here.
//
// Why stints only: the pit-detection rework (services/telemetryExtractor.js,
// validated against two driver-confirmed strategies from S8 round 1) changes
// nothing about scoring. Positions, points and penalties are authoritative
// stored values and are never touched — this writes one JSON column.
//
// Matching a file to its stored race is DATE + TRACK KEY, never driver
// overlap: the same grid races every round, so overlap scores are near-equal
// across the whole season and the pick would be effectively random (the first
// draft of the CLI did exactly that and offered an Interlagos session's stints
// to the Hockenheim round). Filenames aren't trustworthy either — the archive
// folder still holds files from an earlier use of the season, two of them
// also named "r01".
// ---------------------------------------------------------------------------
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RESULTS_ARCHIVE_DIR } from "./dataDirs.js";
import { trackKeyFor } from "./trackKeys.js";
import { findPitFile, loadPitStops, pitTrackKey } from "./pitEventsStore.js";
import { extractTelemetry } from "../services/telemetryExtractor.js";

// Recompute one season's stints from its archived JSONs.
// Returns { racesMatched, rowsChanged, rowsSame, notes: [] }.
export async function recomputeSeasonStints(prisma, seasonNumber, { dryRun = false, log = () => {} } = {}) {
  const out = { racesMatched: 0, rowsChanged: 0, rowsSame: 0, notes: [] };
  const dir = join(RESULTS_ARCHIVE_DIR, `season${seasonNumber}`);
  if (!existsSync(dir)) {
    out.notes.push(`no archive folder for season ${seasonNumber}`);
    return out;
  }
  const season = await prisma.season.findFirst({ where: { number: seasonNumber } });
  if (!season) {
    out.notes.push(`season ${seasonNumber} not in the database`);
    return out;
  }
  // GUID -> driver for this season's roster; (seasonId, steamId) is unique, so
  // this is one-to-one by construction — no name matching anywhere.
  const roster = await prisma.driver.findMany({
    where: { seasonId: season.id, steamId: { not: null } },
    select: { id: true, steamId: true, name: true },
  });
  const driverByGuid = new Map(roster.map((d) => [String(d.steamId), d]));
  if (!driverByGuid.size) {
    out.notes.push(`season ${seasonNumber}: no drivers carry a Steam id`);
    return out;
  }

  // stints is read and written with raw SQL on purpose: the column is added by
  // a migration plus ensureSchema, and the generated Prisma client in this
  // checkout does not carry it. lib/telemetryRead.js reads it the same way.
  const raceRows = await prisma.race.findMany({
    where: { seasonId: season.id },
    select: { id: true, number: true, track: true, date: true },
  });
  const races = [];
  for (const r of raceRows) {
    const results = await prisma.$queryRawUnsafe(
      'SELECT "id", "driverId", "stints" FROM "RaceResult" WHERE "raceId" = ?',
      r.id
    );
    races.push({ ...r, results });
  }

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    let json;
    try {
      json = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      out.notes.push(`${file}: unreadable`);
      continue;
    }
    if (!json?.Laps?.length) continue;

    let byGuid;
    try {
      // A live pit recording, when one exists for this session, is the same
      // authority here as on the import path (acJsonParser does the identical
      // lookup): recorded races recompute from fact, unrecorded ones from the
      // heuristic.
      let pitStopsByGuid = null;
      try {
        // The recorder names its file by pitTrackKey (the layout name when the
        // track table knows it, else the raw layout), and the import path looks
        // it up the same way. This pass used trackKeyFor on the layout, which
        // returns null for a mod layout like Most's "nabs_most_no_chicane" —
        // so the recording was never found here and the pass would have put
        // the heuristic back over the recorder's fact.
        const pf = findPitFile({
          dayIso: String(json.Date || "").slice(0, 10),
          trackKey: pitTrackKey(json.TrackConfig, json.TrackName),
        });
        if (pf) pitStopsByGuid = loadPitStops(pf, { aroundIso: json.Date ? String(json.Date) : null });
      } catch {
        /* recording unreadable — heuristic it is */
      }
      ({ byGuid } = extractTelemetry(json, { pitStopsByGuid }));
    } catch (e) {
      out.notes.push(`${file}: extractor failed (${e.message})`);
      continue;
    }

    const fileDriverIds = new Set();
    for (const guid of byGuid.keys()) {
      const d = driverByGuid.get(String(guid));
      if (d) fileDriverIds.add(d.id);
    }
    if (!fileDriverIds.size) continue;

    const fileDay = String(json.Date || "").slice(0, 10);
    // Layout first (it distinguishes Spa from Spa without a chicane), then the
    // track itself: a mod layout the table has no entry for must still find
    // its race. Most 2026-09-04 was skipped by this pass for exactly that —
    // "nabs_most_no_chicane" resolved to nothing, so the round it was written
    // for never got recomputed.
    const fileTrack = trackKeyFor(json.TrackConfig || "") || trackKeyFor(json.TrackName || "");
    let match = null;
    if (fileDay && fileTrack) {
      for (const r of races) {
        const raceDay = r.date ? new Date(r.date).toISOString().slice(0, 10) : null;
        if (raceDay !== fileDay) continue;
        if (trackKeyFor(r.track || "") !== fileTrack) continue;
        const overlap = r.results.filter((x) => fileDriverIds.has(x.driverId)).length;
        if (overlap >= 3) match = r;
      }
    }
    if (!match) {
      log(`  ${file}: no stored race on ${fileDay || "?"} at ${fileTrack || "?"}, skipping`);
      continue;
    }

    out.racesMatched++;
    for (const row of match.results) {
      const driver = roster.find((d) => d.id === row.driverId);
      const tel = driver ? byGuid.get(String(driver.steamId)) : null;
      if (!tel || !tel.stints?.length) continue;
      const wasRaw = row.stints || null;
      const nowRaw = JSON.stringify(tel.stints);
      if (wasRaw === nowRaw) {
        out.rowsSame++;
        continue;
      }
      out.rowsChanged++;
      log(`  S${seasonNumber} ${match.number != null ? "R" + match.number : "(non-championship)"} ${match.track}: ${driver?.name || row.driverId} ${wasRaw || "(none)"} => ${nowRaw}`);
      if (!dryRun) {
        await prisma.$executeRawUnsafe('UPDATE "RaceResult" SET "stints" = ? WHERE "id" = ?', nowRaw, row.id);
        // The in-memory copy must follow the write: the archive can hold the
        // same race twice (files are copied around on race night), and the
        // second pass compares against these rows again. Without this, every
        // boot re-reported the duplicate file's rows as "changed".
        row.stints = nowRaw;
      }
    }
  }
  return out;
}

// One-time startup pass over the seasons the live pit recorder has been
// running for. Guarded by a Setting flag so it runs once per database, exactly
// like the card-unlock catch-up. Seasons before 8 are left alone on purpose
// (owner's call: the archive era stays as imported). The flag is only set
// after a successful pass that matched at least one race, so a boot where the
// volume wasn't mounted yet simply retries next time.
//
// The key names the rule the pass carries; a new rule gets a new key so the
// rows are visited again. "racewindow": recorded stops and compound changes
// outside the race (cool-down pit returns, pre-lights setup changes) no
// longer split or rename stints — Most 2026-09-04.
// "racewindow2": the first racewindow pass matched races by a key that mod
// layouts resolve to nothing, so those rounds were skipped and the flag set
// regardless — run once more with the lookup fixed.
const FLAG_KEY = "stints_recomputed_s8_racewindow2";
const FIRST_RECORDED_SEASON = 8;

export async function recomputeStintsOnce(prisma) {
  const done = await prisma.setting.findUnique({ where: { key: FLAG_KEY } }).catch(() => null);
  if (done) return;
  const seasons = await prisma.season.findMany({
    where: { number: { gte: FIRST_RECORDED_SEASON } },
    select: { number: true },
    orderBy: { number: "asc" },
  });
  const res = { racesMatched: 0, rowsChanged: 0, rowsSame: 0, notes: [] };
  for (const s of seasons) {
    const r = await recomputeSeasonStints(prisma, s.number, { log: (m) => console.log("[stints]" + m) });
    res.racesMatched += r.racesMatched;
    res.rowsChanged += r.rowsChanged;
    res.rowsSame += r.rowsSame;
    res.notes.push(...r.notes);
  }
  console.log(
    `[stints] one-time recompute (S${FIRST_RECORDED_SEASON}+): ${res.racesMatched} races, ${res.rowsChanged} rows updated, ${res.rowsSame} already current` +
      (res.notes.length ? ` (${res.notes.join("; ")})` : "")
  );
  if (res.racesMatched > 0) {
    await prisma.setting.upsert({
      where: { key: FLAG_KEY },
      create: { key: FLAG_KEY, value: new Date().toISOString() },
      update: { value: new Date().toISOString() },
    });
  }
}
