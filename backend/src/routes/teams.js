import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

// GET /api/teams -> all teams with their drivers
router.get("/", async (req, res, next) => {
  try {
    const teams = await prisma.team.findMany({
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
