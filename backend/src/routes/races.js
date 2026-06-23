import { Router } from "express";
import prisma from "../lib/prisma.js";
import { getDriverResultPoints, getPointsForPosition } from "../services/pointsCalculator.js";
import { resolveSeasonId } from "../services/seasonService.js";

const router = Router();

// GET /api/races -> list of all races in the selected (default: active) season
router.get("/", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season);
    const races = await prisma.race.findMany({
      where: { seasonId },
      orderBy: { number: "asc" },
      include: { _count: { select: { results: true } } },
    });
    res.json(
      races.map((r) => ({
        id: r.id,
        number: r.number,
        track: r.track,
        date: r.date,
        isCompleted: r.isCompleted,
        isSpecialEvent: r.isSpecialEvent,
        resultCount: r._count.results,
      }))
    );
  } catch (e) {
    next(e);
  }
});

// GET /api/races/:id/results -> full results of one race
router.get("/:id/results", async (req, res, next) => {
  try {
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });

    const [results, drivers, teams] = await Promise.all([
      prisma.raceResult.findMany({
        where: { raceId: race.id },
        include: { driver: { include: { team: true } }, subForTeam: true },
      }),
      prisma.driver.findMany({ where: { seasonId: race.seasonId } }),
      prisma.team.findMany({ where: { seasonId: race.seasonId } }),
    ]);

    const teamById = new Map(teams.map((t) => [t.id, t]));

    // Build T2 re-rank lookup for races that have positions (e.g. R9).
    const hasPositions = results.some((r) => r.position != null);
    const t2ReRank = {};
    if (hasPositions) {
      const driverById = new Map(drivers.map((d) => [d.id, d]));
      const effTeam = (r) =>
        teamById.get(r.subForTeamId || driverById.get(r.driverId)?.teamId);
      // Only Tier-2-team results are classified; Tier-1 drivers and team-less
      // reserves are excluded entirely (they don't occupy a slot).
      const remaining = results
        .filter((r) => r.status !== "DNS" && r.position != null && effTeam(r)?.tier === 2)
        .sort((a, b) => a.position - b.position);
      remaining.forEach((r, i) => {
        const rank = i + 1;
        const team = effTeam(r);
        t2ReRank[r.driverId] = {
          rank,
          points: getPointsForPosition(rank),
          scoresForTeam: r.status === "FINISHED" ? team.id : null,
        };
      });
    }

    const rows = results
      .map((r) => {
        const effectiveTeam = r.subForTeam
          ? teamById.get(r.subForTeam.id)
          : r.driver.team;
        return {
          driverId: r.driverId,
          name: r.driver.name,
          discordName: r.driver.discordName,
          driverTier: r.driver.tier,
          position: r.position,
          status: r.status,
          points: getDriverResultPoints(r),
          penaltyPositions: r.penaltyPositions,
          grid: r.grid,
          bestLapMs: r.bestLapMs,
          team: {
            id: r.driver.team.id,
            name: r.driver.team.name,
            color: r.driver.team.color,
            tier: r.driver.team.tier,
            logoUrl: r.driver.team.logoUrl,
          },
          isSub: !!r.subForTeamId,
          subForTeam: r.subForTeam
            ? { id: r.subForTeam.id, name: r.subForTeam.name, color: r.subForTeam.color, logoUrl: r.subForTeam.logoUrl }
            : null,
          effectiveTeam: effectiveTeam
            ? { id: effectiveTeam.id, name: effectiveTeam.name, color: effectiveTeam.color, tier: effectiveTeam.tier, logoUrl: effectiveTeam.logoUrl }
            : null,
          t2: t2ReRank[r.driverId] || null,
        };
      })
      .sort((a, b) => {
        // finished first by position, then everything else
        if (a.position == null && b.position == null) return 0;
        if (a.position == null) return 1;
        if (b.position == null) return -1;
        return a.position - b.position;
      });

    res.json({
      race: {
        id: race.id,
        number: race.number,
        track: race.track,
        date: race.date,
        isCompleted: race.isCompleted,
        hasPositions,
      },
      results: rows,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
