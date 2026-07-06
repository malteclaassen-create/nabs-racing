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

  // Snapshot the car-to-car contact counts stored for this round, so a manual
  // results edit (which doesn't carry contact data) preserves what the AC import
  // captured instead of wiping it. Read raw so it works whether or not the
  // generated client exposes the column yet.
  const existing = await prisma.$queryRawUnsafe(
    `SELECT "driverId", "contacts" FROM "RaceResult" WHERE "raceId" = ?`,
    raceId
  );
  const prevContacts = new Map(existing.map((r) => [r.driverId, r.contacts]));

  await prisma.$transaction(async (tx) => {
    // Replace this race's results.
    await tx.raceResult.deleteMany({ where: { raceId } });
    await tx.constructorRaceScore.deleteMany({ where: { raceId } });

    for (const r of results) {
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
          grid: r.grid ?? null,
          bestLapMs: r.bestLapMs ?? null,
          totalTimeMs: r.totalTimeMs ?? null,
        },
      });
      // Contacts: use the value the import supplied, else preserve the previous
      // one. Written via raw SQL (rather than the create above) so it persists
      // even before the generated client is refreshed for the column.
      const contacts = r.contacts ?? prevContacts.get(r.driverId) ?? null;
      if (contacts != null) {
        await tx.$executeRawUnsafe(
          `UPDATE "RaceResult" SET "contacts" = ? WHERE "raceId" = ? AND "driverId" = ?`,
          contacts,
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
}
