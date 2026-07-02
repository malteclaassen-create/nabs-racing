// ---------------------------------------------------------------------------
// Persists a race's results and (re)computes its constructor scores.
// Used by both the AC import and the manual results editor.
// ---------------------------------------------------------------------------
import {
  applyPenalties,
  calculateT1ConstructorPoints,
  calculateT2ConstructorPoints,
} from "./pointsCalculator.js";

// results: [{ driverId, position, status, subForTeamId, penaltySeconds, totalTimeMs }]
// `position` is the RAW finishing position; any time penalties are applied here
// when computing scores (race time + penalty seconds, re-sorted). The raw
// position is what gets stored, so re-opening the round in the editor and
// re-saving is idempotent.
export async function saveRaceResults(prisma, raceId, results) {
  const [drivers, teams] = await Promise.all([
    prisma.driver.findMany(),
    prisma.team.findMany(),
  ]);

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

    // Recompute constructor scores from the penalty-adjusted classification.
    const applied = applyPenalties(results);
    const t1 = calculateT1ConstructorPoints(applied, drivers, teams);
    const t2 = calculateT2ConstructorPoints(applied, drivers, teams);

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
