// ---------------------------------------------------------------------------
// Persists a race's results and (re)computes its constructor scores.
// Used by both the AC import and the manual results editor.
// ---------------------------------------------------------------------------
import {
  applyPenalties,
  calculateT1ConstructorPoints,
  calculateT2ConstructorPoints,
  DEFAULT_POINTS_TABLE,
} from "./pointsCalculator.js";
import { getSeasonScoring } from "./seasonService.js";
import { invalidateRecordsCache } from "./recordsService.js";

// Rejects obviously broken input BEFORE anything is written, with messages an
// admin can act on. Throws a 400-flagged error (the express error handler
// turns err.status into the response code).
function validateResults(results, drivers, teams) {
  const problems = [];
  const driverIds = new Set(drivers.map((d) => d.id));
  const teamIds = new Set(teams.map((t) => t.id));
  const nameOf = new Map(drivers.map((d) => [d.id, d.name]));

  const seenDrivers = new Set();
  const seenPositions = new Map();
  for (const r of results) {
    if (!r.driverId || !driverIds.has(r.driverId)) {
      problems.push(`Unknown driver: ${r.driverId || "(empty)"} (not part of this season)`);
      continue;
    }
    if (seenDrivers.has(r.driverId)) {
      problems.push(`${nameOf.get(r.driverId)} appears twice in the results`);
    }
    seenDrivers.add(r.driverId);

    if (r.subForTeamId && !teamIds.has(r.subForTeamId)) {
      problems.push(`${nameOf.get(r.driverId)}: "drove for" team ${r.subForTeamId} doesn't exist in this season`);
    }
    const status = r.status || "FINISHED";
    if (!["FINISHED", "DNS", "DNF", "DSQ"].includes(status)) {
      problems.push(`${nameOf.get(r.driverId)}: unknown status "${status}"`);
    }
    if (r.penaltySeconds != null && (!Number.isFinite(Number(r.penaltySeconds)) || Number(r.penaltySeconds) < 0)) {
      problems.push(`${nameOf.get(r.driverId)}: penalty seconds must be 0 or greater`);
    }
    if (r.position != null) {
      if (!Number.isInteger(Number(r.position)) || Number(r.position) < 1) {
        problems.push(`${nameOf.get(r.driverId)}: invalid position ${r.position}`);
      } else if (status !== "DNS") {
        const pos = Number(r.position);
        if (seenPositions.has(pos)) {
          problems.push(`Position P${pos} is assigned twice (${nameOf.get(seenPositions.get(pos))} and ${nameOf.get(r.driverId)})`);
        }
        seenPositions.set(pos, r.driverId);
      }
    }
  }

  if (problems.length) {
    const err = new Error(`Results not saved: ${problems.join(" · ")}`);
    err.status = 400;
    throw err;
  }
}

