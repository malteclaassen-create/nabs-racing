// ---------------------------------------------------------------------------
// Persists a race's results and (re)computes its constructor scores.
// Used by both the AC import and the manual results editor.
// ---------------------------------------------------------------------------
import {
  calculateT1ConstructorPoints,
  calculateT2ConstructorPoints,
} from "./pointsCalculator.js";

// results: [{ driverId, position, status, subForTeamId, penaltyPositions }]
// `position` is the FINAL position (after penalties already applied by caller).
export async function saveRaceResults(prisma, raceId, results) {
  const [drivers, teams] = await Promise.all([
    prisma.driver.findMany(),
    prisma.team.findMany(),
  ]);

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
          // imported/edited races derive points from position+status
          points: null,
          status: r.status || "FINISHED",
          subForTeamId: r.subForTeamId || null,
          penaltyPositions: r.penaltyPositions || 0,
          grid: r.grid ?? null,
          bestLapMs: r.bestLapMs ?? null,
        },
      });
    }

    // Recompute constructor scores from the freshly stored results.
    const t1 = calculateT1ConstructorPoints(results, drivers, teams);
    const t2 = calculateT2ConstructorPoints(results, drivers, teams);

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
