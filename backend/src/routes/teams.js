import { Router } from "express";
import prisma from "../lib/prisma.js";
import { resolveSeasonId } from "../services/seasonService.js";

const router = Router();

// GET /api/teams -> all teams (with drivers) in the selected (default: active) season
router.get("/", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season);
    const teams = await prisma.team.findMany({
      where: { seasonId },
      include: {
        drivers: { orderBy: { name: "asc" } },
      },
      orderBy: [{ tier: "asc" }, { name: "asc" }],
    });
    res.json(teams);
  } catch (e) {
    next(e);
  }
});

export default router;