// results: [{ driverId, position, status, subForTeamId, penaltySeconds, totalTimeMs }]
// `position` is the RAW finishing position; any time penalties are applied here
// when computing scores (race time + penalty seconds, re-sorted). The raw
// position is what gets stored, so re-opening the round in the editor and
// re-saving is idempotent.
export async function saveRaceResults(prisma, raceId, results) {
  // Constructor scoring must only ever see the race's own season: with several
  // seasons in the DB, an unscoped list would score points to same-named teams
  // of other seasons and pad every other season's teams with zero rows.
  const race = await prisma.race.findUnique({ where: { id: raceId } });
  const seasonWhere = race?.seasonId ? { seasonId: race.seasonId } : {};
  const [drivers, teams, scoring] = await Promise.all([
    prisma.driver.findMany({ where: seasonWhere }),
    prisma.team.findMany({ where: seasonWhere }),
    getSeasonScoring(prisma, race?.seasonId ?? null),
  ]);
  const table = scoring.pointsTable || DEFAULT_POINTS_TABLE;

  // Reject broken input before touching the database.
  validateResults(results, drivers, teams);

  // Snapshot the AC-captured telemetry stored for this round (contacts, grid,
  // best lap, total time, and the distilled telemetry), so a manual results edit
  // — which only carries the fields shown in the editor — preserves the rest
  // instead of wiping it. The manual editor has no grid/best-lap/telemetry
  // inputs, so re-saving a round to fix a driver mapping or a penalty must NOT
  // throw those away. Read raw so it works whether or not the generated client
  // exposes every column yet.
  //
  // IMPORTANT: every AC-derived column MUST be snapshotted here, or the next
  // manual Edit-Results save would blank out backfilled telemetry.
  const TELEMETRY_COLS = [
    "contacts", "envContacts", "cuts", "overtakes", "lapsLed", "laps",
    "cleanLaps", "consistencyMs", "consistencyPct", "gamePenalties", "gamePenaltySeconds",
    "stints",
  ];
  const existing = await prisma.$queryRawUnsafe(
    `SELECT "driverId", "grid", "bestLapMs", "totalTimeMs", ${TELEMETRY_COLS.map((c) => `"${c}"`).join(", ")} FROM "RaceResult" WHERE "raceId" = ?`,
    raceId
  );
  const prevGrid = new Map(existing.map((r) => [r.driverId, r.grid]));
  const prevBestLap = new Map(existing.map((r) => [r.driverId, r.bestLapMs]));
  const prevTotalTime = new Map(existing.map((r) => [r.driverId, r.totalTimeMs]));
  // driverId -> { col: prevValue } for the telemetry columns.
  const prevTelemetry = new Map(existing.map((r) => [r.driverId, r]));

  // A field the caller left off entirely (undefined) keeps whatever the round
  // already had; an explicit value (including null) from the AC import wins.
  const keep = (incoming, prev) => (incoming === undefined ? prev ?? null : incoming ?? null);

  await prisma.$transaction(async (tx) => {
    // Replace this race's results.
    await tx.raceResult.deleteMany({ where: { raceId } });
    await tx.constructorRaceScore.deleteMany({ where: { raceId } });

    for (const r of results) {
      // A driver swap in the editor sends prevDriverId = who USED to hold this
      // result row. The captured race data (time, grid, best lap, telemetry)
      // belongs to the row, not the person, so the preserved values follow the
      // swap instead of being dropped.
      const prevKey = r.prevDriverId || r.driverId;
      await tx.raceResult.create({
        data: {
          raceId,
          driverId: r.driverId,
          position: r.status === "DNS" ? null : r.position ?? null,
          // Preserve explicit points the caller kept (historical rounds keep
          // their official points unless a result was actually changed); a null
          // here means "derive from position+status".
          points: r.points ?? null,
          status: r.status || "FINISHED",
          subForTeamId: r.subForTeamId || null,
          penaltySeconds: r.penaltySeconds || 0,
          grid: keep(r.grid, prevGrid.get(prevKey)),
          bestLapMs: keep(r.bestLapMs, prevBestLap.get(prevKey)),
          totalTimeMs: keep(r.totalTimeMs, prevTotalTime.get(prevKey)),
        },
      });
      // Telemetry (contacts + distilled metrics): use the value the import
      // supplied, else preserve the previous one. Written via raw SQL (rather
      // than the create above) so it persists even before the generated client
      // is refreshed for these columns. Only touch columns that end up non-null
      // so a manual edit of an old (telemetry-less) round stays all-null.
      const prev = prevTelemetry.get(prevKey) || {};
      const sets = [];
      const vals = [];
      for (const col of TELEMETRY_COLS) {
        let val = keep(r[col], prev[col]);
        // stints is a TEXT column carrying JSON — the import hands it over as
        // an array, the preserved previous value is already a string.
        if (col === "stints" && val != null && typeof val !== "string") val = JSON.stringify(val);
        if (val != null) {
          sets.push(`"${col}" = ?`);
          vals.push(val);
        }
      }
      if (sets.length) {
        await tx.$executeRawUnsafe(
          `UPDATE "RaceResult" SET ${sets.join(", ")} WHERE "raceId" = ? AND "driverId" = ?`,
          ...vals,
          raceId,
          r.driverId
        );
      }
    }

    // Recompute constructor scores from the penalty-adjusted classification,
    // using this season's points table.
    const applied = applyPenalties(results);
    const t1 = calculateT1ConstructorPoints(applied, drivers, teams, table);
    const t2 = calculateT2ConstructorPoints(applied, drivers, teams, table);

    const teamById = new Map(teams.map((t) => [t.id, t]));
    const rows = [];
    for (const [teamId, points] of Object.entries(t1)) {
      rows.push({ raceId, teamId, tier: 1, points });
    }
    for (const [teamId, points] of Object.entries(t2)) {
      rows.push({ raceId, teamId, tier: 2, points });
    }
    // Ensure every tier team has a row (0 if absent) so per-race columns align.
    for (const team of teams) {
      if (team.tier !== 1 && team.tier !== 2) continue;
      const exists = rows.some((x) => x.teamId === team.id && x.tier === team.tier);
      if (!exists) rows.push({ raceId, teamId: team.id, tier: team.tier, points: 0 });
    }

    for (const row of rows) {
      // guard against teams not present (shouldn't happen)
      if (!teamById.has(row.teamId)) continue;
      await tx.constructorRaceScore.create({ data: row });
    }

    await tx.race.update({
      where: { id: raceId },
      data: { isCompleted: true },
    });
  });

  // Persist the Steam GUID from a confirmed AC import onto Driver.steamId. The
  // GUID (SteamID64) is a stable per-person identity — far more reliable than
  // the display name — so capturing it here lets a future import auto-map by ID
  // (see acJsonParser). Runs AFTER the results transaction and is entirely
  // best-effort: a steamId write must NEVER abort saving a race. Only the AC
  // import supplies r.driverGuid; the manual results editor doesn't, so this is
  // a no-op there. Raw SQL so it works even before the generated client is
  // refreshed for the new column (same idiom as the telemetry columns above).
  const steamIdConflicts = await reconcileSteamIds(prisma, results, drivers);
  // New results move the all-time records — drop the Hall of Fame cache so the
  // page reflects the round immediately instead of after the cache TTL.
  invalidateRecordsCache();
  return { steamIdConflicts };
}

