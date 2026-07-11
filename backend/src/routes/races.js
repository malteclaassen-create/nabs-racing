import { Router } from "express";
import prisma from "../lib/prisma.js";
import { getDriverResultPoints, getPointsForPosition, applyPenalties, DEFAULT_POINTS_TABLE } from "../services/pointsCalculator.js";
import { resolveSeasonId, getSeasonScoring, getPrivateSeasonIds } from "../services/seasonService.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getNameOverrides } from "../lib/persons.js";
import { telemetryForRace } from "../lib/telemetryRead.js";

const router = Router();

// GET /api/races -> list of all races in the selected (default: active) season.
// An admin may target a private season (site preview); the public can't.
router.get("/", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, { includePrivate: isAdminRequest(req) });
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
    // A race in a private (unpublished) season is 404 to the public.
    if (race.seasonId && !isAdminRequest(req) && (await getPrivateSeasonIds(prisma)).has(race.seasonId)) {
      return res.status(404).json({ error: "Race not found" });
    }

    const [results, drivers, teams, scoring, nameOverrides, telemetry] = await Promise.all([
      prisma.raceResult.findMany({
        where: { raceId: race.id },
        include: { driver: { include: { team: true } }, subForTeam: true },
      }),
      prisma.driver.findMany({ where: { seasonId: race.seasonId } }),
      prisma.team.findMany({ where: { seasonId: race.seasonId } }),
      getSeasonScoring(prisma, race.seasonId),
      getNameOverrides(prisma),
      telemetryForRace(prisma, race.id),
    ]);
    const table = scoring.pointsTable || DEFAULT_POINTS_TABLE;

    const teamById = new Map(teams.map((t) => [t.id, t]));

    // Apply position penalties so the displayed order, points and the Tier-2
    // re-rank all use each car's final (post-penalty) position. `rawById` keeps
    // the original finishing position so the UI can show "P2 → P5".
    const applied = applyPenalties(results);
    const rawById = new Map(results.map((r) => [r.driverId, r.position]));
    // The points column as STORED in the DB (explicit official points, or null
    // when they derive from the position). The admin editor round-trips this
    // raw value — sending back the computed display points would freeze
    // derived points into fake "official" ones.
    const rawPointsById = new Map(results.map((r) => [r.driverId, r.points]));

    // Build T2 re-rank lookup for races that have positions (e.g. R9).
    const hasPositions = applied.some((r) => r.position != null);
    const t2ReRank = {};
    if (hasPositions) {
      const driverById = new Map(drivers.map((d) => [d.id, d]));
      const effTeam = (r) =>
        teamById.get(r.subForTeamId || driverById.get(r.driverId)?.teamId);
      // Only Tier-2-team results are classified; Tier-1 drivers and team-less
      // reserves are excluded entirely (they don't occupy a slot).
      // FINISHED only, matching the scoring: a DNF/DSQ holds no slot in the
      // re-rank, so this display always mirrors what the teams actually score.
      const remaining = applied
        .filter((r) => r.status === "FINISHED" && r.position != null && effTeam(r)?.tier === 2)
        .sort((a, b) => a.position - b.position);
      remaining.forEach((r, i) => {
        const rank = i + 1;
        const team = effTeam(r);
        t2ReRank[r.driverId] = {
          rank,
          points: getPointsForPosition(rank, table),
          scoresForTeam: team.id,
        };
      });
    }

    const rows = applied
      .map((r) => {
        const effectiveTeam = r.subForTeam
          ? teamById.get(r.subForTeam.id)
          : r.driver.team;
        const ov = nameOverrides.get(r.driverId);
        // AC telemetry read via raw SQL (columns may not be in the generated
        // client yet) — feeds race facts + profiles. null when not imported.
        const tel = telemetry.get(r.driverId) || {};
        return {
          driverId: r.driverId,
          name: ov?.displayName || r.driver.name,
          formerName: ov?.formerName || null,
          discordName: r.driver.discordName,
          country: r.driver.country || null,
          driverTier: r.driver.tier,
          position: r.position,
          rawPosition: rawById.get(r.driverId) ?? null,
          status: r.status,
          points: getDriverResultPoints(r, table),
          storedPoints: rawPointsById.get(r.driverId) ?? null,
          penaltySeconds: r.penaltySeconds,
          grid: r.grid,
          bestLapMs: r.bestLapMs,
          totalTimeMs: r.totalTimeMs,
          contacts: tel.contacts ?? null,
          envContacts: tel.envContacts ?? null,
          cuts: tel.cuts ?? null,
          overtakes: tel.overtakes ?? null,
          laps: tel.laps ?? null,
          cleanLaps: tel.cleanLaps ?? null,
          consistencyMs: tel.consistencyMs ?? null,
          consistencyPct: tel.consistencyPct ?? null,
          gamePenalties: tel.gamePenalties ?? null,
          gamePenaltySeconds: tel.gamePenaltySeconds ?? null,
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
        // classified finishers first (by position), then the non-finishers —
        // like the official result posts (DNF/DNS/DSQ listed at the bottom).
        const af = a.status === "FINISHED" && a.position != null;
        const bf = b.status === "FINISHED" && b.position != null;
        if (af && bf) return a.position - b.position;
        if (af !== bf) return af ? -1 : 1;
        return (a.position ?? 999) - (b.position ?? 999);
      });

    // Driver of the Day (admin pick + who made the call) — columns may not be
    // in the generated client.
    let driverOfTheDay = null;
    try {
      const dr = await prisma.$queryRawUnsafe(
        `SELECT "driverOfTheDayId", "driverOfTheDayBy" FROM "Race" WHERE "id" = ?`,
        race.id
      );
      const dotdId = dr[0]?.driverOfTheDayId || null;
      if (dotdId) {
        const row = rows.find((r) => r.driverId === dotdId);
        driverOfTheDay = { driverId: dotdId, name: row?.name || null, pickedBy: dr[0]?.driverOfTheDayBy || null };
      }
    } catch {
      /* column missing pre-migration */
    }

    res.json({
      race: {
        id: race.id,
        number: race.number,
        track: race.track,
        date: race.date,
        isCompleted: race.isCompleted,
        hasPositions,
        driverOfTheDay,
      },
      results: rows,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