// Writes each confirmed entry's driverGuid onto its Driver.steamId, and returns
// the conflicts the admin should see. Rules:
//   * write only when the driver's steamId is null (first capture);
//   * identical GUID -> nothing to do;
//   * a GUID that would CHANGE an existing steamId is NOT overwritten (a
//     mis-mapping or a shared account) — it's logged and returned as a conflict;
//   * the safety car's GUID is never written;
//   * a missing GUID is normal — skip it.
// Every write is guarded so a failure (e.g. the @@unique([seasonId, steamId])
// tripping on a shared account) is reported, never thrown.
async function reconcileSteamIds(prisma, results, drivers) {
  const conflicts = [];
  const nameOf = new Map(drivers.map((d) => [d.id, d.name]));
  const pending = results.filter((r) => r.driverGuid && !r.isSafetyCar && r.driverId);
  if (!pending.length) return conflicts;

  try {
    // Current steamId for the mapped drivers (raw so it works pre-client-refresh).
    const ids = [...new Set(pending.map((r) => r.driverId))];
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "steamId" FROM "Driver" WHERE "id" IN (${ids.map(() => "?").join(", ")})`,
      ...ids
    );
    const currentById = new Map(rows.map((r) => [r.id, r.steamId ?? null]));

    for (const r of pending) {
      const existing = currentById.get(r.driverId) ?? null;
      if (existing === r.driverGuid) continue; // already captured, identical
      if (existing != null) {
        // Different GUID already stored — do not overwrite.
        console.warn(
          `steamId left unchanged for ${nameOf.get(r.driverId) || r.driverId}: stored ${existing} != import ${r.driverGuid}`
        );
        conflicts.push({
          driverId: r.driverId,
          name: nameOf.get(r.driverId) || r.driverId,
          existing,
          incoming: r.driverGuid,
          reason: "would-change",
        });
        continue;
      }
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Driver" SET "steamId" = ? WHERE "id" = ? AND "steamId" IS NULL`,
          r.driverGuid,
          r.driverId
        );
        // Keep the local view current so two entries in one import that map to
        // the same driver don't double-write.
        currentById.set(r.driverId, r.driverGuid);
      } catch (e) {
        // Most likely the @@unique([seasonId, steamId]) tripping: this GUID is
        // already held by another driver in the same season (shared account or
        // a mis-map). Report it; never abort the save.
        console.error(
          `steamId write failed for ${nameOf.get(r.driverId) || r.driverId} (${r.driverGuid}): ${e.message}`
        );
        conflicts.push({
          driverId: r.driverId,
          name: nameOf.get(r.driverId) || r.driverId,
          incoming: r.driverGuid,
          reason: "write-failed",
        });
      }
    }
  } catch (e) {
    // The whole reconciliation is best-effort; a failure here (e.g. the column
    // not existing yet on a fresh DB) must not surface as a failed import.
    console.error("steamId reconciliation skipped:", e.message);
  }
  return conflicts;
}
